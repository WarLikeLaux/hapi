package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/gotd/td/bin"
	"github.com/gotd/td/tg"
)

type buttonInvoker func(context.Context, bin.Encoder, bin.Decoder) error

func (invoke buttonInvoker) Invoke(ctx context.Context, input bin.Encoder, output bin.Decoder) error {
	return invoke(ctx, input, output)
}

func TestPressButtonReconcilesDeletion(t *testing.T) {
	for _, test := range []struct {
		name         string
		channel      bool
		deleteAfter  time.Duration
		callbackWait time.Duration
		callbackErr  error
		lookupErr    error
		nativeDelete bool
		wantDeleted  bool
	}{
		{name: "already deleted", deleteAfter: 0, wantDeleted: true},
		{name: "delayed deletion without update", deleteAfter: 2 * time.Second, wantDeleted: true},
		{name: "channel deletion without update", channel: true, deleteAfter: 2 * time.Second, wantDeleted: true},
		{name: "deletion while waiting for bot answer", deleteAfter: time.Second, callbackWait: 4 * time.Second, callbackErr: errors.New("BOT_RESPONSE_TIMEOUT"), wantDeleted: true},
		{name: "message remains", deleteAfter: time.Hour},
		{name: "lookup failure is not deletion", deleteAfter: time.Hour, lookupErr: errors.New("FLOOD_WAIT_60")},
		{name: "native deletion stops polling", deleteAfter: time.Hour, nativeDelete: true, wantDeleted: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				var wire bytes.Buffer
				s := newService(&writer{w: bufio.NewWriter(&wire)})
				start := time.Now()
				remoteID := "user:42"
				var peer tg.InputPeerClass = &tg.InputPeerUser{UserID: 42}
				if test.channel {
					remoteID = "channel:42"
					peer = &tg.InputPeerChannel{ChannelID: 42}
				}
				s.peers[remoteID] = peer
				lookups, callbacks := 0, 0
				s.raw = tg.NewClient(buttonInvoker(func(ctx context.Context, input bin.Encoder, output bin.Decoder) error {
					switch input.(type) {
					case *tg.MessagesGetHistoryRequest, *tg.ChannelsGetMessagesRequest:
						lookups++
						if lookups > 1 && test.lookupErr != nil {
							return test.lookupErr
						}
						var messages []tg.MessageClass
						if time.Since(start) < test.deleteAfter {
							messages = []tg.MessageClass{&tg.Message{
								ID: 5, Message: "notification",
								ReplyMarkup: &tg.ReplyInlineMarkup{Rows: []tg.KeyboardButtonRow{{Buttons: []tg.KeyboardButtonClass{
									&tg.KeyboardButtonCallback{Text: "Read", Data: []byte("read")},
								}}}},
							}}
						} else {
							// History skips a deleted message; a preceding message must
							// not be mistaken for the requested one.
							messages = []tg.MessageClass{&tg.Message{ID: 4, Message: "older"}}
						}
						output.(*tg.MessagesMessagesBox).Messages = &tg.MessagesMessages{Messages: messages}
						return nil
					case *tg.MessagesGetBotCallbackAnswerRequest:
						callbacks++
						if test.nativeDelete {
							if err := s.handleDeleteMessages(ctx, tg.Entities{}, &tg.UpdateDeleteMessages{Messages: []int{5}}); err != nil {
								t.Fatal(err)
							}
						}
						time.Sleep(test.callbackWait)
						return test.callbackErr
					default:
						t.Fatalf("unexpected Telegram request %T", input)
						return nil
					}
				}))
				// The RPC context is cancelled as soon as the answer is returned;
				// reconciliation must survive independently of that request.
				ctx, cancel := context.WithCancel(context.Background())
				_, err := s.pressButton(ctx, remoteID, "5", "0:0")
				cancel()
				if !errors.Is(err, test.callbackErr) {
					t.Fatalf("press error = %v, want %v", err, test.callbackErr)
				}
				time.Sleep(11 * time.Second)
				synctest.Wait()
				var events []struct {
					Event string          `json:"event"`
					Data  deletedMessages `json:"data"`
				}
				scanner := bufio.NewScanner(&wire)
				for scanner.Scan() {
					var event struct {
						Event string          `json:"event"`
						Data  deletedMessages `json:"data"`
					}
					if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
						t.Fatal(err)
					}
					events = append(events, event)
				}
				wantCount := 0
				if test.wantDeleted {
					wantCount = 1
				}
				if len(events) != wantCount {
					t.Fatalf("delete events = %#v, want %d", events, wantCount)
				}
				if len(events) > 0 {
					event := events[0]
					if event.Event != "messages-deleted" || len(event.Data.ProviderMessageIDs) != 1 || event.Data.ProviderMessageIDs[0] != "5" {
						t.Fatalf("unexpected deletion event: %#v", event)
					}
					if !test.nativeDelete && (event.Data.RemoteID == nil || *event.Data.RemoteID != remoteID) {
						t.Fatalf("deletion did not target the pressed conversation: %#v", event)
					}
				}
				if test.deleteAfter == 0 && callbacks != 0 {
					t.Fatal("a deleted message must not send another callback")
				}
				if test.nativeDelete && lookups != 1 {
					t.Fatalf("polling continued after native deletion: %d lookups", lookups)
				}
				completedLookups := lookups
				time.Sleep(time.Minute)
				synctest.Wait()
				if lookups != completedLookups {
					t.Fatal("button polling outlived its bounded window")
				}
			})
		})
	}
}
