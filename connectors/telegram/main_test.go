package main

import (
	"testing"

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

func messageEntities() messagepeer.Entities {
	return messagepeer.NewEntities(map[int64]*tg.User{}, map[int64]*tg.Chat{}, map[int64]*tg.Channel{})
}
