package main

import (
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
	result, ok := messageFromTelegram(msg, messageEntities(), &tg.User{ID: 1, FirstName: "Me"})
	if !ok {
		t.Fatal("message was not converted")
	}
	if result.ConversationID != "telegram:user:42" || result.Direction != "outgoing" || result.CreatedAt != 123000 {
		t.Fatalf("unexpected message: %#v", result)
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
	result, ok := messageFromTelegram(msg, messageEntities(), nil)
	if !ok || len(result.Media) != 1 || result.Media[0].Kind != "voice" || result.Text != "" {
		t.Fatalf("unexpected media message: %#v", result)
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
