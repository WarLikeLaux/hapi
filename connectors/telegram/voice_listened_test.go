package main

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/gotd/td/bin"
	"github.com/gotd/td/tg"
)

func TestVoiceListened(t *testing.T) {
	for _, test := range []struct {
		name, remoteID, messageID                                          string
		outgoing, audio, read, wrongPeer, missing, providerError, rejected bool
	}{
		{name: "direct", remoteID: "user:42"},
		{name: "basic group", remoteID: "chat:42"},
		{name: "supergroup", remoteID: "channel:42"},
		{name: "rejected channel receipt", remoteID: "channel:42", rejected: true},
		{name: "already listened", remoteID: "user:42", read: true},
		{name: "outgoing", remoteID: "user:42", outgoing: true},
		{name: "music", remoteID: "user:42", audio: true},
		{name: "different peer", remoteID: "user:42", wrongPeer: true},
		{name: "missing", remoteID: "user:42", missing: true},
		{name: "invalid id", remoteID: "user:42", messageID: "0"},
		{name: "overflow id", remoteID: "user:42", messageID: "2147483648"},
		{name: "provider failure retries", remoteID: "user:42", providerError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var peer tg.InputPeerClass = &tg.InputPeerUser{UserID: 42, AccessHash: 99}
			var messagePeer tg.PeerClass = &tg.PeerUser{UserID: 42}
			switch test.remoteID {
			case "chat:42":
				peer = &tg.InputPeerChat{ChatID: 42}
				messagePeer = &tg.PeerChat{ChatID: 42}
			case "channel:42":
				peer = &tg.InputPeerChannel{ChannelID: 42, AccessHash: 99}
				messagePeer = &tg.PeerChannel{ChannelID: 42}
			}
			if test.wrongPeer {
				messagePeer = &tg.PeerUser{UserID: 43}
			}
			msg := &tg.Message{ID: 5, PeerID: messagePeer, Out: test.outgoing, MediaUnread: !test.read,
				Media: &tg.MessageMediaDocument{Voice: !test.audio, Document: &tg.Document{ID: 7, MimeType: "audio/ogg"}}}
			if test.missing {
				msg.ID = 4
			}
			receipts, lookups := 0, 0
			denied := errors.New("FLOOD_WAIT_60")
			raw := tg.NewClient(telegramInvokerFunc(func(ctx context.Context, input bin.Encoder, output bin.Decoder) error {
				switch req := input.(type) {
				case *tg.MessagesGetHistoryRequest:
					lookups++
					if !reflect.DeepEqual(req.Peer, peer) || req.OffsetID != 6 || req.Limit != 1 {
						t.Fatalf("wrong message lookup: %+v", req)
					}
					output.(*tg.MessagesMessagesBox).Messages = &tg.MessagesMessages{Messages: []tg.MessageClass{msg}}
				case *tg.ChannelsGetMessagesRequest:
					lookups++
					channel := req.Channel.(*tg.InputChannel)
					if channel.ChannelID != 42 || channel.AccessHash != 99 || len(req.ID) != 1 || req.ID[0].(*tg.InputMessageID).ID != 5 {
						t.Fatalf("wrong channel lookup: %+v", req)
					}
					output.(*tg.MessagesMessagesBox).Messages = &tg.MessagesMessages{Messages: []tg.MessageClass{msg}}
				case *tg.MessagesReadMessageContentsRequest:
					receipts++
					if test.remoteID == "channel:42" || !reflect.DeepEqual(req.ID, []int{5}) {
						t.Fatalf("wrong receipt: %+v", req)
					}
					if test.providerError && receipts == 1 {
						return denied
					}
					msg.MediaUnread = false
				case *tg.ChannelsReadMessageContentsRequest:
					receipts++
					channel := req.Channel.(*tg.InputChannel)
					if test.remoteID != "channel:42" || channel.ChannelID != 42 || channel.AccessHash != 99 || !reflect.DeepEqual(req.ID, []int{5}) {
						t.Fatalf("wrong channel receipt: %+v", req)
					}
					if test.rejected {
						output.(*tg.BoolBox).Bool = &tg.BoolFalse{}
					} else {
						msg.MediaUnread = false
						output.(*tg.BoolBox).Bool = &tg.BoolTrue{}
					}
				default:
					t.Fatalf("unexpected Telegram RPC: %T", input)
				}
				return nil
			}))
			s := &service{raw: raw, peers: map[string]tg.InputPeerClass{test.remoteID: peer}}
			id := test.messageID
			if id == "" {
				id = "5"
			}
			params, _ := json.Marshal(map[string]string{"remoteId": test.remoteID, "providerMessageId": id})
			call := func() error {
				_, err := s.handle(rpcRequest{Method: "messages.voiceListened", Params: params})
				return err
			}
			err := call()
			if test.rejected {
				if err == nil || receipts != 1 {
					t.Fatalf("rejected receipt treated as accepted: %v, %d", err, receipts)
				}
				return
			}
			if test.outgoing || test.audio || test.wrongPeer || test.missing || test.messageID != "" {
				if err == nil || receipts != 0 {
					t.Fatalf("unsafe receipt: %v, count %d", err, receipts)
				}
				if test.messageID != "" && lookups != 0 {
					t.Fatal("invalid ID reached Telegram")
				}
				return
			}
			if test.providerError {
				if !errors.Is(err, denied) {
					t.Fatalf("lost provider error: %v", err)
				}
				err = call()
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := call(); err != nil {
				t.Fatal(err)
			}
			expected := 1
			if test.read {
				expected = 0
			}
			if test.providerError {
				expected = 2
			}
			if receipts != expected {
				t.Fatalf("got %d receipts, want %d", receipts, expected)
			}
		})
	}
}
