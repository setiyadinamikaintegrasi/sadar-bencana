package http

import (
	"testing"
	"time"
)

func TestComputeLearningXP(t *testing.T) {
	if got := computeLearningXP(1, true); got != 80 {
		t.Fatalf("expected 80 XP for completion + correct quiz + checklist, got %d", got)
	}
	if got := computeLearningXP(0, true); got != 70 {
		t.Fatalf("expected 70 XP for completion + checklist, got %d", got)
	}
	if got := computeLearningXP(2, true); got != 70 {
		t.Fatalf("expected 70 XP for completion + checklist when quiz score is not exactly 1, got %d", got)
	}
	if got := computeLearningXP(1, false); got != 60 {
		t.Fatalf("expected 60 XP for completion + correct quiz, got %d", got)
	}
	if got := computeLearningXP(2, false); got != 50 {
		t.Fatalf("expected 50 XP for completion only when quiz score is not exactly 1, got %d", got)
	}
}

func TestComputeLearningLevel(t *testing.T) {
	cases := []struct {
		xp   int
		want int
	}{
		{xp: 0, want: 1},
		{xp: 99, want: 1},
		{xp: 100, want: 2},
		{xp: 250, want: 3},
	}
	for _, tc := range cases {
		if got := computeLearningLevel(tc.xp); got != tc.want {
			t.Fatalf("xp=%d expected level %d, got %d", tc.xp, tc.want, got)
		}
	}
}

func TestNextLearningStreak(t *testing.T) {
	today := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	yesterday := today.AddDate(0, 0, -1)
	twoDaysAgo := today.AddDate(0, 0, -2)

	current, longest := nextLearningStreak(nil, today, 0, 0)
	if current != 1 || longest != 1 {
		t.Fatalf("first activity expected current=1 longest=1, got current=%d longest=%d", current, longest)
	}

	current, longest = nextLearningStreak(&yesterday, today, 2, 2)
	if current != 3 || longest != 3 {
		t.Fatalf("consecutive day expected current=3 longest=3, got current=%d longest=%d", current, longest)
	}

	current, longest = nextLearningStreak(&today, today, 2, 4)
	if current != 2 || longest != 4 {
		t.Fatalf("same day expected unchanged current=2 longest=4, got current=%d longest=%d", current, longest)
	}

	current, longest = nextLearningStreak(&twoDaysAgo, today, 5, 5)
	if current != 1 || longest != 5 {
		t.Fatalf("missed day expected reset current=1 longest=5, got current=%d longest=%d", current, longest)
	}
}

func TestKnownLearningModule(t *testing.T) {
	if !knownLearningModule("home-evacuation-plan") {
		t.Fatalf("expected home-evacuation-plan to be known")
	}
	if knownLearningModule("unknown-module") {
		t.Fatalf("expected unknown-module to be rejected")
	}
}
