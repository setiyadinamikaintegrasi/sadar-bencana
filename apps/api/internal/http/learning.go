package http

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
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
	if quizScore == 1 {
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

func LearningMe(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		state, err := loadLearningState(c.Request.Context(), db, AuthUserID(c))
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": state})
	}
}

func LearningModuleComplete(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		moduleID := c.Param("module_id")
		if !knownLearningModule(moduleID) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "unknown_module"})
			return
		}
		var body learningCompletionBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		if body.QuizMaxScore != 1 || body.QuizScore < 0 || body.QuizScore > 1 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid_quiz_score"})
			return
		}
		if db == nil {
			dbUnavailable(c)
			return
		}

		userID := AuthUserID(c)
		if err := completeLearningModule(c.Request.Context(), db, userID, moduleID, body, time.Now().UTC()); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		state, err := loadLearningState(c.Request.Context(), db, userID)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": state})
	}
}

func loadLearningState(ctx context.Context, db *sql.DB, userID string) (LearningState, error) {
	stats := LearningStats{UserID: userID, Level: 1}
	var totalXP, currentStreak, longestStreak, level int
	var lastActivity sql.NullTime
	err := db.QueryRowContext(ctx, `SELECT total_xp, current_streak_days, longest_streak_days, last_activity_date, level
FROM learning_user_stats
WHERE user_id = $1`, userID).Scan(&totalXP, &currentStreak, &longestStreak, &lastActivity, &level)
	if err == nil {
		stats = scanLearningStats(userID, totalXP, currentStreak, longestStreak, lastActivity, level)
	} else if err != sql.ErrNoRows {
		return LearningState{}, err
	}

	progressRows, err := db.QueryContext(ctx, `SELECT module_id, status, quiz_score, quiz_max_score, checklist_completed, xp_earned, completed_at
FROM learning_module_progress
WHERE user_id = $1
ORDER BY created_at ASC`, userID)
	if err != nil {
		return LearningState{}, err
	}
	defer progressRows.Close()

	progress := []LearningModuleProgress{}
	for progressRows.Next() {
		var item LearningModuleProgress
		var completedAt sql.NullTime
		if err := progressRows.Scan(&item.ModuleID, &item.Status, &item.QuizScore, &item.QuizMaxScore, &item.ChecklistCompleted, &item.XPEarned, &completedAt); err != nil {
			return LearningState{}, err
		}
		if completedAt.Valid {
			value := completedAt.Time
			item.CompletedAt = &value
		}
		progress = append(progress, item)
	}
	if err := progressRows.Err(); err != nil {
		return LearningState{}, err
	}

	badgeRows, err := db.QueryContext(ctx, `SELECT b.id, b.name, b.description, b.criteria, ub.unlocked_at
FROM learning_badges b
LEFT JOIN learning_user_badges ub ON ub.badge_id = b.id AND ub.user_id = $1
ORDER BY b.created_at ASC, b.id ASC`, userID)
	if err != nil {
		return LearningState{}, err
	}
	defer badgeRows.Close()

	badges := []LearningBadge{}
	for badgeRows.Next() {
		var badge LearningBadge
		var unlockedAt sql.NullTime
		if err := badgeRows.Scan(&badge.ID, &badge.Name, &badge.Description, &badge.Criteria, &unlockedAt); err != nil {
			return LearningState{}, err
		}
		if unlockedAt.Valid {
			value := unlockedAt.Time
			badge.UnlockedAt = &value
		}
		badges = append(badges, badge)
	}
	if err := badgeRows.Err(); err != nil {
		return LearningState{}, err
	}

	return LearningState{Stats: stats, Progress: progress, Badges: badges}, nil
}

func completeLearningModule(ctx context.Context, db *sql.DB, userID string, moduleID string, body learningCompletionBody, now time.Time) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `INSERT INTO learning_user_stats (user_id)
VALUES ($1)
ON CONFLICT (user_id) DO NOTHING`, userID)
	if err != nil {
		return err
	}

	var totalXP, currentStreak, longestStreak int
	var lastActivity sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT total_xp, current_streak_days, longest_streak_days, last_activity_date
FROM learning_user_stats
WHERE user_id = $1
FOR UPDATE`, userID).Scan(&totalXP, &currentStreak, &longestStreak, &lastActivity)
	if err != nil {
		return err
	}

	var existingXP int
	err = tx.QueryRowContext(ctx, `SELECT xp_earned
FROM learning_module_progress
WHERE user_id = $1 AND module_id = $2 AND status = 'completed'`, userID, moduleID).Scan(&existingXP)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == nil {
		if err := unlockLearningBadges(ctx, tx, userID, moduleID, currentStreak); err != nil {
			return err
		}
		return tx.Commit()
	}

	xpEarned := computeLearningXP(body.QuizScore, body.ChecklistCompleted)
	var storedXP int
	err = tx.QueryRowContext(ctx, `INSERT INTO learning_module_progress
    (user_id, module_id, status, quiz_score, quiz_max_score, checklist_completed, xp_earned, completed_at)
VALUES ($1, $2, 'completed', $3, $4, $5, $6, now())
ON CONFLICT (user_id, module_id) DO UPDATE SET
    status = 'completed',
    quiz_score = EXCLUDED.quiz_score,
    quiz_max_score = EXCLUDED.quiz_max_score,
    checklist_completed = EXCLUDED.checklist_completed,
    xp_earned = learning_module_progress.xp_earned + EXCLUDED.xp_earned,
    completed_at = COALESCE(learning_module_progress.completed_at, now()),
    updated_at = now()
WHERE learning_module_progress.status <> 'completed'
	RETURNING xp_earned`, userID, moduleID, body.QuizScore, body.QuizMaxScore, body.ChecklistCompleted, xpEarned).Scan(&storedXP)
	if err == sql.ErrNoRows {
		if err := unlockLearningBadges(ctx, tx, userID, moduleID, currentStreak); err != nil {
			return err
		}
		return tx.Commit()
	}
	if err != nil {
		return err
	}

	var lastPtr *time.Time
	if lastActivity.Valid {
		value := lastActivity.Time
		lastPtr = &value
	}
	nextCurrent, nextLongest := nextLearningStreak(lastPtr, now, currentStreak, longestStreak)
	nextTotalXP := totalXP + xpEarned
	nextLevel := computeLearningLevel(nextTotalXP)

	_, err = tx.ExecContext(ctx, `UPDATE learning_user_stats
SET total_xp = $2,
    current_streak_days = $3,
    longest_streak_days = $4,
    last_activity_date = $5,
    level = $6,
    updated_at = now()
WHERE user_id = $1`, userID, nextTotalXP, nextCurrent, nextLongest, dateOnly(now), nextLevel)
	if err != nil {
		return err
	}

	if err := unlockLearningBadges(ctx, tx, userID, moduleID, nextCurrent); err != nil {
		return err
	}
	return tx.Commit()
}

type learningTx interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func unlockLearningBadges(ctx context.Context, tx learningTx, userID string, moduleID string, currentStreak int) error {
	badgeIDs := []string{"first_step"}
	if moduleID == "home-evacuation-plan" {
		badgeIDs = append(badgeIDs, "home_ready")
	}
	if currentStreak >= 3 {
		badgeIDs = append(badgeIDs, "streak_3")
	}

	var completedInitial int
	err := tx.QueryRowContext(ctx, `SELECT count(*)
FROM learning_module_progress
WHERE user_id = $1
  AND status = 'completed'
  AND module_id IN ('home-evacuation-plan', 'office-school-drill', 'public-travel-safety')`, userID).Scan(&completedInitial)
	if err != nil {
		return err
	}
	if completedInitial == 3 {
		badgeIDs = append(badgeIDs, "three_contexts_ready")
	}

	for _, badgeID := range badgeIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO learning_user_badges (user_id, badge_id)
VALUES ($1, $2)
ON CONFLICT (user_id, badge_id) DO NOTHING`, userID, badgeID); err != nil {
			return err
		}
	}
	return nil
}
