package main

import (
	"context"
	"errors"
	"strconv"

	messagepeer "github.com/gotd/td/telegram/message/peer"
	"github.com/gotd/td/tg"
)

// Playback receipts never advance the history read cursor. Resolve the message
// in this account and peer before sending the single-ID content receipt.
func (s *service) markVoiceListened(ctx context.Context, remoteID, providerMessageID string) error {
	messageID, err := strconv.Atoi(providerMessageID)
	if err != nil || messageID <= 0 || messageID > 2147483647 {
		return errors.New("invalid Telegram message ID")
	}
	raw, err := s.ready()
	if err != nil {
		return err
	}
	peer, err := s.ensurePeer(ctx, remoteID)
	if err != nil {
		return err
	}
	msg, err := messageByID(ctx, raw, peer, messageID)
	if err != nil {
		return err
	}
	actualRemoteID, _ := remoteIDFromPeer(msg.PeerID)
	if actualRemoteID != remoteID || msg.Out {
		return errors.New("message is not incoming in this Telegram conversation")
	}
	media := mediaFromTelegram(msg.Media)
	if len(media) != 1 || media[0].Kind != "voice" {
		return errors.New("message is not a Telegram voice")
	}
	if !msg.MediaUnread {
		return nil
	}
	if channel, ok := messagepeer.ToInputChannel(peer); ok {
		var accepted bool
		accepted, err = raw.ChannelsReadMessageContents(ctx, &tg.ChannelsReadMessageContentsRequest{
			Channel: channel,
			ID:      []int{messageID},
		})
		if err == nil && !accepted {
			return errors.New("Telegram did not accept the voice listening receipt")
		}
	} else {
		_, err = raw.MessagesReadMessageContents(ctx, []int{messageID})
	}
	return err
}
