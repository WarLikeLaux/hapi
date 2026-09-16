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
	"strings"
	"sync"
	"time"

	"github.com/gotd/td/session"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/telegram/auth"
	"github.com/gotd/td/telegram/downloader"
	"github.com/gotd/td/telegram/message"
	messagepeer "github.com/gotd/td/telegram/message/peer"
	"github.com/gotd/td/telegram/query"
	"github.com/gotd/td/telegram/query/dialogs"
	"github.com/gotd/td/telegram/thumbnail"
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
	ID                 string  `json:"id"`
	Provider           string  `json:"provider"`
	RemoteID           string  `json:"remoteId"`
	Title              string  `json:"title"`
	Kind               string  `json:"kind"`
	Selected           bool    `json:"selected"`
	LastMessageAt      *int64  `json:"lastMessageAt"`
	LastMessagePreview *string `json:"lastMessagePreview"`
	UnreadCount        int     `json:"unreadCount"`
	AvatarDataURL      *string `json:"avatarDataUrl"`
}

type externalMedia struct {
	Kind             string  `json:"kind"`
	MIMEType         *string `json:"mimeType"`
	FileName         *string `json:"fileName"`
	Size             *int64  `json:"size"`
	ThumbnailDataURL *string `json:"thumbnailDataUrl"`
}

type externalMessage struct {
	ID                string          `json:"id"`
	ConversationID    string          `json:"conversationId"`
	ProviderMessageID string          `json:"providerMessageId"`
	SenderID          *string         `json:"senderId"`
	SenderName        *string         `json:"senderName"`
	Direction         string          `json:"direction"`
	Text              string          `json:"text"`
	CreatedAt         int64           `json:"createdAt"`
	EditedAt          *int64          `json:"editedAt"`
	Media             []externalMedia `json:"media"`
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
	out        *writer
	auth       *interactiveAuth
	mu         sync.RWMutex
	client     *telegram.Client
	raw        *tg.Client
	cancel     context.CancelFunc
	self       *tg.User
	peers      map[string]tg.InputPeerClass
	peerTitles map[string]string
	avatars    map[string]string
}

func newService(out *writer) *service {
	a := &interactiveAuth{out: out, inputs: make(chan authInput, 1)}
	return &service{
		out:        out,
		auth:       a,
		peers:      make(map[string]tg.InputPeerClass),
		peerTitles: make(map[string]string),
		avatars:    make(map[string]string),
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
	downloadCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
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
			}
		}
		mime := document.MimeType
		size := document.Size
		return []externalMedia{{
			Kind:             kind,
			MIMEType:         nullableString(mime),
			FileName:         nullableString(fileName),
			Size:             &size,
			ThumbnailDataURL: thumbnailDataURL(document.Thumbs),
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
		if dialog, ok := elem.Dialog.(*tg.Dialog); ok {
			unread = dialog.UnreadCount
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
			ID:                 conversationID(remoteID),
			Provider:           "telegram",
			RemoteID:           remoteID,
			Title:              title,
			Kind:               kind,
			LastMessageAt:      lastAt,
			LastMessagePreview: preview,
			UnreadCount:        unread,
			AvatarDataURL:      avatar,
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

func messageFromTelegram(msg *tg.Message, entities messagepeer.Entities, self *tg.User) (externalMessage, bool) {
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
		ID:                conversationID(remoteID) + ":" + providerMessageID,
		ConversationID:    conversationID(remoteID),
		ProviderMessageID: providerMessageID,
		SenderID:          senderID,
		SenderName:        senderName,
		Direction:         direction,
		Text:              text,
		CreatedAt:         int64(msg.Date) * 1000,
		Media:             media,
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
	s.mu.RUnlock()
	result := make([]externalMessage, 0, limit)
	for len(result) < limit && iter.Next(ctx) {
		elem := iter.Value()
		msg, ok := elem.Msg.(*tg.Message)
		if !ok {
			continue
		}
		converted, ok := messageFromTelegram(msg, elem.Entities, self)
		if ok {
			result = append(result, converted)
		}
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}
	return result, nil
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
	if clientID != "" {
		hash := sha256.Sum256([]byte(clientID))
		randomID := int64(binary.LittleEndian.Uint64(hash[:8]))
		if randomID == 0 {
			randomID = 1
		}
		builder.RandomID(randomID)
	}
	_, err = builder.Text(ctx, text)
	return err
}

func (s *service) handleNewMessage(_ context.Context, entities tg.Entities, update *tg.UpdateNewMessage) error {
	msg, ok := update.Message.(*tg.Message)
	if !ok {
		return nil
	}
	s.mu.RLock()
	self := s.self
	s.mu.RUnlock()
	converted, ok := messageFromTelegram(msg, messagepeer.EntitiesFromUpdate(entities), self)
	if !ok {
		return nil
	}
	s.out.event("message", converted)
	return nil
}

func (s *service) handle(req rpcRequest) (any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
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
