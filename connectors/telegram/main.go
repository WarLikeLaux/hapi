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
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

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
	Emoji            string  `json:"emoji,omitempty"`
	IsEmojiEffect    bool    `json:"isEmojiEffect,omitempty"`
	Duration         *int64  `json:"duration,omitempty"`
	// Waveform carries Telegram's packed voice waveform — 5-bit amplitudes,
	// 8 values per 5 bytes — base64-encoded so clients can draw it before the
	// audio itself downloads.
	Waveform string `json:"waveform,omitempty"`
}

type deletedMessages struct {
	RemoteID           *string  `json:"remoteId,omitempty"`
	ProviderMessageIDs []string `json:"providerMessageIds"`
}

type readReceipt struct {
	RemoteID string `json:"remoteId"`
	MaxID    int    `json:"maxId"`
}

type inboxRead struct {
	RemoteID    string `json:"remoteId"`
	UnreadCount int    `json:"unreadCount"`
}

type messageReactions struct {
	RemoteID          string             `json:"remoteId"`
	ProviderMessageID string             `json:"providerMessageId"`
	Reactions         []externalReaction `json:"reactions"`
}

type externalReaction struct {
	Reaction string  `json:"reaction"`
	Emoji    *string `json:"emoji"`
	Count    int     `json:"count"`
	Chosen   bool    `json:"chosen"`
}

type downloadedMedia struct {
	Path     string `json:"path"`
	MIMEType string `json:"mimeType"`
	FileName string `json:"fileName"`
	Size     int64  `json:"size"`
}

const maxMediaCacheBytes int64 = 1024 * 1024 * 1024

type externalButton struct {
	// ID is positional ("row:col") and resolved against the message's current
	// markup at press time, so the callback data never leaves the connector.
	ID   string  `json:"id"`
	Text string  `json:"text"`
	Kind string  `json:"kind"`
	URL  *string `json:"url,omitempty"`
}

type externalMessage struct {
	ID                       string               `json:"id"`
	ConversationID           string               `json:"conversationId"`
	ProviderMessageID        string               `json:"providerMessageId"`
	SenderID                 *string              `json:"senderId"`
	SenderName               *string              `json:"senderName"`
	SenderAvatarDataURL      *string              `json:"senderAvatarDataUrl"`
	Direction                string               `json:"direction"`
	Text                     string               `json:"text"`
	TextLinks                []externalTextLink   `json:"textLinks,omitempty"`
	Forward                  *externalForward     `json:"forward,omitempty"`
	LinkPreview              *externalLinkPreview `json:"linkPreview,omitempty"`
	CreatedAt                int64                `json:"createdAt"`
	EditedAt                 *int64               `json:"editedAt"`
	DeliveryStatus           *string              `json:"deliveryStatus,omitempty"`
	ReplyToProviderMessageID string               `json:"replyToProviderMessageId,omitempty"`
	ReplyToSenderName        *string              `json:"replyToSenderName,omitempty"`
	ReplyToText              *string              `json:"replyToText,omitempty"`
	Media                    []externalMedia      `json:"media"`
	Reactions                []externalReaction   `json:"reactions"`
	Buttons                  [][]externalButton   `json:"buttons,omitempty"`
}

type externalTextLink struct {
	Offset int    `json:"offset"`
	Length int    `json:"length"`
	URL    string `json:"url"`
}

type externalForward struct {
	SourceName          *string `json:"sourceName"`
	SourceURL           string  `json:"sourceUrl,omitempty"`
	SourceAvatarDataURL *string `json:"sourceAvatarDataUrl,omitempty"`
	Author              string  `json:"author,omitempty"`
}

type externalLinkPreview struct {
	URL         string `json:"url"`
	SiteName    string `json:"siteName,omitempty"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	MediaIndex  *int   `json:"mediaIndex,omitempty"`
}

func forwardFromTelegram(msg *tg.Message, entities messagepeer.Entities, self *tg.User) *externalForward {
	header, ok := msg.GetFwdFrom()
	if !ok {
		return nil
	}
	result := &externalForward{SourceName: nullableString(header.FromName), Author: header.PostAuthor}
	if candidate := forwardAvatarCandidateForMessage(msg, entities, self); candidate != nil {
		result.SourceAvatarDataURL = candidate.placeholder
	}
	if header.FromID != nil {
		source := &tg.Message{}
		source.SetFromID(header.FromID)
		_, name := senderData(source, entities, self)
		if name != nil {
			result.SourceName = name
		}
		if peer, ok := header.FromID.(*tg.PeerChannel); ok {
			if channel, found := entities.Channel(peer.ChannelID); found && channel.Username != "" {
				result.SourceURL = "https://t.me/" + channel.Username
				if header.ChannelPost > 0 {
					result.SourceURL += "/" + strconv.Itoa(header.ChannelPost)
				}
			}
		}
	}
	return result
}

func linkPreviewFromTelegram(media tg.MessageMediaClass) *externalLinkPreview {
	value, ok := media.(*tg.MessageMediaWebPage)
	if !ok {
		return nil
	}
	page, ok := value.Webpage.(*tg.WebPage)
	if !ok || page.URL == "" {
		return nil
	}
	result := &externalLinkPreview{URL: page.URL, SiteName: page.SiteName, Title: page.Title, Description: page.Description}
	if _, ok := page.Photo.(*tg.Photo); ok {
		index := 0
		result.MediaIndex = &index
	}
	return result
}

func textLinksFromTelegram(msg *tg.Message) []externalTextLink {
	var result []externalTextLink
	units := utf16.Encode([]rune(msg.Message))
	for _, entity := range msg.Entities {
		if link, ok := entity.(*tg.MessageEntityTextURL); ok && link.Offset >= 0 && link.Length > 0 && link.Offset <= len(units) && link.Length <= len(units)-link.Offset {
			result = append(result, externalTextLink{Offset: link.Offset, Length: link.Length, URL: link.URL})
		}
	}
	return result
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

type buttonWatchKey struct {
	remoteID  string
	messageID int
}

type service struct {
	out            *writer
	auth           *interactiveAuth
	mu             sync.RWMutex
	client         *telegram.Client
	raw            *tg.Client
	cancel         context.CancelFunc
	runCtx         context.Context
	buttonWatches  map[buttonWatchKey]context.CancelFunc
	self           *tg.User
	peers          map[string]tg.InputPeerClass
	peerTitles     map[string]string
	avatars        map[string]string
	readOutboxMax  map[string]int
	sessionPath    string
	emojiDocuments map[string]*tg.Document
	emojiEffects   map[string]*tg.Document
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
		runCtx:        context.Background(),
		buttonWatches: make(map[buttonWatchKey]context.CancelFunc),
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
		var audioDuration int
		var audioWaveform []byte
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
			case *tg.DocumentAttributeAudio:
				audioDuration = attribute.Duration
				audioWaveform = attribute.Waveform
			}
		}
		if isAnimated && kind != "sticker" {
			kind = "video"
		}
		mime := document.MimeType
		size := document.Size
		media := externalMedia{
			Kind:             kind,
			MIMEType:         nullableString(mime),
			FileName:         nullableString(fileName),
			Size:             &size,
			ThumbnailDataURL: thumbnailDataURL(document.Thumbs),
			IsRound:          isRound,
			IsAnimated:       isAnimated,
		}
		if kind == "voice" || kind == "audio" {
			duration := int64(audioDuration)
			media.Duration = &duration
			media.Waveform = base64.StdEncoding.EncodeToString(audioWaveform)
		}
		return []externalMedia{media}
	case *tg.MessageMediaGeo, *tg.MessageMediaGeoLive, *tg.MessageMediaVenue:
		return []externalMedia{{Kind: "location"}}
	case *tg.MessageMediaContact:
		return []externalMedia{{Kind: "contact"}}
	case *tg.MessageMediaPoll:
		return []externalMedia{{Kind: "poll"}}
	case *tg.MessageMediaWebPage:
		if page, ok := value.Webpage.(*tg.WebPage); ok {
			if photo, ok := page.Photo.(*tg.Photo); ok {
				mime := "image/jpeg"
				return []externalMedia{{Kind: "image", MIMEType: &mime, ThumbnailDataURL: thumbnailDataURL(photo.Sizes)}}
			}
		}
		return nil
	case *tg.MessageMediaEmpty:
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
		if media[0].IsAnimated {
			// Telegram delivers GIFs as silent animated MP4 documents; calling
			// them "Video" in previews and reply quotes reads as a bug.
			return "GIF"
		}
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

// replyTargetID reports the Telegram message a given message replies to, if any.
// Forum topics give every message a reply header pointing at the topic root, so
// those are only a real reply when the topic-root cursor (ReplyToTopID) is also
// set alongside the replied-to message ID.
func replyTargetID(msg *tg.Message) (int, bool) {
	header, ok := msg.GetReplyTo()
	if !ok {
		return 0, false
	}
	reply, ok := header.(*tg.MessageReplyHeader)
	if !ok || reply.ReplyToMsgID <= 0 {
		return 0, false
	}
	if reply.ForumTopic && reply.ReplyToTopID == 0 {
		return 0, false
	}
	return reply.ReplyToMsgID, true
}

// replyQuote is the snippet the web UI shows for the message being replied to.
type replyQuote struct {
	senderName *string
	text       *string
}

func replyQuoteForTelegram(msg *tg.Message, entities messagepeer.Entities, self *tg.User) replyQuote {
	_, senderName := senderData(msg, entities, self)
	text := strings.TrimSpace(msg.Message)
	if text == "" {
		text = mediaPreview(mediaFromTelegram(msg.Media))
	}
	if text == "" {
		text = "Message"
	}
	return replyQuote{senderName: senderName, text: &text}
}

var markdownLinkPattern = regexp.MustCompile(`\[([^\[\]]+)\]\((https?://[^\s)]+)\)`)
var bareURLPattern = regexp.MustCompile(`https?://[^\s<>"'` + "`" + `]+`)

// linkSegment is a run of message text: plain prose when URL is empty, a bare
// URL when text equals URL, or a labelled markdown-style link otherwise.
type linkSegment struct {
	text string
	url  string
}

// trimBareURL strips trailing sentence punctuation and unmatched closing
// brackets that prose places after a URL while keeping balanced ones.
func trimBareURL(url string) string {
	trimmed := strings.TrimRight(url, ".,;:!?…")
	for len(trimmed) > 0 {
		runes := []rune(trimmed)
		switch runes[len(runes)-1] {
		case ')':
			if strings.Count(trimmed, ")") <= strings.Count(trimmed, "(") {
				return trimmed
			}
		case ']':
			if strings.Count(trimmed, "]") <= strings.Count(trimmed, "[") {
				return trimmed
			}
		case '"', '\'', '»', '”':
		default:
			return trimmed
		}
		trimmed = string(runes[:len(runes)-1])
	}
	return trimmed
}

// linkSegments splits message text into plain runs, bare URLs and
// markdown-style [label](url) links so they can be sent as real Telegram
// entities (clickable links) instead of raw markup.
func linkSegments(text string) []linkSegment {
	var segments []linkSegment
	appendPlain := func(value string) {
		for {
			match := bareURLPattern.FindStringIndex(value)
			if match == nil {
				break
			}
			url := trimBareURL(value[match[0]:match[1]])
			segments = append(segments, linkSegment{text: value[:match[0]]})
			segments = append(segments, linkSegment{text: url, url: url})
			value = value[match[0]+len(url):]
		}
		if value != "" {
			segments = append(segments, linkSegment{text: value})
		}
	}
	rest := text
	for {
		match := markdownLinkPattern.FindStringSubmatchIndex(rest)
		if match == nil {
			break
		}
		label, url := rest[match[2]:match[3]], rest[match[4]:match[5]]
		appendPlain(rest[:match[0]])
		if strings.TrimSpace(label) == "" {
			segments = append(segments, linkSegment{text: url, url: url})
		} else {
			segments = append(segments, linkSegment{text: label, url: url})
		}
		rest = rest[match[1]:]
	}
	appendPlain(rest)
	return segments
}

// styledTextOptions converts message text into Telegram styling options where
// markdown links and bare URLs arrive as clickable link entities.
func styledTextOptions(text string) []message.StyledTextOption {
	segments := linkSegments(text)
	options := make([]message.StyledTextOption, 0, len(segments))
	for _, segment := range segments {
		switch {
		case segment.url == "":
			if segment.text == "" {
				continue
			}
			options = append(options, styling.Plain(segment.text))
		case segment.text == segment.url:
			options = append(options, styling.URL(segment.url))
		default:
			options = append(options, styling.TextURL(segment.text, segment.url))
		}
	}
	if len(options) == 0 {
		options = append(options, styling.Plain(text))
	}
	return options
}

func replyIDFromProviderMessageID(value string) (int, error) {
	if value == "" {
		return 0, errors.New("empty reply-to message ID")
	}
	id, err := strconv.Atoi(value)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid reply-to message ID %q", value)
	}
	return id, nil
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
	s.runCtx = ctx
	s.client = nil
	s.raw = nil
	s.emojiDocuments = nil
	s.emojiEffects = nil
	s.mu.Unlock()

	dispatcher := tg.NewUpdateDispatcher()
	dispatcher.OnNewMessage(s.handleNewMessage)
	dispatcher.OnNewChannelMessage(s.handleNewChannelMessage)
	dispatcher.OnEditMessage(s.handleEditMessage)
	dispatcher.OnEditChannelMessage(s.handleEditChannelMessage)
	dispatcher.OnDeleteMessages(s.handleDeleteMessages)
	dispatcher.OnDeleteChannelMessages(s.handleDeleteChannelMessages)
	dispatcher.OnReadHistoryInbox(s.handleReadHistoryInbox)
	dispatcher.OnReadChannelInbox(s.handleReadChannelInbox)
	dispatcher.OnReadHistoryOutbox(s.handleReadHistoryOutbox)
	dispatcher.OnReadChannelOutbox(s.handleReadChannelOutbox)
	dispatcher.OnMessageReactions(s.handleMessageReactions)
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
			s.loadAnimatedEmojis(runCtx, raw)
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
	// Telegram accounts often have many broadcast channels near the top of the
	// dialog list. The Hub filters unselected channels from the picker, so a
	// shallow scan can accidentally leave only a handful of actual chats.
	const maxConversations = 300
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
		// Telegram can omit from_id in private-chat history while including
		// it in live updates. Both forms must identify the same sender.
		if _, direct := msg.PeerID.(*tg.PeerUser); msg.Out || !direct {
			return nil, nil
		}
		from = msg.PeerID
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

func forwardAvatarCandidateForMessage(msg *tg.Message, entities messagepeer.Entities, self *tg.User) *senderAvatarCandidate {
	header, ok := msg.GetFwdFrom()
	if !ok || header.FromID == nil {
		return nil
	}
	var peer tg.InputPeerClass
	switch from := header.FromID.(type) {
	case *tg.PeerUser:
		source := &tg.Message{}
		source.SetFromID(from)
		return senderAvatarCandidateForMessage(source, entities, self)
	case *tg.PeerChat:
		peer = &tg.InputPeerChat{ChatID: from.ChatID}
	case *tg.PeerChannel:
		channel, found := entities.Channel(from.ChannelID)
		if !found {
			return nil
		}
		peer = &tg.InputPeerChannel{ChannelID: from.ChannelID, AccessHash: channel.AccessHash}
	default:
		return nil
	}
	elem := dialogs.Elem{Peer: peer, Entities: entities}
	photoID := avatarPhotoID(elem)
	if photoID == 0 {
		return nil
	}
	remoteID, _ := remoteIDFromPeer(header.FromID)
	return &senderAvatarCandidate{
		remoteID: remoteID, peer: peer, photoID: photoID, placeholder: avatarForDialog(elem),
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

func reactionKey(reaction tg.ReactionClass) (string, *string, bool) {
	switch value := reaction.(type) {
	case *tg.ReactionEmoji:
		return "emoji:" + value.Emoticon, &value.Emoticon, value.Emoticon != ""
	case *tg.ReactionCustomEmoji:
		return fmt.Sprintf("custom:%d", value.DocumentID), nil, value.DocumentID != 0
	case *tg.ReactionPaid:
		emoji := "⭐"
		return "paid", &emoji, true
	default:
		return "", nil, false
	}
}

func reactionsFromTelegram(reactions tg.MessageReactions) []externalReaction {
	result := make([]externalReaction, 0, len(reactions.Results))
	for _, item := range reactions.Results {
		key, emoji, ok := reactionKey(item.Reaction)
		if !ok || item.Count < 1 {
			continue
		}
		_, chosen := item.GetChosenOrder()
		result = append(result, externalReaction{
			Reaction: key,
			Emoji:    emoji,
			Count:    item.Count,
			Chosen:   chosen,
		})
	}
	return result
}

func reactionFromKey(key string) (tg.ReactionClass, error) {
	if strings.HasPrefix(key, "emoji:") {
		emoji := strings.TrimPrefix(key, "emoji:")
		if emoji == "" {
			return nil, errors.New("empty emoji reaction")
		}
		return &tg.ReactionEmoji{Emoticon: emoji}, nil
	}
	if strings.HasPrefix(key, "custom:") {
		documentID, err := strconv.ParseInt(strings.TrimPrefix(key, "custom:"), 10, 64)
		if err != nil || documentID <= 0 {
			return nil, errors.New("invalid custom emoji reaction")
		}
		return &tg.ReactionCustomEmoji{DocumentID: documentID}, nil
	}
	return nil, errors.New("unsupported reaction")
}

// The web client puts url-button targets straight into an <a href>, so only
// schemes that are safe to open remotely pass through.
func safeButtonURL(raw string) bool {
	if len(raw) > 2048 {
		return false
	}
	lower := strings.ToLower(raw)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "tg://")
}

func buttonsFromTelegram(markup tg.ReplyMarkupClass) [][]externalButton {
	inline, ok := markup.(*tg.ReplyInlineMarkup)
	if !ok {
		return nil
	}
	// Button ids carry the RAW row/column coordinates: the press path resolves
	// them against the bot's current markup, so skipping an unsupported button
	// must not shift the numbering of the ones around it.
	rows := make([][]externalButton, 0, len(inline.Rows))
	for rowIdx, row := range inline.Rows {
		buttons := make([]externalButton, 0, len(row.Buttons))
		for colIdx, button := range row.Buttons {
			switch value := button.(type) {
			case *tg.KeyboardButtonURL:
				if !safeButtonURL(value.URL) {
					continue
				}
				buttons = append(buttons, externalButton{
					ID:   fmt.Sprintf("%d:%d", rowIdx, colIdx),
					Text: value.Text,
					Kind: "url",
					URL:  &value.URL,
				})
			case *tg.KeyboardButtonCallback:
				buttons = append(buttons, externalButton{
					ID:   fmt.Sprintf("%d:%d", rowIdx, colIdx),
					Text: value.Text,
					Kind: "callback",
				})
			}
		}
		if len(buttons) > 0 {
			rows = append(rows, buttons)
		}
	}
	return rows
}

func buttonByID(markup tg.ReplyMarkupClass, buttonID string) (*tg.KeyboardButtonCallback, error) {
	inline, ok := markup.(*tg.ReplyInlineMarkup)
	if !ok {
		return nil, errors.New("this message has no inline buttons")
	}
	rowText, colText, ok := strings.Cut(buttonID, ":")
	if !ok {
		return nil, fmt.Errorf("invalid button id %q", buttonID)
	}
	row, err := strconv.Atoi(rowText)
	if err != nil || row < 0 || row >= len(inline.Rows) {
		return nil, fmt.Errorf("invalid button row in %q", buttonID)
	}
	col, err := strconv.Atoi(colText)
	if err != nil || col < 0 || col >= len(inline.Rows[row].Buttons) {
		return nil, fmt.Errorf("invalid button column in %q", buttonID)
	}
	button, ok := inline.Rows[row].Buttons[col].(*tg.KeyboardButtonCallback)
	if !ok {
		return nil, errors.New("this button cannot be pressed remotely")
	}
	return button, nil
}

func messageFromTelegram(msg *tg.Message, entities messagepeer.Entities, self *tg.User, senderAvatar *string, readOutboxMax int) (externalMessage, bool) {
	remoteID, ok := remoteIDFromPeer(msg.PeerID)
	if !ok {
		return externalMessage{}, false
	}
	text := msg.Message
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
	reactions := []externalReaction{}
	if value, ok := msg.GetReactions(); ok {
		reactions = reactionsFromTelegram(value)
	}
	var editedAt *int64
	if editDate, ok := msg.GetEditDate(); ok && editDate > 0 {
		value := int64(editDate) * 1000
		editedAt = &value
	}
	replyToProviderMessageID := ""
	if replyID, ok := replyTargetID(msg); ok {
		replyToProviderMessageID = strconv.Itoa(replyID)
	}
	return externalMessage{
		ID:                       conversationID(remoteID) + ":" + providerMessageID,
		ConversationID:           conversationID(remoteID),
		ProviderMessageID:        providerMessageID,
		SenderID:                 senderID,
		SenderName:               senderName,
		SenderAvatarDataURL:      senderAvatar,
		Direction:                direction,
		Text:                     text,
		TextLinks:                textLinksFromTelegram(msg),
		Forward:                  forwardFromTelegram(msg, entities, self),
		LinkPreview:              linkPreviewFromTelegram(msg.Media),
		CreatedAt:                int64(msg.Date) * 1000,
		EditedAt:                 editedAt,
		DeliveryStatus:           deliveryStatusForMessage(msg, readOutboxMax),
		ReplyToProviderMessageID: replyToProviderMessageID,
		Media:                    media,
		Reactions:                reactions,
		Buttons:                  buttonsFromTelegram(msg.ReplyMarkup),
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
	type avatarMessageReference struct {
		index  int
		source bool
	}
	avatarMessageIndexes := make(map[string][]avatarMessageReference)
	avatarCandidates := make(map[string]senderAvatarCandidate)
	batchQuotes := make(map[string]replyQuote)
	for len(result) < limit && iter.Next(ctx) {
		elem := iter.Value()
		msg, ok := elem.Msg.(*tg.Message)
		if !ok {
			continue
		}
		batchQuotes[strconv.Itoa(msg.ID)] = replyQuoteForTelegram(msg, elem.Entities, self)
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
			s.decorateAnimatedEmoji(msg, &converted)
			forwardCandidate := forwardAvatarCandidateForMessage(msg, elem.Entities, self)
			if forwardCandidate != nil {
				s.mu.RLock()
				cached := s.avatars[forwardCandidate.remoteID]
				s.mu.RUnlock()
				if cached != "" {
					converted.Forward.SourceAvatarDataURL = &cached
				} else if len(avatarCandidates) < 16 {
					avatarCandidates[forwardCandidate.remoteID] = *forwardCandidate
				}
				avatarMessageIndexes[forwardCandidate.remoteID] = append(avatarMessageIndexes[forwardCandidate.remoteID], avatarMessageReference{index: len(result), source: true})
			}
			result = append(result, converted)
			if candidate != nil {
				avatarMessageIndexes[candidate.remoteID] = append(avatarMessageIndexes[candidate.remoteID], avatarMessageReference{index: len(result) - 1})
			}
		}
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}
	// Fill reply quotes: prefer targets already present in the loaded batch,
	// then fall back to bounded direct lookups so replies to older messages
	// stay labelled without risking FLOOD_WAIT on reply-heavy history.
	const maxReplyLookupsPerLoad = 8
	lookups := 0
	for i := range result {
		targetID := result[i].ReplyToProviderMessageID
		if targetID == "" {
			continue
		}
		if quote, ok := batchQuotes[targetID]; ok {
			result[i].ReplyToSenderName = quote.senderName
			result[i].ReplyToText = quote.text
			continue
		}
		if lookups >= maxReplyLookupsPerLoad {
			continue
		}
		lookups++
		quote, ok := s.resolveReplyQuote(ctx, remoteID, targetID)
		if !ok {
			continue
		}
		result[i].ReplyToSenderName = quote.senderName
		result[i].ReplyToText = quote.text
	}
	avatarSlots := make(chan struct{}, 6)
	// Keep cumulative snapshots separate from the returned history: sender and
	// source photos can finish concurrently without overwriting each other or
	// mutating a response while it is being encoded.
	enriched := append([]externalMessage(nil), result...)
	var enrichMu sync.Mutex
	for remoteID, candidate := range avatarCandidates {
		remoteID, candidate := remoteID, candidate
		references := avatarMessageIndexes[remoteID]
		go func() {
			avatarSlots <- struct{}{}
			defer func() { <-avatarSlots }()
			avatar := downloadAvatar(context.WithoutCancel(ctx), raw, candidate.peer, candidate.photoID)
			if avatar == nil {
				return
			}
			s.mu.Lock()
			s.avatars[remoteID] = *avatar
			s.mu.Unlock()
			enrichMu.Lock()
			defer enrichMu.Unlock()
			for _, reference := range references {
				message := &enriched[reference.index]
				if reference.source {
					forward := *message.Forward
					forward.SourceAvatarDataURL = avatar
					message.Forward = &forward
				} else {
					message.SenderAvatarDataURL = avatar
				}
				s.out.event("message", *message)
			}
		}()
	}
	return result, nil
}

var errTelegramMessageNotFound = errors.New("Telegram message not found")

func messageByID(ctx context.Context, raw *tg.Client, peer tg.InputPeerClass, messageID int) (*tg.Message, error) {
	// Channel peers (broadcast channels and megagroups) reject
	// messages.getHistory; only channels.getMessages serves messages by id there.
	var messages []tg.MessageClass
	if channel, ok := messagepeer.ToInputChannel(peer); ok {
		result, err := raw.ChannelsGetMessages(ctx, &tg.ChannelsGetMessagesRequest{
			Channel: channel,
			ID:      []tg.InputMessageClass{&tg.InputMessageID{ID: messageID}},
		})
		if err != nil {
			return nil, err
		}
		modified, ok := result.AsModified()
		if !ok {
			return nil, errors.New("Telegram returned no message data")
		}
		messages = modified.GetMessages()
	} else {
		result, err := raw.MessagesGetHistory(ctx, &tg.MessagesGetHistoryRequest{Peer: peer, OffsetID: messageID + 1, Limit: 1})
		if err != nil {
			return nil, err
		}
		modified, ok := result.AsModified()
		if !ok {
			return nil, errors.New("Telegram returned no message data")
		}
		messages = modified.GetMessages()
	}
	for _, item := range messages {
		if msg, ok := item.(*tg.Message); ok && msg.ID == messageID {
			return msg, nil
		}
	}
	return nil, errTelegramMessageNotFound
}

// resolveReplyQuote fetches the replied-to message so outgoing/received replies
// keep a text snippet even when the target has left the loaded history window.
func (s *service) resolveReplyQuote(ctx context.Context, remoteID, providerMessageID string) (replyQuote, bool) {
	messageID, err := strconv.Atoi(providerMessageID)
	if err != nil || messageID <= 0 {
		return replyQuote{}, false
	}
	raw, err := s.ready()
	if err != nil {
		return replyQuote{}, false
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return replyQuote{}, false
	}
	msg, err := messageByID(ctx, raw, peer, messageID)
	if err != nil {
		return replyQuote{}, false
	}
	return replyQuoteForTelegram(msg, messagepeer.Entities{}, nil), true
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
	if mediaIndex < 0 || mediaIndex > 1 {
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
	if document := s.animatedEmojiDocument(msg, mediaIndex); document != nil {
		msg = &tg.Message{Media: &tg.MessageMediaDocument{Document: document}}
	} else if mediaIndex != 0 {
		return downloadedMedia{}, errors.New("media attachment not found")
	}

	var location tg.InputFileLocationClass
	mimeType, fileName := "application/octet-stream", "attachment"
	switch media := msg.Media.(type) {
	case *tg.MessageMediaWebPage:
		page, ok := media.Webpage.(*tg.WebPage)
		if !ok {
			return downloadedMedia{}, errors.New("link preview is unavailable")
		}
		photo, ok := page.Photo.(*tg.Photo)
		if !ok {
			return downloadedMedia{}, errors.New("preview photo is unavailable")
		}
		thumbType := largestPhotoType(photo.Sizes)
		if thumbType == "" {
			return downloadedMedia{}, errors.New("preview photo size is unavailable")
		}
		location = &tg.InputPhotoFileLocation{ID: photo.ID, AccessHash: photo.AccessHash, FileReference: photo.FileReference, ThumbSize: thumbType}
		mimeType, fileName = "image/jpeg", "preview.jpg"
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

func telegramPhotoUpload(data []byte, fileName, mimeType string) ([]byte, string, bool) {
	if !strings.HasPrefix(mimeType, "image/") || mimeType == "image/gif" {
		return nil, fileName, false
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 40_000_000 {
		return nil, fileName, false
	}
	base := strings.TrimSuffix(filepath.Base(fileName), filepath.Ext(fileName))
	if base == "" || base == "." {
		base = "photo"
	}
	jpegName := base + ".jpg"
	if format == "jpeg" {
		return data, jpegName, true
	}
	decoded, format, err := image.Decode(bytes.NewReader(data))
	if err != nil || format != "png" {
		return nil, fileName, false
	}
	bounds := decoded.Bounds()
	flattened := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(flattened, flattened.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(flattened, flattened.Bounds(), decoded, bounds.Min, draw.Over)
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, flattened, &jpeg.Options{Quality: 90}); err != nil {
		return nil, fileName, false
	}
	return encoded.Bytes(), jpegName, true
}

func (s *service) sendMedia(ctx context.Context, remoteID, path, fileName, mimeType, caption, clientID, replyToProviderMessageID string) error {
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
	fileName = filepath.Base(fileName)
	if fileName == "." || fileName == "" {
		fileName = "attachment" + mediaExtension("", mimeType)
	}
	var reader io.Reader
	var uploadSize = stat.Size()
	var file *os.File
	asPhoto := false
	if strings.HasPrefix(mimeType, "image/") && mimeType != "image/gif" {
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		if prepared, preparedName, ok := telegramPhotoUpload(data, fileName, mimeType); ok {
			reader = bytes.NewReader(prepared)
			uploadSize = int64(len(prepared))
			fileName = preparedName
			asPhoto = true
		}
	}
	if reader == nil {
		file, err = os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		reader = file
	}
	uploaded, err := uploader.NewUploader(raw).WithThreads(4).Upload(ctx, uploader.NewUpload(fileName, reader, uploadSize))
	if err != nil {
		return err
	}
	builder := message.NewSender(raw).To(peer)
	applyClientID(&builder.Builder, clientID)
	if replyID, err := replyIDFromProviderMessageID(replyToProviderMessageID); err == nil {
		builder.Builder.Reply(replyID)
	}
	captionOptions := []message.StyledTextOption{}
	if caption = strings.TrimSpace(caption); caption != "" {
		// Captions never expand into a web preview, so links only need the
		// clickable entities here.
		captionOptions = append(captionOptions, styledTextOptions(caption)...)
	}
	switch {
	case asPhoto:
		_, err = builder.UploadedPhoto(ctx, uploaded, captionOptions...)
	case mimeType == "image/gif":
		_, err = builder.Media(ctx, message.GIF(uploaded, captionOptions...).Filename(fileName))
	case strings.HasPrefix(mimeType, "video/"):
		_, err = builder.Video(ctx, uploaded, captionOptions...)
	case strings.HasPrefix(mimeType, "audio/"):
		_, err = builder.Audio(ctx, uploaded, captionOptions...)
	default:
		_, err = builder.File(ctx, uploaded, captionOptions...)
	}
	return err
}

func (s *service) sendText(ctx context.Context, remoteID, text, clientID, replyToProviderMessageID string) error {
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
	if replyID, err := replyIDFromProviderMessageID(replyToProviderMessageID); err == nil {
		builder.Builder.Reply(replyID)
	}
	// Links stay clickable as text entities but never expand into a web preview.
	builder.Builder.NoWebpage()
	_, err = builder.StyledText(ctx, styledTextOptions(text)...)
	return err
}

func (s *service) changeOwnMessage(ctx context.Context, remoteID, providerMessageID, text string, deleteMessage bool) error {
	raw, err := s.ready()
	if err != nil {
		return err
	}
	messageID, err := strconv.Atoi(providerMessageID)
	if err != nil || messageID <= 0 {
		return errors.New("invalid provider message ID")
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return err
	}
	msg, err := messageByID(ctx, raw, peer, messageID)
	if err != nil {
		return err
	}
	if !msg.Out {
		return errors.New("only your own messages can be changed")
	}
	builder := message.NewSender(raw).To(peer)
	if deleteMessage {
		_, err = builder.Revoke().Messages(ctx, messageID)
	} else {
		builder.Builder.NoWebpage()
		_, err = builder.Edit(messageID).StyledText(ctx, styledTextOptions(text)...)
	}
	return err
}

func (s *service) markRead(ctx context.Context, remoteID string, maxID int) error {
	raw, err := s.ready()
	if err != nil {
		return err
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return err
	}
	if channel, ok := messagepeer.ToInputChannel(peer); ok {
		_, err = raw.ChannelsReadHistory(ctx, &tg.ChannelsReadHistoryRequest{
			Channel: channel,
			MaxID:   maxID,
		})
		return err
	}
	_, err = raw.MessagesReadHistory(ctx, &tg.MessagesReadHistoryRequest{
		Peer:  peer,
		MaxID: maxID,
	})
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
	s.decorateAnimatedEmoji(msg, &converted)
	forwardCandidate := forwardAvatarCandidateForMessage(msg, entities, self)
	needsForwardAvatar := false
	if forwardCandidate != nil {
		s.mu.RLock()
		cached := s.avatars[forwardCandidate.remoteID]
		s.mu.RUnlock()
		if cached != "" {
			converted.Forward.SourceAvatarDataURL = &cached
		} else {
			needsForwardAvatar = raw != nil
		}
	}
	s.out.event("message", converted)
	needsReplyQuote := converted.ReplyToProviderMessageID != "" && raw != nil
	if !needsFullAvatar && !needsForwardAvatar && !needsReplyQuote {
		return
	}
	go func(message externalMessage, candidate *senderAvatarCandidate) {
		// The quote resolves fast, so emit it before the slower avatar refresh
		// re-emits the same message with cumulative fields.
		if message.ReplyToProviderMessageID != "" {
			if quote, ok := s.resolveReplyQuote(context.WithoutCancel(ctx), remoteID, message.ReplyToProviderMessageID); ok {
				message.ReplyToSenderName = quote.senderName
				message.ReplyToText = quote.text
				s.out.event("message", message)
			}
		}
		if needsFullAvatar {
			if fullAvatar := downloadAvatar(context.WithoutCancel(ctx), raw, candidate.peer, candidate.photoID); fullAvatar != nil {
				s.mu.Lock()
				s.avatars[candidate.remoteID] = *fullAvatar
				s.mu.Unlock()
				message.SenderAvatarDataURL = fullAvatar
				s.out.event("message", message)
			}
		}
		if needsForwardAvatar {
			if fullAvatar := downloadAvatar(context.WithoutCancel(ctx), raw, forwardCandidate.peer, forwardCandidate.photoID); fullAvatar != nil {
				s.mu.Lock()
				s.avatars[forwardCandidate.remoteID] = *fullAvatar
				s.mu.Unlock()
				forward := *message.Forward
				forward.SourceAvatarDataURL = fullAvatar
				message.Forward = &forward
				s.out.event("message", message)
			}
		}
	}(converted, candidate)
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

// Bots deliver follow-up state by editing their message (new text and a new
// inline keyboard), so edits must flow through as regular message upserts.
func (s *service) handleEditMessage(ctx context.Context, entities tg.Entities, update *tg.UpdateEditMessage) error {
	msg, ok := update.Message.(*tg.Message)
	if !ok {
		return nil
	}
	s.emitNewMessage(ctx, messagepeer.EntitiesFromUpdate(entities), msg)
	return nil
}

func (s *service) handleEditChannelMessage(ctx context.Context, entities tg.Entities, update *tg.UpdateEditChannelMessage) error {
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
	s.cancelButtonWatches("", update.Messages)
	ids := providerMessageIDs(update.Messages)
	if len(ids) > 0 {
		s.out.event("messages-deleted", deletedMessages{ProviderMessageIDs: ids})
	}
	return nil
}

func (s *service) handleDeleteChannelMessages(_ context.Context, _ tg.Entities, update *tg.UpdateDeleteChannelMessages) error {
	s.cancelButtonWatches(fmt.Sprintf("channel:%d", update.ChannelID), update.Messages)
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

func (s *service) handleReadHistoryInbox(_ context.Context, _ tg.Entities, update *tg.UpdateReadHistoryInbox) error {
	remoteID, ok := remoteIDFromPeer(update.Peer)
	if ok {
		s.out.event("inbox-read", inboxRead{RemoteID: remoteID, UnreadCount: max(update.StillUnreadCount, 0)})
	}
	return nil
}

func (s *service) handleReadChannelInbox(_ context.Context, _ tg.Entities, update *tg.UpdateReadChannelInbox) error {
	s.out.event("inbox-read", inboxRead{
		RemoteID:    fmt.Sprintf("channel:%d", update.ChannelID),
		UnreadCount: max(update.StillUnreadCount, 0),
	})
	return nil
}

func (s *service) handleReadChannelOutbox(_ context.Context, _ tg.Entities, update *tg.UpdateReadChannelOutbox) error {
	s.emitReadReceipt(fmt.Sprintf("channel:%d", update.ChannelID), update.MaxID)
	return nil
}

func (s *service) handleMessageReactions(_ context.Context, _ tg.Entities, update *tg.UpdateMessageReactions) error {
	remoteID, ok := remoteIDFromPeer(update.Peer)
	if !ok || update.MsgID <= 0 {
		return nil
	}
	s.out.event("message-reactions", messageReactions{
		RemoteID:          remoteID,
		ProviderMessageID: strconv.Itoa(update.MsgID),
		Reactions:         reactionsFromTelegram(update.Reactions),
	})
	return nil
}

func (s *service) setReactions(ctx context.Context, remoteID, providerMessageID string, keys []string) error {
	raw, err := s.ready()
	if err != nil {
		return err
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return err
	}
	messageID, err := strconv.Atoi(providerMessageID)
	if err != nil || messageID <= 0 {
		return errors.New("invalid Telegram message ID")
	}
	reactions := make([]tg.ReactionClass, 0, len(keys))
	for _, key := range keys {
		reaction, err := reactionFromKey(key)
		if err != nil {
			return err
		}
		reactions = append(reactions, reaction)
	}
	_, err = raw.MessagesSendReaction(ctx, &tg.MessagesSendReactionRequest{
		Peer:        peer,
		MsgID:       messageID,
		Reaction:    reactions,
		AddToRecent: true,
	})
	return err
}

func (s *service) cancelButtonWatches(remoteID string, messageIDs []int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, cancel := range s.buttonWatches {
		if remoteID != "" && key.remoteID != remoteID {
			continue
		}
		if remoteID == "" && strings.HasPrefix(key.remoteID, "channel:") {
			continue
		}
		for _, id := range messageIDs {
			if key.messageID == id {
				cancel()
				break
			}
		}
	}
}

// A callback answer is independent of the bot's deletion. Check only the
// pressed message for a short window in case its delete update is missed.
func (s *service) watchButtonMessage(raw *tg.Client, peer tg.InputPeerClass, remoteID string, messageID int) {
	key := buttonWatchKey{remoteID: remoteID, messageID: messageID}
	s.mu.Lock()
	if _, watching := s.buttonWatches[key]; watching {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(s.runCtx, 10*time.Second)
	s.buttonWatches[key] = cancel
	s.mu.Unlock()
	go func() {
		defer func() {
			cancel()
			s.mu.Lock()
			delete(s.buttonWatches, key)
			s.mu.Unlock()
		}()
		for _, delay := range []time.Duration{500 * time.Millisecond, time.Second, 2 * time.Second, 3 * time.Second, 3 * time.Second} {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
			_, err := messageByID(ctx, raw, peer, messageID)
			if ctx.Err() != nil {
				return
			}
			if errors.Is(err, errTelegramMessageNotFound) {
				s.out.event("messages-deleted", deletedMessages{
					RemoteID: &remoteID, ProviderMessageIDs: []string{strconv.Itoa(messageID)},
				})
				return
			}
			// Network/RPC errors are not evidence of deletion. Stop rather than
			// retrying through a flood wait or an unavailable connection.
			if err != nil {
				return
			}
		}
	}()
}

func (s *service) pressButton(ctx context.Context, remoteID, providerMessageID, buttonID string) (*string, error) {
	messageID, err := strconv.Atoi(providerMessageID)
	if err != nil || messageID <= 0 {
		return nil, errors.New("invalid Telegram message ID")
	}
	raw, err := s.ready()
	if err != nil {
		return nil, err
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return nil, err
	}
	// Re-fetch the message so the callback data matches the markup the bot has
	// right now — pressing stale data after an edit fails with BUTTON_DATA_INVALID.
	msg, err := messageByID(ctx, raw, peer, messageID)
	if errors.Is(err, errTelegramMessageNotFound) {
		// An already deleted message may still be in the hub cache. Reconcile
		// it instead of leaving a stale button with a red "not found" error.
		s.out.event("messages-deleted", deletedMessages{
			RemoteID: &remoteID, ProviderMessageIDs: []string{providerMessageID},
		})
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	button, err := buttonByID(msg.ReplyMarkup, buttonID)
	if err != nil {
		return nil, err
	}
	// Start before waiting for the answer: bots may delete without answering,
	// in which case Telegram eventually returns BOT_RESPONSE_TIMEOUT.
	s.watchButtonMessage(raw, peer, remoteID, messageID)
	answer, err := raw.MessagesGetBotCallbackAnswer(ctx, &tg.MessagesGetBotCallbackAnswerRequest{
		Peer:  peer,
		MsgID: messageID,
		Data:  button.Data,
	})
	if err != nil {
		return nil, err
	}
	return nullableString(answer.Message), nil
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
	case "messages.read":
		var params struct {
			RemoteID             string `json:"remoteId"`
			MaxProviderMessageID int    `json:"maxProviderMessageId"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		if params.MaxProviderMessageID <= 0 {
			return nil, errors.New("invalid max provider message ID")
		}
		return map[string]bool{"ok": true}, s.markRead(ctx, params.RemoteID, params.MaxProviderMessageID)
	case "messages.send":
		var params struct {
			RemoteID                 string `json:"remoteId"`
			Text                     string `json:"text"`
			ClientID                 string `json:"clientId"`
			ReplyToProviderMessageID string `json:"replyToProviderMessageId"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		if strings.TrimSpace(params.Text) == "" {
			return nil, errors.New("message is empty")
		}
		if _, err := replyIDFromProviderMessageID(params.ReplyToProviderMessageID); params.ReplyToProviderMessageID != "" && err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, s.sendText(ctx, params.RemoteID, params.Text, params.ClientID, params.ReplyToProviderMessageID)
	case "messages.edit", "messages.delete":
		var params struct {
			RemoteID          string `json:"remoteId"`
			ProviderMessageID string `json:"providerMessageId"`
			Text              string `json:"text"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		if req.Method == "messages.edit" && strings.TrimSpace(params.Text) == "" {
			return nil, errors.New("message is empty")
		}
		return map[string]bool{"ok": true}, s.changeOwnMessage(ctx, params.RemoteID, params.ProviderMessageID, params.Text, req.Method == "messages.delete")
	case "messages.reactions.set":
		var params struct {
			RemoteID          string   `json:"remoteId"`
			ProviderMessageID string   `json:"providerMessageId"`
			Reactions         []string `json:"reactions"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		if len(params.Reactions) > 3 {
			return nil, errors.New("too many reactions")
		}
		return map[string]bool{"ok": true}, s.setReactions(ctx, params.RemoteID, params.ProviderMessageID, params.Reactions)
	case "messages.button.press":
		var params struct {
			RemoteID          string `json:"remoteId"`
			ProviderMessageID string `json:"providerMessageId"`
			ButtonID          string `json:"buttonId"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		alert, err := s.pressButton(ctx, params.RemoteID, params.ProviderMessageID, params.ButtonID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "message": alert}, nil
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
			RemoteID                 string `json:"remoteId"`
			Path                     string `json:"path"`
			FileName                 string `json:"fileName"`
			MIMEType                 string `json:"mimeType"`
			Caption                  string `json:"caption"`
			ClientID                 string `json:"clientId"`
			ReplyToProviderMessageID string `json:"replyToProviderMessageId"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, err
		}
		if _, err := replyIDFromProviderMessageID(params.ReplyToProviderMessageID); params.ReplyToProviderMessageID != "" && err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, s.sendMedia(ctx, params.RemoteID, params.Path, params.FileName, params.MIMEType, params.Caption, params.ClientID, params.ReplyToProviderMessageID)
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
