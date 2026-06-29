package http

import "testing"

func TestOfficialAlertLimit(t *testing.T) {
	tests := []struct {
		raw   string
		want  int
		valid bool
	}{
		{"", 100, true},
		{"1", 1, true},
		{"200", 200, true},
		{"0", 0, false},
		{"201", 0, false},
		{"invalid", 0, false},
	}

	for _, tc := range tests {
		got, valid := officialAlertLimit(tc.raw)
		if got != tc.want || valid != tc.valid {
			t.Fatalf("officialAlertLimit(%q) = (%d, %v), want (%d, %v)",
				tc.raw, got, valid, tc.want, tc.valid)
		}
	}
}

func TestOfficialAlertStatuses(t *testing.T) {
	for _, status := range []string{"active", "updated", "expired", "cancelled"} {
		if !officialAlertStatuses[status] {
			t.Fatalf("expected %q to be accepted", status)
		}
	}
	if officialAlertStatuses["unknown"] {
		t.Fatal("unknown status must be rejected")
	}
}
