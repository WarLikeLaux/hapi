package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gotd/td/session"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/telegram/auth"
	"github.com/gotd/td/telegram/downloader"
	"github.com/gotd/td/telegram/message"
	messagepeer "github.com/gotd/td/telegram/message/peer"
	"github.com/gotd/td/telegram/message/styling"
	"github.com/gotd/td/telegram/query"
	"github.com/gotd/td/telegram/query/dialogs"
	"github.com/gotd/td/telegram/thumbnail"
	"github.com/gotd/td/telegram/uploader"
	"github.com/gotd/td/tg"
)

type rpcRequest struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type writer struct {
	mu sync.Mutex
	w  *bufio.Writer
}

func (w *writer) value(value any) {
	w.mu.Lock()
	defer w.mu.Unlock()
	_ = json.NewEncoder(w.w).Encode(value)
	_ = w.w.Flush()
}

func (w *writer) response(id string, result any, err error) {
	if err != nil {
		w.value(map[string]any{"id": id, "error": err.Error()})
		return
	}
	w.value(map[string]any{"id": id, "result": result})
}

func (w *writer) event(name string, data any) {
	w.value(map[string]any{"event": name, "data": data})
}

type connection struct {
	State        string  `json:"state"`
	AccountLabel *string `json:"accountLabel"`
	Detail       *string `json:"detail"`
}

type conversation struct {
	ID                        string  `json:"id"`
	Provider                  string  `json:"provider"`
	RemoteID                  string  `json:"remoteId"`
	Title                     string  `json:"title"`
	Kind                      string  `json:"kind"`
	Selected                  bool    `json:"selected"`
	LastMessageAt             *int64  `json:"lastMessageAt"`
	LastMessagePreview        *string `json:"lastMessagePreview"`
	LastMessageDirection      *string `json:"lastMessageDirection"`
	LastMessageDeliveryStatus *string `json:"lastMessageDeliveryStatus"`
	UnreadCount               int     `json:"unreadCount"`
	AvatarDataURL             *string `json:"avatarDataUrl"`
}

type externalMedia struct {
	Kind             string  `json:"kind"`
	MIMEType         *string `json:"mimeType"`
	FileName         *string `json:"fileName"`
	Size             *int64  `json:"size"`
	ThumbnailDataURL *string `json:"thumbnailDataUrl"`
	IsRound          bool    `json:"isRound,omitempty"`
	IsAnimated       bool    `json:"isAnimated,omitempty"`
}

type deletedMessages struct {
	RemoteID           *string  `json:"remoteId,omitempty"`
	ProviderMessageIDs []string `json:"providerMessageIds"`
}

type readReceipt struct {
	RemoteID string `json:"remoteId"`
	MaxID    int    `json:"maxId"`
}

type downloadedMedia struct {
	Path     string `json:"path"`
	MIMEType string `json:"mimeType"`
	FileName string `json:"fileName"`
	Size     int64  `json:"size"`
}

const maxMediaCacheBytes int64 = 1024 * 1024 * 1024

type externalMessage struct {
	ID                  string          `json:"id"`
	ConversationID      string          `json:"conversationId"`
	ProviderMessageID   string          `json:"providerMessageId"`
	SenderID            *string         `json:"senderId"`
	SenderName          *string         `json:"senderName"`
	SenderAvatarDataURL *string         `json:"senderAvatarDataUrl"`
	Direction           string          `json:"direction"`
	Text                string          `json:"text"`
	CreatedAt           int64           `json:"createdAt"`
	EditedAt            *int64          `json:"editedAt"`
	DeliveryStatus      *string         `json:"deliveryStatus,omitempty"`
	Media               []externalMedia `json:"media"`
}

type senderAvatarCandidate struct {
	remoteID    string
	peer        tg.InputPeerClass
	photoID     int64
	placeholder *string
}

type authInput struct {
	kind  string
	value string
}

type interactiveAuth struct {
	out      *writer
	inputs   chan authInput
	mu       sync.Mutex
	expected string
}

func (a *interactiveAuth) wait(ctx context.Context, kind string) (string, error) {
	a.mu.Lock()
	a.expected = kind
	a.mu.Unlock()
	a.out.event("connection", connection{State: "awaiting_" + kind})
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case input := <-a.inputs:
			if input.kind == kind {
				a.mu.Lock()
				a.expected = ""
				a.mu.Unlock()
				return input.value, nil
			}
		}
	}
}

func (a *interactiveAuth) submit(kind, value string) error {
	a.mu.Lock()
	expected := a.expected
	a.mu.Unlock()
	if expected == "" {
		return errors.New("Telegram is not waiting for authentication input")
	}
	if expected != kind {
		return fmt.Errorf("Telegram is waiting for %s, not %s", expected, kind)
	}
	a.inputs <- authInput{kind: kind, value: value}
	return nil
}

func (a *interactiveAuth) Phone(ctx context.Context) (string, error) {
	return a.wait(ctx, "phone")
}

func (a *interactiveAuth) Code(ctx context.Context, _ *tg.AuthSentCode) (string, error) {
	return a.wait(ctx, "code")
}

func (a *interactiveAuth) Password(ctx context.Context) (string, error) {
	return a.wait(ctx, "password")
}

func (a *interactiveAuth) AcceptTermsOfService(context.Context, tg.HelpTermsOfService) error {
	return errors.New("new Telegram account registration is not supported")
}

func (a *interactiveAuth) SignUp(context.Context) (auth.UserInfo, error) {
	return auth.UserInfo{}, errors.New("new Telegram account registration is not supported")
}

type service struct {
	out           *writer
	auth          *interactiveAuth
	mu            sync.RWMutex
	client        *telegram.Client
	raw           *tg.Client
	cancel        context.CancelFunc
	self          *tg.User
	peers         map[string]tg.InputPeerClass
	peerTitles    map[string]string
	avatars       map[string]string
	readOutboxMax map[string]int
	sessionPath   string
}

func newService(out *writer) *service {
	a := &interactiveAuth{out: out, inputs: make(chan authInput, 1)}
	return &service{
		out:           out,
		auth:          a,
		peers:         make(map[string]tg.InputPeerClass),
		peerTitles:    make(map[string]string),
		avatars:       make(map[string]string),
		readOutboxMax: make(map[string]int),
	}
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func userName(user *tg.User) string {
	name := strings.TrimSpace(strings.Join([]string{user.FirstName, user.LastName}, " "))
	if name == "" {
		name = user.Username
	}
	if name == "" {
		name = fmt.Sprintf("User %d", user.ID)
	}
	return name
}

func remoteIDFromInput(peer tg.InputPeerClass) (string, string, bool) {
	switch value := peer.(type) {
	case *tg.InputPeerSelf:
		return "self", "saved", true
	case *tg.InputPeerUser:
		return fmt.Sprintf("user:%d", value.UserID), "direct", true
	case *tg.InputPeerChat:
		return fmt.Sprintf("chat:%d", value.ChatID), "group", true
	case *tg.InputPeerChannel:
		return fmt.Sprintf("channel:%d", value.ChannelID), "channel", true
	default:
		return "", "", false
	}
}

func remoteIDFromPeer(peer tg.PeerClass) (string, bool) {
	switch value := peer.(type) {
	case *tg.PeerUser:
		return fmt.Sprintf("user:%d", value.UserID), true
	case *tg.PeerChat:
		return fmt.Sprintf("chat:%d", value.ChatID), true
	case *tg.PeerChannel:
		return fmt.Sprintf("channel:%d", value.ChannelID), true
	default:
		return "", false
	}
}

func channelDialogKind(channel *tg.Channel) (string, bool) {
	if channel == nil || (channel.Broadcast && !channel.Megagroup) {
		return "", false
	}
	return "group", true
}

func conversationID(remoteID string) string {
	return "telegram:" + remoteID
}

func titleForDialog(elem dialogs.Elem, remoteID, kind string) string {
	switch peer := elem.Peer.(type) {
	case *tg.InputPeerSelf:
		return "Saved Messages"
	case *tg.InputPeerUser:
		if user, ok := elem.Entities.User(peer.UserID); ok {
			return userName(user)
		}
	case *tg.InputPeerChat:
		if chat, ok := elem.Entities.Chat(peer.ChatID); ok {
			return chat.Title
		}
	case *tg.InputPeerChannel:
		if channel, ok := elem.Entities.Channel(peer.ChannelID); ok {
			return channel.Title
		}
	}
	if kind == "saved" {
		return "Saved Messages"
	}
	return remoteID
}

func jpegDataURL(data []byte) *string {
	if len(data) == 0 {
		return nil
	}
	value := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
	return &value
}

func strippedThumbnailDataURL(data []byte) *string {
	if len(data) == 0 {
		return nil
	}
	expanded, err := thumbnail.Expand(data)
	if err != nil {
		return nil
	}
	return jpegDataURL(expanded)
}

func avatarForDialog(elem dialogs.Elem) *string {
	switch peer := elem.Peer.(type) {
	case *tg.InputPeerUser:
		if user, ok := elem.Entities.User(peer.UserID); ok {
			if photo, ok := user.Photo.(*tg.UserProfilePhoto); ok {
				return strippedThumbnailDataURL(photo.StrippedThumb)
			}
		}
	case *tg.InputPeerChat:
		if chat, ok := elem.Entities.Chat(peer.ChatID); ok {
			if photo, ok := chat.Photo.(*tg.ChatPhoto); ok {
				return strippedThumbnailDataURL(photo.StrippedThumb)
			}
		}
	case *tg.InputPeerChannel:
		if channel, ok := elem.Entities.Channel(peer.ChannelID); ok {
			if photo, ok := channel.Photo.(*tg.ChatPhoto); ok {
				return strippedThumbnailDataURL(photo.StrippedThumb)
			}
		}
	}
	return nil
}

func avatarPhotoID(elem dialogs.Elem) int64 {
	switch peer := elem.Peer.(type) {
	case *tg.InputPeerUser:
		if user, ok := elem.Entities.User(peer.UserID); ok {
			if photo, ok := user.Photo.(*tg.UserProfilePhoto); ok {
				return photo.PhotoID
			}
		}
	case *tg.InputPeerChat:
		if chat, ok := elem.Entities.Chat(peer.ChatID); ok {
			if photo, ok := chat.Photo.(*tg.ChatPhoto); ok {
				return photo.PhotoID
			}
		}
	case *tg.InputPeerChannel:
		if channel, ok := elem.Entities.Channel(peer.ChannelID); ok {
			if photo, ok := channel.Photo.(*tg.ChatPhoto); ok {
				return photo.PhotoID
			}
		}
	}
	return 0
}

func downloadAvatar(ctx context.Context, raw *tg.Client, peer tg.InputPeerClass, photoID int64) *string {
	if photoID == 0 {
		return nil
	}
	// Telegram can take a few seconds to resolve the large peer photo on a cold
	// connection. Falling back too early leaves the 8x8 stripped thumbnail in
	// the conversation cache, which looks badly blurred in the chat list.
	downloadCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var output bytes.Buffer
	_, err := downloader.NewDownloader().WithPartSize(64*1024).Download(raw, &tg.InputPeerPhotoFileLocation{
		Peer:    peer,
		PhotoID: photoID,
		Big:     true,
	}).Stream(downloadCtx, &output)
	if err != nil || output.Len() == 0 || output.Len() > 2*1024*1024 {
		return nil
	}
	return jpegDataURL(output.Bytes())
}

func thumbnailDataURL(sizes []tg.PhotoSizeClass) *string {
	for _, size := range sizes {
		if cached, ok := size.(*tg.PhotoCachedSize); ok && len(cached.Bytes) > 0 {
			return jpegDataURL(cached.Bytes)
		}
	}
	for _, size := range sizes {
		if stripped, ok := size.(*tg.PhotoStrippedSize); ok {
			return strippedThumbnailDataURL(stripped.Bytes)
		}
	}
	return nil
}

func mediaFromTelegram(media tg.MessageMediaClass) []externalMedia {
	if media == nil {
		return nil
	}
	switch value := media.(type) {
	case *tg.MessageMediaPhoto:
		photo, ok := value.Photo.(*tg.Photo)
		if !ok {
			return []externalMedia{{Kind: "image"}}
		}
		mime := "image/jpeg"
		return []externalMedia{{Kind: "image", MIMEType: &mime, ThumbnailDataURL: thumbnailDataURL(photo.Sizes)}}
	case *tg.MessageMediaDocument:
		document, ok := value.Document.(*tg.Document)
		if !ok {
			return []externalMedia{{Kind: "file"}}
		}
		kind := "file"
		isRound := value.Round
		isAnimated := false
		if value.Voice {
			kind = "voice"
		} else if value.Video || value.Round {
			kind = "video"
		} else if strings.HasPrefix(document.MimeType, "audio/") {
			kind = "audio"
		} else if strings.HasPrefix(document.MimeType, "image/") {
			kind = "image"
		}
		fileName := ""
		for _, attribute := range document.Attributes {
			switch attribute := attribute.(type) {
			case *tg.DocumentAttributeFilename:
				fileName = attribute.FileName
			case *tg.DocumentAttributeSticker:
				kind = "sticker"
			case *tg.DocumentAttributeVideo:
				isRound = isRound || attribute.RoundMessage
			case *tg.DocumentAttributeAnimated:
				isAnimated = true
			}
		}
		if isAnimated {
			kind = "video"
		}
		mime := document.MimeType
		size := document.Size
		return []externalMedia{{
			Kind:             kind,
			MIMEType:         nullableString(mime),
			FileName:         nullableString(fileName),
			Size:             &size,
			ThumbnailDataURL: thumbnailDataURL(document.Thumbs),
			IsRound:          isRound,
			IsAnimated:       isAnimated,
		}}
	case *tg.MessageMediaGeo, *tg.MessageMediaGeoLive, *tg.MessageMediaVenue:
		return []externalMedia{{Kind: "location"}}
	case *tg.MessageMediaContact:
		return []externalMedia{{Kind: "contact"}}
	case *tg.MessageMediaPoll:
		return []externalMedia{{Kind: "poll"}}
	case *tg.MessageMediaEmpty, *tg.MessageMediaWebPage:
		return nil
	default:
		return []externalMedia{{Kind: "other"}}
	}
}

func mediaPreview(media []externalMedia) string {
	if len(media) == 0 {
		return ""
	}
	switch media[0].Kind {
	case "image":
		return "Photo"
	case "video":
		return "Video"
	case "audio":
		return "Audio"
	case "voice":
		return "Voice message"
	case "sticker":
		return "Sticker"
	case "file":
		return "File"
	case "location":
		return "Location"
	case "contact":
		return "Contact"
	case "poll":
		return "Poll"
	default:
		return "Attachment"
	}
}

func lastMessageData(msg tg.NotEmptyMessage) (*int64, *string) {
	if msg == nil {
		return nil, nil
	}
	at := int64(msg.GetDate()) * 1000
	text := ""
	if ordinary, ok := msg.(*tg.Message); ok {
		text = strings.TrimSpace(ordinary.Message)
		if text == "" {
			text = mediaPreview(mediaFromTelegram(ordinary.Media))
		}
	}
	if text == "" {
		text = "Message"
	}
	return &at, &text
}

func (s *service) configure(apiID int, apiHash, sessionPath string) error {
	if apiID <= 0 || strings.TrimSpace(apiHash) == "" || strings.TrimSpace(sessionPath) == "" {
		return errors.New("apiId, apiHash and sessionPath are required")
	}
	if err := os.MkdirAll(filepath.Dir(sessionPath), 0o700); err != nil {
		return fmt.Errorf("create session directory: %w", err)
	}
	s.mu.Lock()
	if s.cancel != nil {
		s.cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.client = nil
	s.raw = nil
	s.mu.Unlock()

	dispatcher := tg.NewUpdateDispatcher()
	dispatcher.OnNewMessage(s.handleNewMessage)
	dispatcher.OnNewChannelMessage(s.handleNewChannelMessage)
	dispatcher.OnDeleteMessages(s.handleDeleteMessages)
	dispatcher.OnDeleteChannelMessages(s.handleDeleteChannelMessages)
	dispatcher.OnReadHistoryOutbox(s.handleReadHistoryOutbox)
	dispatcher.OnReadChannelOutbox(s.handleReadChannelOutbox)
	client := telegram.NewClient(apiID, apiHash, telegram.Options{
		SessionStorage: &session.FileStorage{Path: sessionPath},
		UpdateHandler:  dispatcher,
	})

	go func() {
		err := client.Run(ctx, func(runCtx context.Context) error {
			if err := client.Auth().IfNecessary(runCtx, auth.NewFlow(s.auth, auth.SendCodeOptions{})); err != nil {
				return err
			}
			self, err := client.Self(runCtx)
			if err != nil {
				return err
			}
			_ = os.Chmod(sessionPath, 0o600)
			raw := tg.NewClient(client)
			s.mu.Lock()
			s.client = client
			s.raw = raw
			s.self = self
			s.sessionPath = sessionPath
			s.mu.Unlock()
			label := userName(self)
			s.out.event("connection", connection{State: "ready", AccountLabel: &label})
			<-runCtx.Done()
			return runCtx.Err()
		})
		if err != nil && !errors.Is(err, context.Canceled) {
			detail := err.Error()
			s.out.event("connection", connection{State: "error", Detail: &detail})
		}
	}()
	return nil
}

func (s *service) ready() (*tg.Client, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.raw == nil {
		return nil, errors.New("Telegram is not connected yet")
	}
	return s.raw, nil
}

func (s *service) listConversations(ctx context.Context) ([]conversation, error) {
	raw, err := s.ready()
	if err != nil {
		return nil, err
	}
	const maxConversations = 80
	const maxAvatarDownloads = 16
	iter := query.GetDialogs(raw).BatchSize(50).Iter()
	result := make([]conversation, 0, maxConversations)
	newPeers := make(map[string]tg.InputPeerClass, maxConversations)
	newTitles := make(map[string]string, maxConversations)
	newReadOutboxMax := make(map[string]int, maxConversations)
	type avatarTask struct {
		index    int
		remoteID string
		peer     tg.InputPeerClass
		photoID  int64
	}
	avatarTasks := make([]avatarTask, 0, maxAvatarDownloads)
	for iter.Next(ctx) {
		elem := iter.Value()
		if elem.Deleted() || elem.Last == nil {
			continue
		}
		remoteID, kind, ok := remoteIDFromInput(elem.Peer)
		if !ok {
			continue
		}
		if peer, isChannel := elem.Peer.(*tg.InputPeerChannel); isChannel {
			channel, found := elem.Entities.Channel(peer.ChannelID)
			if !found {
				continue
			}
			kind, ok = channelDialogKind(channel)
			if !ok {
				kind = "channel"
			}
		}
		title := titleForDialog(elem, remoteID, kind)
		lastAt, preview := lastMessageData(elem.Last)
		unread := 0
		readOutboxMax := 0
		if dialog, ok := elem.Dialog.(*tg.Dialog); ok {
			unread = dialog.UnreadCount
			readOutboxMax = dialog.ReadOutboxMaxID
		}
		newReadOutboxMax[remoteID] = readOutboxMax
		var lastDirection *string
		var lastDeliveryStatus *string
		if last, ok := elem.Last.(*tg.Message); ok {
			direction := "incoming"
			if last.Out {
				direction = "outgoing"
			}
			lastDirection = &direction
			lastDeliveryStatus = deliveryStatusForMessage(last, readOutboxMax)
		}
		newPeers[remoteID] = elem.Peer
		newTitles[remoteID] = title
		avatar := avatarForDialog(elem)
		s.mu.RLock()
		cachedAvatar := s.avatars[remoteID]
		s.mu.RUnlock()
		if cachedAvatar != "" {
			avatar = &cachedAvatar
		}
		result = append(result, conversation{
			ID:                        conversationID(remoteID),
			Provider:                  "telegram",
			RemoteID:                  remoteID,
			Title:                     title,
			Kind:                      kind,
			LastMessageAt:             lastAt,
			LastMessagePreview:        preview,
			LastMessageDirection:      lastDirection,
			LastMessageDeliveryStatus: lastDeliveryStatus,
			UnreadCount:               unread,
			AvatarDataURL:             avatar,
		})
		if cachedAvatar == "" && len(avatarTasks) < maxAvatarDownloads {
			if photoID := avatarPhotoID(elem); photoID != 0 {
				avatarTasks = append(avatarTasks, avatarTask{
					index: len(result) - 1, remoteID: remoteID, peer: elem.Peer, photoID: photoID,
				})
			}
		}
		if len(result) >= maxConversations {
			break
		}
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}
	var avatarWG sync.WaitGroup
	avatarSlots := make(chan struct{}, 6)
	for _, task := range avatarTasks {
		task := task
		avatarWG.Add(1)
		go func() {
			defer avatarWG.Done()
			avatarSlots <- struct{}{}
			defer func() { <-avatarSlots }()
			avatar := downloadAvatar(ctx, raw, task.peer, task.photoID)
			if avatar == nil {
				return
			}
			result[task.index].AvatarDataURL = avatar
			s.mu.Lock()
			s.avatars[task.remoteID] = *avatar
			s.mu.Unlock()
		}()
	}
	avatarWG.Wait()
	s.mu.Lock()
	s.peers = newPeers
	s.peerTitles = newTitles
	s.readOutboxMax = newReadOutboxMax
	s.mu.Unlock()
	return result, nil
}

func (s *service) ensurePeer(ctx context.Context, remoteID string) (tg.InputPeerClass, error) {
	s.mu.RLock()
	peer := s.peers[remoteID]
	s.mu.RUnlock()
	if peer != nil {
		return peer, nil
	}
	if _, err := s.listConversations(ctx); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	peer = s.peers[remoteID]
	if peer == nil {
		return nil, fmt.Errorf("Telegram conversation %s not found", remoteID)
	}
	return peer, nil
}

func senderData(msg *tg.Message, entities messagepeer.Entities, self *tg.User) (*string, *string) {
	from, ok := msg.GetFromID()
	if !ok {
		if msg.Out && self != nil {
			id := fmt.Sprintf("user:%d", self.ID)
			name := userName(self)
			return &id, &name
		}
		return nil, nil
	}
	remoteID, _ := remoteIDFromPeer(from)
	name := ""
	switch value := from.(type) {
	case *tg.PeerUser:
		if user, found := entities.User(value.UserID); found {
			name = userName(user)
		} else if self != nil && value.UserID == self.ID {
			name = userName(self)
		}
	case *tg.PeerChat:
		if chat, found := entities.Chat(value.ChatID); found {
			name = chat.Title
		}
	case *tg.PeerChannel:
		if channel, found := entities.Channel(value.ChannelID); found {
			name = channel.Title
		}
	}
	return nullableString(remoteID), nullableString(name)
}

func senderAvatarCandidateForMessage(msg *tg.Message, entities messagepeer.Entities, self *tg.User) *senderAvatarCandidate {
	var user *tg.User
	var peer tg.InputPeerClass
	if from, ok := msg.GetFromID(); ok {
		fromUser, ok := from.(*tg.PeerUser)
		if !ok {
			return nil
		}
		if entity, found := entities.User(fromUser.UserID); found {
			user = entity
		} else if self != nil && fromUser.UserID == self.ID {
			user = self
		}
		if user != nil {
			peer = &tg.InputPeerUser{UserID: user.ID, AccessHash: user.AccessHash}
		}
	} else if msg.Out && self != nil {
		user = self
		peer = &tg.InputPeerSelf{}
	}
	if user == nil || peer == nil {
		return nil
	}
	photo, ok := user.Photo.(*tg.UserProfilePhoto)
	if !ok || photo.PhotoID == 0 {
		return nil
	}
	return &senderAvatarCandidate{
		remoteID:    fmt.Sprintf("user:%d", user.ID),
		peer:        peer,
		photoID:     photo.PhotoID,
		placeholder: strippedThumbnailDataURL(photo.StrippedThumb),
	}
}

func deliveryStatusForMessage(msg *tg.Message, readOutboxMax int) *string {
	if !msg.Out {
		return nil
	}
	status := "sent"
	if msg.ID <= readOutboxMax {
		status = "read"
	}
	return &status
}

func messageFromTelegram(msg *tg.Message, entities messagepeer.Entities, self *tg.User, senderAvatar *string, readOutboxMax int) (externalMessage, bool) {
	remoteID, ok := remoteIDFromPeer(msg.PeerID)
	if !ok {
		return externalMessage{}, false
	}
	text := strings.TrimSpace(msg.Message)
	media := mediaFromTelegram(msg.Media)
	if media == nil {
		media = []externalMedia{}
	}
	senderID, senderName := senderData(msg, entities, self)
	direction := "incoming"
	if msg.Out {
		direction = "outgoing"
	}
	providerMessageID := fmt.Sprintf("%d", msg.ID)
	return externalMessage{
		ID:                  conversationID(remoteID) + ":" + providerMessageID,
		ConversationID:      conversationID(remoteID),
		ProviderMessageID:   providerMessageID,
		SenderID:            senderID,
		SenderName:          senderName,
		SenderAvatarDataURL: senderAvatar,
		Direction:           direction,
		Text:                text,
		CreatedAt:           int64(msg.Date) * 1000,
		DeliveryStatus:      deliveryStatusForMessage(msg, readOutboxMax),
		Media:               media,
	}, true
}

func (s *service) loadMessages(ctx context.Context, remoteID string, limit int) ([]externalMessage, error) {
	raw, err := s.ready()
	if err != nil {
		return nil, err
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return nil, err
	}
	if limit < 1 {
		limit = 100
	}
	if limit > 200 {
		limit = 200
	}
	iter := query.Messages(raw).GetHistory(peer).BatchSize(limit).Iter()
	s.mu.RLock()
	self := s.self
	readOutboxMax := s.readOutboxMax[remoteID]
	s.mu.RUnlock()
	result := make([]externalMessage, 0, limit)
	avatarMessageIndexes := make(map[string][]int)
	avatarCandidates := make(map[string]senderAvatarCandidate)
	for len(result) < limit && iter.Next(ctx) {
		elem := iter.Value()
		msg, ok := elem.Msg.(*tg.Message)
		if !ok {
			continue
		}
		candidate := senderAvatarCandidateForMessage(msg, elem.Entities, self)
		var avatar *string
		if candidate != nil {
			s.mu.RLock()
			cached := s.avatars[candidate.remoteID]
			s.mu.RUnlock()
			if cached != "" {
				avatar = &cached
			} else {
				avatar = candidate.placeholder
				if len(avatarCandidates) < 16 {
					avatarCandidates[candidate.remoteID] = *candidate
				}
			}
		}
		converted, ok := messageFromTelegram(msg, elem.Entities, self, avatar, readOutboxMax)
		if ok {
			result = append(result, converted)
			if candidate != nil {
				avatarMessageIndexes[candidate.remoteID] = append(avatarMessageIndexes[candidate.remoteID], len(result)-1)
			}
		}
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}
	avatarSlots := make(chan struct{}, 6)
	for remoteID, candidate := range avatarCandidates {
		remoteID, candidate := remoteID, candidate
		messages := make([]externalMessage, 0, len(avatarMessageIndexes[remoteID]))
		for _, index := range avatarMessageIndexes[remoteID] {
			messages = append(messages, result[index])
		}
		go func(messages []externalMessage) {
			avatarSlots <- struct{}{}
			defer func() { <-avatarSlots }()
			avatar := downloadAvatar(context.WithoutCancel(ctx), raw, candidate.peer, candidate.photoID)
			if avatar == nil {
				return
			}
			s.mu.Lock()
			s.avatars[remoteID] = *avatar
			s.mu.Unlock()
			for _, message := range messages {
				message.SenderAvatarDataURL = avatar
				s.out.event("message", message)
			}
		}(messages)
	}
	return result, nil
}

func messageByID(ctx context.Context, raw *tg.Client, peer tg.InputPeerClass, messageID int) (*tg.Message, error) {
	result, err := raw.MessagesGetHistory(ctx, &tg.MessagesGetHistoryRequest{Peer: peer, OffsetID: messageID + 1, Limit: 1})
	if err != nil {
		return nil, err
	}
	modified, ok := result.AsModified()
	if !ok {
		return nil, errors.New("Telegram returned no message data")
	}
	for _, item := range modified.GetMessages() {
		if msg, ok := item.(*tg.Message); ok && msg.ID == messageID {
			return msg, nil
		}
	}
	return nil, errors.New("Telegram message not found")
}

func largestPhotoType(sizes []tg.PhotoSizeClass) string {
	bestType, bestArea := "", 0
	for _, size := range sizes {
		var kind string
		var width, height int
		switch value := size.(type) {
		case *tg.PhotoSize:
			kind, width, height = value.Type, value.W, value.H
		case *tg.PhotoSizeProgressive:
			kind, width, height = value.Type, value.W, value.H
		case *tg.PhotoCachedSize:
			kind, width, height = value.Type, value.W, value.H
		}
		if area := width * height; kind != "" && area > bestArea {
			bestType, bestArea = kind, area
		}
	}
	return bestType
}

func documentFileName(document *tg.Document) string {
	for _, attribute := range document.Attributes {
		if filename, ok := attribute.(*tg.DocumentAttributeFilename); ok {
			if value := filepath.Base(filename.FileName); value != "." && value != "" {
				return value
			}
		}
	}
	return "attachment"
}

func mediaExtension(fileName, mimeType string) string {
	if ext := filepath.Ext(fileName); len(ext) > 1 && len(ext) <= 12 {
		return strings.ToLower(ext)
	}
	switch mimeType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "video/mp4":
		return ".mp4"
	case "audio/ogg":
		return ".ogg"
	case "audio/mpeg":
		return ".mp3"
	default:
		return ".bin"
	}
}

type mediaCacheFile struct {
	path    string
	size    int64
	modTime time.Time
}

func pruneMediaCache(cacheDir string, maxBytes int64, keepPath string) error {
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	files := make([]mediaCacheFile, 0, len(entries))
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || strings.HasSuffix(entry.Name(), ".part") {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		path := filepath.Join(cacheDir, entry.Name())
		files = append(files, mediaCacheFile{path: path, size: info.Size(), modTime: info.ModTime()})
		total += info.Size()
	}
	if total <= maxBytes {
		return nil
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modTime.Before(files[j].modTime) })
	for _, file := range files {
		if total <= maxBytes {
			break
		}
		if file.path == keepPath {
			continue
		}
		if err := os.Remove(file.path); err == nil || os.IsNotExist(err) {
			total -= file.size
		}
	}
	return nil
}

func (s *service) downloadMedia(ctx context.Context, remoteID, providerMessageID string, mediaIndex int) (downloadedMedia, error) {
	if mediaIndex != 0 {
		return downloadedMedia{}, errors.New("media attachment not found")
	}
	messageID, err := strconv.Atoi(providerMessageID)
	if err != nil || messageID <= 0 {
		return downloadedMedia{}, errors.New("invalid Telegram message id")
	}
	raw, err := s.ready()
	if err != nil {
		return downloadedMedia{}, err
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return downloadedMedia{}, err
	}
	msg, err := messageByID(ctx, raw, peer, messageID)
	if err != nil {
		return downloadedMedia{}, err
	}

	var location tg.InputFileLocationClass
	mimeType, fileName := "application/octet-stream", "attachment"
	switch media := msg.Media.(type) {
	case *tg.MessageMediaPhoto:
		photo, ok := media.Photo.(*tg.Photo)
		if !ok {
			return downloadedMedia{}, errors.New("photo is unavailable")
		}
		thumbType := largestPhotoType(photo.Sizes)
		if thumbType == "" {
			return downloadedMedia{}, errors.New("photo size is unavailable")
		}
		location = &tg.InputPhotoFileLocation{ID: photo.ID, AccessHash: photo.AccessHash, FileReference: photo.FileReference, ThumbSize: thumbType}
		mimeType, fileName = "image/jpeg", "photo.jpg"
	case *tg.MessageMediaDocument:
		document, ok := media.Document.(*tg.Document)
		if !ok {
			return downloadedMedia{}, errors.New("document is unavailable")
		}
		if document.Size > 100*1024*1024 {
			return downloadedMedia{}, errors.New("media file exceeds the 100 MB viewer limit")
		}
		location = &tg.InputDocumentFileLocation{ID: document.ID, AccessHash: document.AccessHash, FileReference: document.FileReference}
		mimeType, fileName = document.MimeType, documentFileName(document)
	default:
		return downloadedMedia{}, errors.New("this Telegram attachment cannot be downloaded")
	}

	s.mu.RLock()
	sessionPath := s.sessionPath
	s.mu.RUnlock()
	cacheDir := filepath.Join(filepath.Dir(sessionPath), "media-cache")
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return downloadedMedia{}, fmt.Errorf("create media cache: %w", err)
	}
	key := sha256.Sum256([]byte(remoteID + ":" + providerMessageID + ":" + strconv.Itoa(mediaIndex)))
	path := filepath.Join(cacheDir, fmt.Sprintf("%x%s", key[:16], mediaExtension(fileName, mimeType)))
	if stat, err := os.Stat(path); err == nil && stat.Size() > 0 {
		now := time.Now()
		_ = os.Chtimes(path, now, now)
		_ = pruneMediaCache(cacheDir, maxMediaCacheBytes, path)
		return downloadedMedia{Path: path, MIMEType: mimeType, FileName: fileName, Size: stat.Size()}, nil
	}
	temporaryPath := path + ".part"
	_ = os.Remove(temporaryPath)
	if _, err := downloader.NewDownloader().Download(raw, location).ToPath(ctx, temporaryPath); err != nil {
		_ = os.Remove(temporaryPath)
		return downloadedMedia{}, err
	}
	stat, err := os.Stat(temporaryPath)
	if err != nil || stat.Size() == 0 || stat.Size() > 100*1024*1024 {
		_ = os.Remove(temporaryPath)
		return downloadedMedia{}, errors.New("downloaded Telegram media is invalid")
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return downloadedMedia{}, err
	}
	_ = pruneMediaCache(cacheDir, maxMediaCacheBytes, path)
	return downloadedMedia{Path: path, MIMEType: mimeType, FileName: fileName, Size: stat.Size()}, nil
}

func applyClientID(builder *message.Builder, clientID string) {
	if clientID == "" {
		return
	}
	hash := sha256.Sum256([]byte(clientID))
	randomID := int64(binary.LittleEndian.Uint64(hash[:8]))
	if randomID == 0 {
		randomID = 1
	}
	builder.RandomID(randomID)
}

func (s *service) sendMedia(ctx context.Context, remoteID, path, fileName, mimeType, caption, clientID string) error {
	raw, err := s.ready()
	if err != nil {
		return err
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return err
	}
	stat, err := os.Stat(path)
	if err != nil || !stat.Mode().IsRegular() || stat.Size() <= 0 || stat.Size() > 50*1024*1024 {
		return errors.New("media file must be between 1 byte and 50 MB")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	fileName = filepath.Base(fileName)
	if fileName == "." || fileName == "" {
		fileName = "attachment" + mediaExtension("", mimeType)
	}
	uploaded, err := uploader.NewUploader(raw).WithThreads(4).FromReader(ctx, fileName, file)
	if err != nil {
		return err
	}
	builder := message.NewSender(raw).To(peer)
	applyClientID(&builder.Builder, clientID)
	captionOptions := []message.StyledTextOption{}
	if caption = strings.TrimSpace(caption); caption != "" {
		captionOptions = append(captionOptions, styling.Plain(caption))
	}
	switch {
	case strings.HasPrefix(mimeType, "image/") && mimeType != "image/gif":
		_, err = builder.UploadedPhoto(ctx, uploaded, captionOptions...)
	case strings.HasPrefix(mimeType, "video/"):
		_, err = builder.Video(ctx, uploaded, captionOptions...)
	case strings.HasPrefix(mimeType, "audio/"):
		_, err = builder.Audio(ctx, uploaded, captionOptions...)
	default:
		_, err = builder.File(ctx, uploaded, captionOptions...)
	}
	return err
}

func (s *service) sendText(ctx context.Context, remoteID, text, clientID string) error {
	raw, err := s.ready()
	if err != nil {
		return err
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return err
	}
	builder := message.NewSender(raw).To(peer)
	applyClientID(&builder.Builder, clientID)
	_, err = builder.Text(ctx, text)
	return err
}

func (s *service) emitNewMessage(ctx context.Context, entities messagepeer.Entities, msg *tg.Message) {
	s.mu.RLock()
	self := s.self
	raw := s.raw
	s.mu.RUnlock()
	remoteID, _ := remoteIDFromPeer(msg.PeerID)
	s.mu.RLock()
	readOutboxMax := s.readOutboxMax[remoteID]
	s.mu.RUnlock()
	candidate := senderAvatarCandidateForMessage(msg, entities, self)
	var avatar *string
	needsFullAvatar := false
	if candidate != nil {
		s.mu.RLock()
		cached := s.avatars[candidate.remoteID]
		s.mu.RUnlock()
		if cached != "" {
			avatar = &cached
		} else {
			avatar = candidate.placeholder
			needsFullAvatar = raw != nil
		}
	}
	converted, ok := messageFromTelegram(msg, entities, self, avatar, readOutboxMax)
	if !ok {
		return
	}
	s.out.event("message", converted)
	if !needsFullAvatar || candidate == nil {
		return
	}
	go func(message externalMessage, candidate senderAvatarCandidate) {
		fullAvatar := downloadAvatar(context.WithoutCancel(ctx), raw, candidate.peer, candidate.photoID)
		if fullAvatar == nil {
			return
		}
		s.mu.Lock()
		s.avatars[candidate.remoteID] = *fullAvatar
		s.mu.Unlock()
		message.SenderAvatarDataURL = fullAvatar
		s.out.event("message", message)
	}(converted, *candidate)
}

func (s *service) handleNewMessage(ctx context.Context, entities tg.Entities, update *tg.UpdateNewMessage) error {
	msg, ok := update.Message.(*tg.Message)
	if !ok {
		return nil
	}
	s.emitNewMessage(ctx, messagepeer.EntitiesFromUpdate(entities), msg)
	return nil
}

func (s *service) handleNewChannelMessage(ctx context.Context, entities tg.Entities, update *tg.UpdateNewChannelMessage) error {
	msg, ok := update.Message.(*tg.Message)
	if !ok {
		return nil
	}
	s.emitNewMessage(ctx, messagepeer.EntitiesFromUpdate(entities), msg)
	return nil
}

func providerMessageIDs(ids []int) []string {
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		if id > 0 {
			result = append(result, strconv.Itoa(id))
		}
	}
	return result
}

func (s *service) handleDeleteMessages(_ context.Context, _ tg.Entities, update *tg.UpdateDeleteMessages) error {
	ids := providerMessageIDs(update.Messages)
	if len(ids) > 0 {
		s.out.event("messages-deleted", deletedMessages{ProviderMessageIDs: ids})
	}
	return nil
}

func (s *service) handleDeleteChannelMessages(_ context.Context, _ tg.Entities, update *tg.UpdateDeleteChannelMessages) error {
	ids := providerMessageIDs(update.Messages)
	if len(ids) > 0 {
		remoteID := fmt.Sprintf("channel:%d", update.ChannelID)
		s.out.event("messages-deleted", deletedMessages{RemoteID: &remoteID, ProviderMessageIDs: ids})
	}
	return nil
}

func (s *service) emitReadReceipt(remoteID string, maxID int) {
	if remoteID == "" || maxID <= 0 {
		return
	}
	s.mu.Lock()
	if maxID <= s.readOutboxMax[remoteID] {
		s.mu.Unlock()
		return
	}
	s.readOutboxMax[remoteID] = maxID
	s.mu.Unlock()
	s.out.event("messages-read", readReceipt{RemoteID: remoteID, MaxID: maxID})
}

func (s *service) handleReadHistoryOutbox(_ context.Context, _ tg.Entities, update *tg.UpdateReadHistoryOutbox) error {
	remoteID, ok := remoteIDFromPeer(update.Peer)
	if ok {
		s.emitReadReceipt(remoteID, update.MaxID)
	}
	return nil
}

func (s *service) handleReadChannelOutbox(_ context.Context, _ tg.Entities, update *tg.UpdateReadChannelOutbox) error {
	s.emitReadReceipt(fmt.Sprintf("channel:%d", update.ChannelID), update.MaxID)
	return nil
}

func (s *service) handle(req rpcRequest) (any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	switch req.Method {
	case "configure":
		var params struct {
			APIID       int    `json:"apiId"`
			APIHash     string `json:"apiHash"`
			SessionPath string `json:"sessionPath"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, s.configure(params.APIID, params.APIHash, params.SessionPath)
	case "auth.submit":
		var params struct {
			Kind  string `json:"kind"`
			Value string `json:"value"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, s.auth.submit(params.Kind, params.Value)
	case "conversations.list":
		items, err := s.listConversations(ctx)
		return map[string]any{"conversations": items}, err
	case "messages.load":
		var params struct {
			RemoteID string `json:"remoteId"`
			Limit    int    `json:"limit"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		items, err := s.loadMessages(ctx, params.RemoteID, params.Limit)
		return map[string]any{"messages": items}, err
	case "messages.send":
		var params struct {
			RemoteID string `json:"remoteId"`
			Text     string `json:"text"`
			ClientID string `json:"clientId"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		if strings.TrimSpace(params.Text) == "" {
			return nil, errors.New("message is empty")
		}
		return map[string]bool{"ok": true}, s.sendText(ctx, params.RemoteID, params.Text, params.ClientID)
	case "media.download":
		var params struct {
			RemoteID          string `json:"remoteId"`
			ProviderMessageID string `json:"providerMessageId"`
			MediaIndex        int    `json:"mediaIndex"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return s.downloadMedia(ctx, params.RemoteID, params.ProviderMessageID, params.MediaIndex)
	case "media.send":
		var params struct {
			RemoteID string `json:"remoteId"`
			Path     string `json:"path"`
			FileName string `json:"fileName"`
			MIMEType string `json:"mimeType"`
			Caption  string `json:"caption"`
			ClientID string `json:"clientId"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, s.sendMedia(ctx, params.RemoteID, params.Path, params.FileName, params.MIMEType, params.Caption, params.ClientID)
	default:
		return nil, fmt.Errorf("unknown method %q", req.Method)
	}
}

func main() {
	out := &writer{w: bufio.NewWriter(os.Stdout)}
	service := newService(out)
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var req rpcRequest
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			out.response("", nil, err)
			continue
		}
		result, err := service.handle(req)
		out.response(req.ID, result, err)
	}
	service.mu.Lock()
	if service.cancel != nil {
		service.cancel()
	}
	service.mu.Unlock()
}
