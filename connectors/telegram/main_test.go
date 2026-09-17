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

	messagepeer "github.com/gotd/td/telegram/message/peer"
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

func messageEntities() messagepeer.Entities {
	return messagepeer.NewEntities(map[int64]*tg.User{}, map[int64]*tg.Chat{}, map[int64]*tg.Channel{})
}
