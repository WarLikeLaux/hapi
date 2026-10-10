package main

import (
	"context"
	"strings"
	"time"

	"github.com/gotd/td/tg"
)

func emojiKey(text string) string {
	return strings.ReplaceAll(strings.TrimSpace(text), "\ufe0f", "")
}

func emojiDocumentsFromSet(set *tg.MessagesStickerSet) map[string]*tg.Document {
	documents := make(map[int64]*tg.Document)
	for _, item := range set.Documents {
		if document, ok := item.(*tg.Document); ok {
			documents[document.ID] = document
		}
	}
	result := make(map[string]*tg.Document)
	for _, pack := range set.Packs {
		for _, id := range pack.Documents {
			if document := documents[id]; document != nil {
				result[emojiKey(pack.Emoticon)] = document
				break
			}
		}
	}
	return result
}

// These are Telegram's official animated emoji and click-effect sticker sets.
// Failure must leave ordinary text messaging available.
func (s *service) loadAnimatedEmojis(ctx context.Context, raw *tg.Client) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for index, input := range []tg.InputStickerSetClass{
		&tg.InputStickerSetAnimatedEmoji{}, &tg.InputStickerSetAnimatedEmojiAnimations{},
	} {
		result, err := raw.MessagesGetStickerSet(ctx, &tg.MessagesGetStickerSetRequest{Stickerset: input})
		if err != nil {
			continue
		}
		set, ok := result.(*tg.MessagesStickerSet)
		if !ok {
			continue
		}
		s.mu.Lock()
		if s.raw == raw {
			if index == 0 {
				s.emojiDocuments = emojiDocumentsFromSet(set)
			} else {
				s.emojiEffects = emojiDocumentsFromSet(set)
			}
		}
		s.mu.Unlock()
	}
}

func (s *service) animatedEmojiDocument(msg *tg.Message, mediaIndex int) *tg.Document {
	if mediaIndex < 0 || mediaIndex > 1 || len(msg.Entities) > 0 {
		return nil
	}
	if msg.Media != nil {
		if _, empty := msg.Media.(*tg.MessageMediaEmpty); !empty {
			return nil
		}
	}
	key := emojiKey(msg.Message)
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.emojiDocuments[key] == nil {
		return nil
	}
	if mediaIndex == 1 {
		return s.emojiEffects[key]
	}
	return s.emojiDocuments[key]
}

func (s *service) decorateAnimatedEmoji(msg *tg.Message, converted *externalMessage) {
	document := s.animatedEmojiDocument(msg, 0)
	if document == nil {
		return
	}
	converted.Media = mediaFromTelegram(&tg.MessageMediaDocument{Document: document})
	converted.Media[0].Kind = "sticker"
	converted.Media[0].Emoji = strings.TrimSpace(msg.Message)
	if effect := s.animatedEmojiDocument(msg, 1); effect != nil {
		media := mediaFromTelegram(&tg.MessageMediaDocument{Document: effect})
		media[0].Kind = "sticker"
		media[0].IsEmojiEffect = true
		converted.Media = append(converted.Media, media...)
	}
}
