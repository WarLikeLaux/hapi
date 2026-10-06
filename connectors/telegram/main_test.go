package main

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/gotd/td/telegram/message/entity"
	messagepeer "github.com/gotd/td/telegram/message/peer"
	"github.com/gotd/td/telegram/message/styling"
	"github.com/gotd/td/tg"
)

func TestRemoteIDFromInput(t *testing.T) {
	tests := []struct {
		peer tg.InputPeerClass
		id   string
		kind string
	}{
		{&tg.InputPeerSelf{}, "self", "saved"},
		{&tg.InputPeerUser{UserID: 42}, "user:42", "direct"},
		{&tg.InputPeerChat{ChatID: 7}, "chat:7", "group"},
		{&tg.InputPeerChannel{ChannelID: 9}, "channel:9", "channel"},
	}
	for _, test := range tests {
		id, kind, ok := remoteIDFromInput(test.peer)
		if !ok || id != test.id || kind != test.kind {
			t.Fatalf("remoteIDFromInput(%T) = %q, %q, %v", test.peer, id, kind, ok)
		}
	}
}

func TestMessageFromTelegram(t *testing.T) {
	msg := &tg.Message{
		ID:      11,
		Out:     true,
		PeerID:  &tg.PeerUser{UserID: 42},
		Message: "hello",
		Date:    123,
	}
	result, ok := messageFromTelegram(msg, messageEntities(), &tg.User{ID: 1, FirstName: "Me"}, nil, 10)
	if !ok {
		t.Fatal("message was not converted")
	}
	if result.ConversationID != "telegram:user:42" || result.Direction != "outgoing" || result.CreatedAt != 123000 {
		t.Fatalf("unexpected message: %#v", result)
	}
	if result.DeliveryStatus == nil || *result.DeliveryStatus != "sent" {
		t.Fatalf("expected sent delivery status, got %#v", result.DeliveryStatus)
	}
	read, ok := messageFromTelegram(msg, messageEntities(), &tg.User{ID: 1, FirstName: "Me"}, nil, 11)
	if !ok || read.DeliveryStatus == nil || *read.DeliveryStatus != "read" {
		t.Fatalf("expected read delivery status, got %#v", read.DeliveryStatus)
	}
}

func TestMessageFromTelegramIncludesReactions(t *testing.T) {
	chosen := tg.ReactionCount{
		Reaction: &tg.ReactionEmoji{Emoticon: "👍"},
		Count:    2,
	}
	chosen.Flags.Set(0)
	msg := &tg.Message{
		ID:      12,
		PeerID:  &tg.PeerUser{UserID: 42},
		Message: "hello",
		Date:    124,
	}
	msg.SetReactions(tg.MessageReactions{Results: []tg.ReactionCount{
		chosen,
		{Reaction: &tg.ReactionCustomEmoji{DocumentID: 99}, Count: 1},
	}})

	result, ok := messageFromTelegram(msg, messageEntities(), nil, nil, 0)
	if !ok || len(result.Reactions) != 2 {
		t.Fatalf("unexpected reactions: %#v", result.Reactions)
	}
	if result.Reactions[0].Reaction != "emoji:👍" || !result.Reactions[0].Chosen || result.Reactions[0].Count != 2 {
		t.Fatalf("unexpected emoji reaction: %#v", result.Reactions[0])
	}
	if result.Reactions[1].Reaction != "custom:99" || result.Reactions[1].Emoji != nil {
		t.Fatalf("unexpected custom reaction: %#v", result.Reactions[1])
	}
}

func TestReactionFromKey(t *testing.T) {
	emoji, err := reactionFromKey("emoji:🔥")
	if err != nil || emoji.(*tg.ReactionEmoji).Emoticon != "🔥" {
		t.Fatalf("unexpected emoji reaction: %#v, %v", emoji, err)
	}
	custom, err := reactionFromKey("custom:42")
	if err != nil || custom.(*tg.ReactionCustomEmoji).DocumentID != 42 {
		t.Fatalf("unexpected custom reaction: %#v, %v", custom, err)
	}
	if _, err := reactionFromKey("paid"); err == nil {
		t.Fatal("paid reaction should not be accepted by messages.sendReaction")
	}
}

func TestTelegramPhotoUploadConvertsPNGToJPEG(t *testing.T) {
	input := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	input.Set(0, 0, color.NRGBA{R: 255, A: 255})
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, input); err != nil {
		t.Fatal(err)
	}

	result, name, ok := telegramPhotoUpload(pngData.Bytes(), "clipboard.png", "image/png")
	if !ok || name != "clipboard.jpg" {
		t.Fatalf("unexpected prepared photo: name=%q ok=%v", name, ok)
	}
	if _, err := jpeg.Decode(bytes.NewReader(result)); err != nil {
		t.Fatalf("prepared photo is not JPEG: %v", err)
	}
}

func TestTelegramPhotoUploadFallsBackForInvalidImage(t *testing.T) {
	if _, name, ok := telegramPhotoUpload([]byte("not an image"), "broken.png", "image/png"); ok || name != "broken.png" {
		t.Fatalf("invalid image should fall back to a file: name=%q ok=%v", name, ok)
	}
}

func TestChannelDialogKind(t *testing.T) {
	if _, ok := channelDialogKind(&tg.Channel{Broadcast: true}); ok {
		t.Fatal("broadcast-only channel should be excluded")
	}
	if kind, ok := channelDialogKind(&tg.Channel{Megagroup: true}); !ok || kind != "group" {
		t.Fatalf("megagroup should be included as group, got %q, %v", kind, ok)
	}
}

func TestMessageFromTelegramPreservesMediaKind(t *testing.T) {
	msg := &tg.Message{
		ID:     12,
		PeerID: &tg.PeerUser{UserID: 42},
		Date:   124,
		Media: &tg.MessageMediaDocument{
			Voice: true,
			Document: &tg.Document{
				MimeType: "audio/ogg",
				Size:     512,
			},
		},
	}
	result, ok := messageFromTelegram(msg, messageEntities(), nil, nil, 0)
	if !ok || len(result.Media) != 1 || result.Media[0].Kind != "voice" || result.Text != "" {
		t.Fatalf("unexpected media message: %#v", result)
	}
}

func TestSenderAvatarCandidateFromMessageEntities(t *testing.T) {
	user := &tg.User{
		ID:         42,
		AccessHash: 99,
		Photo:      &tg.UserProfilePhoto{PhotoID: 123},
	}
	entities := messagepeer.NewEntities(
		map[int64]*tg.User{42: user},
		map[int64]*tg.Chat{},
		map[int64]*tg.Channel{},
	)
	message := &tg.Message{PeerID: &tg.PeerChat{ChatID: 7}}
	message.SetFromID(&tg.PeerUser{UserID: 42})
	candidate := senderAvatarCandidateForMessage(message, entities, nil)
	if candidate == nil || candidate.remoteID != "user:42" || candidate.photoID != 123 {
		t.Fatalf("unexpected avatar candidate: %#v", candidate)
	}
	peer, ok := candidate.peer.(*tg.InputPeerUser)
	if !ok || peer.UserID != 42 || peer.AccessHash != 99 {
		t.Fatalf("unexpected avatar peer: %#v", candidate.peer)
	}
}

func TestMediaFromTelegramMarksRoundVideo(t *testing.T) {
	media := mediaFromTelegram(&tg.MessageMediaDocument{
		Round:    true,
		Document: &tg.Document{MimeType: "video/mp4", Size: 1024},
	})
	if len(media) != 1 || media[0].Kind != "video" || !media[0].IsRound {
		t.Fatalf("unexpected round video metadata: %#v", media)
	}
}

func TestMediaFromTelegramMarksAnimatedDocument(t *testing.T) {
	media := mediaFromTelegram(&tg.MessageMediaDocument{
		Document: &tg.Document{
			MimeType:   "video/mp4",
			Size:       2048,
			Attributes: []tg.DocumentAttributeClass{&tg.DocumentAttributeAnimated{}},
		},
	})
	if len(media) != 1 || media[0].Kind != "video" || !media[0].IsAnimated {
		t.Fatalf("unexpected animated document metadata: %#v", media)
	}
}

func TestProviderMessageIDs(t *testing.T) {
	ids := providerMessageIDs([]int{7, 0, -1, 42})
	if len(ids) != 2 || ids[0] != "7" || ids[1] != "42" {
		t.Fatalf("unexpected provider message ids: %#v", ids)
	}
}

func TestPruneMediaCacheUsesLRUAndKeepsCurrentFile(t *testing.T) {
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "old.mp4")
	currentPath := filepath.Join(dir, "current.mp4")
	newPath := filepath.Join(dir, "new.mp4")
	for _, path := range []string{oldPath, currentPath, newPath} {
		if err := os.WriteFile(path, []byte("12345"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	_ = os.Chtimes(oldPath, now.Add(-3*time.Hour), now.Add(-3*time.Hour))
	_ = os.Chtimes(currentPath, now.Add(-2*time.Hour), now.Add(-2*time.Hour))
	_ = os.Chtimes(newPath, now.Add(-time.Hour), now.Add(-time.Hour))

	if err := pruneMediaCache(dir, 10, currentPath); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Fatalf("expected oldest cache file to be removed, got %v", err)
	}
	if _, err := os.Stat(currentPath); err != nil {
		t.Fatalf("expected current cache file to be kept: %v", err)
	}
	if _, err := os.Stat(newPath); err != nil {
		t.Fatalf("expected newer cache file to be kept: %v", err)
	}
}

func TestLargestPhotoType(t *testing.T) {
	result := largestPhotoType([]tg.PhotoSizeClass{
		&tg.PhotoSize{Type: "m", W: 320, H: 320},
		&tg.PhotoSizeProgressive{Type: "y", W: 1280, H: 720},
		&tg.PhotoStrippedSize{Type: "i", Bytes: []byte{1}},
	})
	if result != "y" {
		t.Fatalf("expected largest photo type y, got %q", result)
	}
}

func TestReplyTargetID(t *testing.T) {
	if _, ok := replyTargetID(&tg.Message{ID: 5}); ok {
		t.Fatal("message without a reply header is not a reply")
	}
	reply := &tg.Message{ID: 6}
	reply.SetReplyTo(&tg.MessageReplyHeader{ReplyToMsgID: 9})
	if id, ok := replyTargetID(reply); !ok || id != 9 {
		t.Fatalf("expected reply target 9, got %d, %v", id, ok)
	}
	topicMessage := &tg.Message{ID: 7}
	topicMessage.SetReplyTo(&tg.MessageReplyHeader{ForumTopic: true, ReplyToMsgID: 3})
	if _, ok := replyTargetID(topicMessage); ok {
		t.Fatal("forum topic membership should not look like a reply")
	}
	topicReply := &tg.Message{ID: 8}
	topicReply.SetReplyTo(&tg.MessageReplyHeader{ForumTopic: true, ReplyToMsgID: 4, ReplyToTopID: 3})
	if id, ok := replyTargetID(topicReply); !ok || id != 4 {
		t.Fatalf("expected forum reply target 4, got %d, %v", id, ok)
	}
}

func TestMessageFromTelegramCarriesReplyTo(t *testing.T) {
	msg := &tg.Message{
		ID:      20,
		PeerID:  &tg.PeerUser{UserID: 42},
		Message: "answer",
		Date:    125,
	}
	msg.SetReplyTo(&tg.MessageReplyHeader{ReplyToMsgID: 7})
	result, ok := messageFromTelegram(msg, messageEntities(), nil, nil, 0)
	if !ok {
		t.Fatal("message was not converted")
	}
	if result.ReplyToProviderMessageID != "7" {
		t.Fatalf("expected replyToProviderMessageId 7, got %q", result.ReplyToProviderMessageID)
	}
}

func TestReplyQuoteForTelegram(t *testing.T) {
	quote := replyQuoteForTelegram(&tg.Message{
		ID:      7,
		PeerID:  &tg.PeerUser{UserID: 42},
		Message: "original text",
		Date:    100,
	}, messageEntities(), nil)
	if quote.text == nil || *quote.text != "original text" || quote.senderName != nil {
		t.Fatalf("unexpected text quote: %#v", quote)
	}
	mediaQuote := replyQuoteForTelegram(&tg.Message{
		ID:     8,
		PeerID: &tg.PeerUser{UserID: 42},
		Date:   101,
		Media:  &tg.MessageMediaPhoto{Photo: &tg.Photo{ID: 1}},
	}, messageEntities(), nil)
	if mediaQuote.text == nil || *mediaQuote.text != "Photo" {
		t.Fatalf("unexpected media quote: %#v", mediaQuote)
	}
}

func styledMessage(t *testing.T, text string) (string, []tg.MessageEntityClass) {
	t.Helper()
	builder := &entity.Builder{}
	if err := styling.Perform(builder, styledTextOptions(text)...); err != nil {
		t.Fatal(err)
	}
	return builder.Complete()
}

func TestStyledTextOptionsMarkdownLink(t *testing.T) {
	message, entities := styledMessage(t, "смотри [док](https://example.com/a) и ещё")
	if message != "смотри док и ещё" {
		t.Fatalf("unexpected message text: %q", message)
	}
	if len(entities) != 1 {
		t.Fatalf("expected one link entity, got %#v", entities)
	}
	textURL, ok := entities[0].(*tg.MessageEntityTextURL)
	if !ok || textURL.URL != "https://example.com/a" {
		t.Fatalf("unexpected text URL entity: %#v", entities[0])
	}
	if offset, length := textURL.Offset, textURL.Length; offset != 7 || length != 3 || utf16Window(message, offset, length) != "док" {
		t.Fatalf("unexpected entity window %d:%d over %q", offset, length, message)
	}
}

func TestStyledTextOptionsBareURL(t *testing.T) {
	message, entities := styledMessage(t, "открой https://example.org/b. Потом продолжим")
	// The trailing sentence dot stays in the message text but is excluded
	// from the clickable URL entity.
	if message != "открой https://example.org/b. Потом продолжим" {
		t.Fatalf("unexpected message text: %q", message)
	}
	if len(entities) != 1 {
		t.Fatalf("expected one URL entity, got %#v", entities)
	}
	url, ok := entities[0].(*tg.MessageEntityURL)
	if !ok {
		t.Fatalf("expected messageEntityUrl, got %#v", entities[0])
	}
	if window := utf16Window(message, url.Offset, url.Length); window != "https://example.org/b" {
		t.Fatalf("unexpected URL window %q", window)
	}
}

func TestStyledTextOptionsMixedAndEscaping(t *testing.T) {
	message, entities := styledMessage(t, "[x](javascript:alert(1)) и (см. https://example.com/a)")
	if message != "[x](javascript:alert(1)) и (см. https://example.com/a)" {
		t.Fatalf("non-http markdown should stay plain: %q", message)
	}
	if len(entities) != 1 {
		t.Fatalf("expected only the bare URL entity, got %#v", entities)
	}
	if _, ok := entities[0].(*tg.MessageEntityURL); !ok {
		t.Fatalf("expected messageEntityUrl, got %#v", entities[0])
	}
}

func TestTrimBareURL(t *testing.T) {
	tests := map[string]string{
		"https://example.com/a.":           "https://example.com/a",
		"https://example.com/a)":           "https://example.com/a",
		"https://en.wikipedia.org/w/X_(Y)": "https://en.wikipedia.org/w/X_(Y)",
		"https://example.com/a»":           "https://example.com/a",
	}
	for input, expected := range tests {
		if actual := trimBareURL(input); actual != expected {
			t.Fatalf("trimBareURL(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestReplyIDFromProviderMessageID(t *testing.T) {
	if id, err := replyIDFromProviderMessageID("42"); err != nil || id != 42 {
		t.Fatalf("unexpected id: %d, %v", id, err)
	}
	for _, value := range []string{"", "0", "-3", "abc"} {
		if _, err := replyIDFromProviderMessageID(value); err == nil {
			t.Fatalf("expected error for %q", value)
		}
	}
}

// utf16Window slices message text by UTF-16 code units, the offsets Telegram
// entities use, rather than Go's byte offsets.
func utf16Window(message string, offset, length int) string {
	units := utf16.Encode([]rune(message))
	return string(utf16.Decode(units[offset : offset+length]))
}

func messageEntities() messagepeer.Entities {
	return messagepeer.NewEntities(map[int64]*tg.User{}, map[int64]*tg.Chat{}, map[int64]*tg.Channel{})
}
