package http

import (
	"encoding/json"
	"testing"
)

func TestEWSSupportedChannelsExcludeRemovedProviders(t *testing.T) {
	for _, channel := range []string{"telegram", "email"} {
		if _, ok := ewsChannels[channel]; !ok {
			t.Fatalf("expected channel %q to be supported", channel)
		}
	}
	if _, ok := ewsChannels["whats"+"app"]; ok {
		t.Fatal("removed channel must not be supported")
	}
}

func TestEWSTimezoneValidation(t *testing.T) {
	for _, timezone := range []string{"Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"} {
		if !validEWSTimezone(timezone) {
			t.Fatalf("expected timezone %q to be valid", timezone)
		}
	}
	if validEWSTimezone("WIB") {
		t.Fatal("timezone aliases must not replace IANA names")
	}
}

func TestOptionalTelegramChatIDSupportsExplicitRemoval(t *testing.T) {
	var body ewsMeProfileBody
	if err := json.Unmarshal([]byte(`{"telegram_chat_id":null}`), &body); err != nil {
		t.Fatal(err)
	}
	if !body.TelegramChatID.Set || body.TelegramChatID.Value != nil {
		t.Fatal("explicit null must be represented as a removal")
	}
}
