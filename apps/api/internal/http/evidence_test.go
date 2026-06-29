package http

import "testing"

func TestUUIDPattern(t *testing.T) {
	if !uuidPattern.MatchString("123e4567-e89b-42d3-a456-426614174000") {
		t.Fatal("valid UUID rejected")
	}
	for _, invalid := range []string{"", "event-1", "123e4567-e89b-12d3-a456"} {
		if uuidPattern.MatchString(invalid) {
			t.Fatalf("invalid UUID accepted: %q", invalid)
		}
	}
}
