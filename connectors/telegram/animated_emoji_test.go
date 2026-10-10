package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/gotd/td/bin"
	"github.com/gotd/td/tg"
)

func TestAnimatedEmojiHistoryAndDownload(t *testing.T) {
	ctx := context.Background()
	emoji := &tg.Message{ID: 42, PeerID: &tg.PeerUser{UserID: 7}, Message: "😂", Date: 1}
	document := func(id int64) *tg.Document {
		return &tg.Document{ID: id, AccessHash: id + 100, FileReference: []byte{1}, Size: 3,
			MimeType: "application/x-tgsticker", Attributes: []tg.DocumentAttributeClass{
				&tg.DocumentAttributeSticker{}, &tg.DocumentAttributeAnimated{},
			}}
	}
	downloadedIDs := []int64{}
	raw := tg.NewClient(telegramInvokerFunc(func(_ context.Context, input bin.Encoder, output bin.Decoder) error {
		switch request := input.(type) {
		case *tg.MessagesGetStickerSetRequest:
			id := int64(11)
			if _, effect := request.Stickerset.(*tg.InputStickerSetAnimatedEmojiAnimations); effect {
				id = 22
			} else if _, base := request.Stickerset.(*tg.InputStickerSetAnimatedEmoji); !base {
				t.Fatalf("unexpected sticker set: %T", request.Stickerset)
			}
			output.(*tg.MessagesStickerSetBox).StickerSet = &tg.MessagesStickerSet{
				Packs:     []tg.StickerPack{{Emoticon: "😂", Documents: []int64{id}}},
				Documents: []tg.DocumentClass{document(id)},
			}
		case *tg.MessagesGetHistoryRequest:
			messages := []tg.MessageClass{emoji}
			if request.OffsetID == 0 {
				messages = append(messages,
					&tg.Message{ID: 41, PeerID: emoji.PeerID, Message: "😂😂", Date: 1},
					&tg.Message{ID: 40, PeerID: emoji.PeerID, Message: "hello 😂", Date: 1})
			}
			output.(*tg.MessagesMessagesBox).Messages = &tg.MessagesMessages{Messages: messages}
		case *tg.UploadGetFileRequest:
			location := request.Location.(*tg.InputDocumentFileLocation)
			downloadedIDs = append(downloadedIDs, location.ID)
			output.(*tg.UploadFileBox).File = &tg.UploadFile{Bytes: []byte("tgs")}
		default:
			t.Fatalf("unexpected RPC: %T", input)
		}
		return nil
	}))
	s := newService(nil)
	s.raw, s.self = raw, &tg.User{ID: 7}
	s.peers["user:7"] = &tg.InputPeerUser{UserID: 7}
	s.sessionPath = filepath.Join(t.TempDir(), "session.json")
	s.loadAnimatedEmojis(ctx, raw)
	messages, err := s.loadMessages(ctx, "user:7", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 3 || messages[0].Text != "😂" || len(messages[0].Media) != 2 {
		t.Fatalf("single emoji was not enriched: %#v", messages)
	}
	if messages[0].Media[0].Emoji != "😂" || messages[0].Media[0].Kind != "sticker" || !messages[0].Media[1].IsEmojiEffect {
		t.Fatalf("emoji/effect metadata lost: %#v", messages[0].Media)
	}
	if len(messages[1].Media) != 0 || len(messages[2].Media) != 0 {
		t.Fatal("ordinary text or multiple emojis were converted to a sticker")
	}
	for index := range 2 {
		media, err := s.downloadMedia(ctx, "user:7", "42", index)
		if err != nil {
			t.Fatal(err)
		}
		bytes, err := os.ReadFile(media.Path)
		if err != nil || string(bytes) != "tgs" || media.MIMEType != "application/x-tgsticker" {
			t.Fatalf("animation download failed: %#v, %v", media, err)
		}
	}
	if len(downloadedIDs) != 2 || downloadedIDs[0] != 11 || downloadedIDs[1] != 22 {
		t.Fatalf("wrong animated emoji documents downloaded: %v", downloadedIDs)
	}
}
