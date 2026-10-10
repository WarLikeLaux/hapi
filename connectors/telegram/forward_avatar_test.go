package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/gotd/td/bin"
	messagepeer "github.com/gotd/td/telegram/message/peer"
	"github.com/gotd/td/tg"
)

func TestForwardAvatarsInHistoryAndLiveEvents(t *testing.T) {
	const senderAvatar = "data:image/jpeg;base64,c2VuZGVy"
	const sourceAvatar = "data:image/jpeg;base64,c291cmNl"
	sender := &tg.User{ID: 7, FirstName: "Sender", Photo: &tg.UserProfilePhoto{PhotoID: 70}}
	user := &tg.User{ID: 9, FirstName: "Original author", Photo: &tg.UserProfilePhoto{PhotoID: 90}}
	channel := &tg.Channel{ID: 10, Title: "Channel", Username: "channel", AccessHash: 100, Photo: &tg.ChatPhoto{PhotoID: 101}}
	chat := &tg.Chat{ID: 11, Title: "Group", Photo: &tg.ChatPhoto{PhotoID: 110}}
	entities := messagepeer.NewEntities(map[int64]*tg.User{7: sender, 9: user}, map[int64]*tg.Chat{11: chat}, map[int64]*tg.Channel{10: channel})
	for _, test := range []struct {
		name     string
		from     tg.PeerClass
		remoteID string
	}{
		{name: "channel", from: &tg.PeerChannel{ChannelID: 10}, remoteID: "channel:10"},
		{name: "user", from: &tg.PeerUser{UserID: 9}, remoteID: "user:9"},
		{name: "group", from: &tg.PeerChat{ChatID: 11}, remoteID: "chat:11"},
		{name: "hidden author"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var wire bytes.Buffer
			s := newService(&writer{w: bufio.NewWriter(&wire)})
			s.avatars["user:7"] = senderAvatar
			s.avatars[test.remoteID] = sourceAvatar
			s.peers["user:42"] = &tg.InputPeerUser{UserID: 42}
			header := tg.MessageFwdHeader{Date: 100}
			if test.from == nil {
				header.SetFromName("Private author")
			} else {
				header.SetFromID(test.from)
			}
			msg := &tg.Message{ID: 1, PeerID: &tg.PeerUser{UserID: 42}, Message: "Forwarded text", Date: 100}
			msg.SetFromID(&tg.PeerUser{UserID: 7})
			msg.SetFwdFrom(header)
			// Decode the wire independently: the source photo must belong to the
			// original author, never the person who forwarded the message.
			check := func(encoded []byte) {
				t.Helper()
				var message struct {
					SenderAvatar string `json:"senderAvatarDataUrl"`
					Forward      struct {
						Avatar string `json:"sourceAvatarDataUrl"`
					} `json:"forward"`
				}
				if err := json.Unmarshal(encoded, &message); err != nil {
					t.Fatal(err)
				}
				want := sourceAvatar
				if test.from == nil {
					want = ""
				}
				if message.SenderAvatar != senderAvatar || message.Forward.Avatar != want {
					t.Fatalf("wrong sender/source photos: %+v", message)
				}
			}
			s.emitNewMessage(context.Background(), entities, msg)
			var event struct {
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(wire.Bytes(), &event); err != nil {
				t.Fatal(err)
			}
			check(event.Data)
			s.raw = tg.NewClient(telegramInvokerFunc(func(ctx context.Context, input bin.Encoder, output bin.Decoder) error {
				if _, ok := input.(*tg.MessagesGetHistoryRequest); !ok {
					return fmt.Errorf("unexpected Telegram RPC: %T", input)
				}
				output.(*tg.MessagesMessagesBox).Messages = &tg.MessagesMessages{
					Messages: []tg.MessageClass{msg}, Users: []tg.UserClass{sender, user}, Chats: []tg.ChatClass{channel, chat},
				}
				return nil
			}))
			messages, err := s.loadMessages(context.Background(), "user:42", 1)
			if err != nil || len(messages) != 1 {
				t.Fatalf("load history: messages=%d, err=%v", len(messages), err)
			}
			encoded, err := json.Marshal(messages[0])
			if err != nil {
				t.Fatal(err)
			}
			check(encoded)
		})
	}
}
