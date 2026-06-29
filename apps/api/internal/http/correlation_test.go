package http

import "testing"

func TestCorrelationReviewStatuses(t *testing.T) {
	for _, status := range []string{"pending", "approved", "rejected"} {
		if !correlationReviewStatuses[status] {
			t.Fatalf("expected valid correlation review status %q", status)
		}
	}
	if correlationReviewStatuses["merged"] {
		t.Fatal("unexpected review status accepted")
	}
}
