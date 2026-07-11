package http

import (
	"database/sql"
	"time"
)

const (
	learningXPModuleComplete = 50
	learningXPQuizCorrect    = 10
	learningXPChecklistDone  = 20
)

var learningModuleIDs = map[string]struct{}{
	"home-evacuation-plan": {},
	"office-school-drill":  {},
	"public-travel-safety": {},
}

type LearningStats struct {
	UserID            string     `json:"user_id"`
	TotalXP           int        `json:"total_xp"`
	CurrentStreakDays int        `json:"current_streak_days"`
	LongestStreakDays int        `json:"longest_streak_days"`
	LastActivityDate  *time.Time `json:"last_activity_date"`
	Level             int        `json:"level"`
}

type LearningModuleProgress struct {
	ModuleID           string     `json:"module_id"`
	Status             string     `json:"status"`
	QuizScore          int        `json:"quiz_score"`
	QuizMaxScore       int        `json:"quiz_max_score"`
	ChecklistCompleted bool       `json:"checklist_completed"`
	XPEarned           int        `json:"xp_earned"`
	CompletedAt        *time.Time `json:"completed_at"`
}

type LearningBadge struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Criteria    string     `json:"criteria"`
	UnlockedAt  *time.Time `json:"unlocked_at,omitempty"`
}

type LearningState struct {
	Stats    LearningStats            `json:"stats"`
	Progress []LearningModuleProgress `json:"progress"`
	Badges   []LearningBadge          `json:"badges"`
}

type learningCompletionBody struct {
	QuizScore          int  `json:"quiz_score"`
	QuizMaxScore       int  `json:"quiz_max_score"`
	ChecklistCompleted bool `json:"checklist_completed"`
}

func knownLearningModule(moduleID string) bool {
	_, ok := learningModuleIDs[moduleID]
	return ok
}

func computeLearningXP(quizScore int, checklistCompleted bool) int {
	xp := learningXPModuleComplete
	if quizScore > 0 {
		xp += learningXPQuizCorrect
	}
	if checklistCompleted {
		xp += learningXPChecklistDone
	}
	return xp
}

func computeLearningLevel(totalXP int) int {
	if totalXP < 0 {
		totalXP = 0
	}
	return totalXP/100 + 1
}

func nextLearningStreak(lastActivity *time.Time, today time.Time, current int, longest int) (int, int) {
	todayDate := dateOnly(today)
	if lastActivity == nil {
		return 1, maxInt(longest, 1)
	}

	lastDate := dateOnly(*lastActivity)
	switch {
	case lastDate.Equal(todayDate):
		return current, longest
	case lastDate.Equal(todayDate.AddDate(0, 0, -1)):
		next := current + 1
		return next, maxInt(longest, next)
	default:
		return 1, longest
	}
}

func dateOnly(value time.Time) time.Time {
	year, month, day := value.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func scanLearningStats(userID string, totalXP int, currentStreak int, longestStreak int, lastActivity sql.NullTime, level int) LearningStats {
	var last *time.Time
	if lastActivity.Valid {
		value := lastActivity.Time
		last = &value
	}

	return LearningStats{
		UserID:            userID,
		TotalXP:           totalXP,
		CurrentStreakDays: currentStreak,
		LongestStreakDays: longestStreak,
		LastActivityDate:  last,
		Level:             level,
	}
}
