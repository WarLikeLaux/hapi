package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/gotd/td/bin"
	"github.com/gotd/td/tg"
)

func TestChangeOwnMessage(t *testing.T) {
	for _, test := range []struct {
		name                                                     string
		channel, deleteMessage, incoming, missing, providerError bool
	}{
		{name: "edit text with links"},
		{name: "delete private message for everyone", deleteMessage: true},
		{name: "delete channel message", channel: true, deleteMessage: true},
		{name: "reject incoming edit", incoming: true},
		{name: "reject incoming deletion", incoming: true, deleteMessage: true},
		{name: "reject missing message", missing: true},
		{name: "propagate edit restriction", providerError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var wire bytes.Buffer
			s := newService(&writer{w: bufio.NewWriter(&wire)})
			remoteID := "user:42"
			var peer tg.InputPeerClass = &tg.InputPeerUser{UserID: 42}
			if test.channel {
				remoteID = "channel:42"
				peer = &tg.InputPeerChannel{ChannelID: 42}
			}
			s.peers[remoteID] = peer
			mutations := 0
			denied := errors.New("MESSAGE_EDIT_TIME_EXPIRED")
			s.raw = tg.NewClient(buttonInvoker(func(ctx context.Context, input bin.Encoder, output bin.Decoder) error {
				switch req := input.(type) {
				case *tg.MessagesGetHistoryRequest, *tg.ChannelsGetMessagesRequest:
					msg := &tg.Message{ID: 5, Out: !test.incoming, Message: "Original"}
					if test.missing {
						msg.ID = 4
					}
					output.(*tg.MessagesMessagesBox).Messages = &tg.MessagesMessages{Messages: []tg.MessageClass{msg}}
				case *tg.MessagesEditMessageRequest:
					mutations++
					if req.ID != 5 || req.Message != "Corrected https://example.com" || !req.NoWebpage || len(req.Entities) == 0 {
						t.Fatalf("incorrect edit request: %+v", req)
					}
					if test.providerError {
						return denied
					}
					output.(*tg.UpdatesBox).Updates = &tg.Updates{}
				case *tg.MessagesDeleteMessagesRequest:
					mutations++
					if test.channel || !req.Revoke || len(req.ID) != 1 || req.ID[0] != 5 {
						t.Fatalf("incorrect private deletion: %+v", req)
					}
				case *tg.ChannelsDeleteMessagesRequest:
					mutations++
					if !test.channel || len(req.ID) != 1 || req.ID[0] != 5 {
						t.Fatalf("incorrect channel deletion: %+v", req)
					}
				default:
					t.Fatalf("unexpected request %T", input)
				}
				return nil
			}))
			method := "messages.edit"
			if test.deleteMessage {
				method = "messages.delete"
			}
			params, _ := json.Marshal(map[string]string{"remoteId": remoteID, "providerMessageId": "5", "text": "Corrected https://example.com"})
			_, err := s.handle(rpcRequest{Method: method, Params: params})
			if test.incoming || test.missing {
				if err == nil || mutations != 0 {
					t.Fatalf("unsafe mutation: err=%v, mutations=%d", err, mutations)
				}
			} else if test.providerError {
				if !errors.Is(err, denied) {
					t.Fatalf("restriction lost: %v", err)
				}
			} else if err != nil || mutations != 1 {
				t.Fatalf("change failed: err=%v, mutations=%d", err, mutations)
			}
		})
	}
}
