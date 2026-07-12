package http

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
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

func learningTestRouter(db *sql.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(ctxAuthUserID, "11111111-1111-1111-1111-111111111111")
		c.Next()
	})
	router.GET("/api/v1/learning/me", LearningMe(db))
	router.POST("/api/v1/learning/modules/:module_id/complete", LearningModuleComplete(db))
	return router
}

func TestLearningMeReturnsDefaultState(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	userID := "11111111-1111-1111-1111-111111111111"
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT total_xp, current_streak_days, longest_streak_days, last_activity_date, level
FROM learning_user_stats
WHERE user_id = $1`)).
		WithArgs(userID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT module_id, status, quiz_score, quiz_max_score, checklist_completed, xp_earned, completed_at
FROM learning_module_progress
WHERE user_id = $1
ORDER BY created_at ASC`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"module_id", "status", "quiz_score", "quiz_max_score", "checklist_completed", "xp_earned", "completed_at"}))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT b.id, b.name, b.description, b.criteria, ub.unlocked_at
FROM learning_badges b
LEFT JOIN learning_user_badges ub ON ub.badge_id = b.id AND ub.user_id = $1
ORDER BY b.created_at ASC, b.id ASC`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "description", "criteria", "unlocked_at"}).
			AddRow("first_step", "Langkah Pertama", "Menyelesaikan modul Belajar Siaga pertama.", "complete_any_module", nil))

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/learning/me", nil)
	learningTestRouter(db).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"total_xp":0`) {
		t.Fatalf("expected default total_xp 0, got %s", recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestLearningModuleCompleteRejectsUnknownModule(t *testing.T) {
	recorder := httptest.NewRecorder()
	body := strings.NewReader(`{"quiz_score":1,"quiz_max_score":1,"checklist_completed":true}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/learning/modules/unknown-module/complete", body)
	request.Header.Set("Content-Type", "application/json")
	learningTestRouter(nil).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestLearningModuleCompleteRejectsMultiQuestionQuiz(t *testing.T) {
	recorder := httptest.NewRecorder()
	body := strings.NewReader(`{"quiz_score":1,"quiz_max_score":2,"checklist_completed":true}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/learning/modules/home-evacuation-plan/complete", body)
	request.Header.Set("Content-Type", "application/json")
	learningTestRouter(nil).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"error":"invalid_quiz_score"`) {
		t.Fatalf("expected invalid_quiz_score, got %s", recorder.Body.String())
	}
}

func TestCompleteLearningModuleEvaluatesBadgesForExistingCompletion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	userID := "11111111-1111-1111-1111-111111111111"
	moduleID := "office-school-drill"
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO learning_user_stats (user_id)
VALUES ($1)
ON CONFLICT (user_id) DO NOTHING`)).
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(1, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT total_xp, current_streak_days, longest_streak_days, last_activity_date
FROM learning_user_stats
WHERE user_id = $1
FOR UPDATE`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"total_xp", "current_streak_days", "longest_streak_days", "last_activity_date"}).
			AddRow(80, 1, 3, nil))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT xp_earned
FROM learning_module_progress
WHERE user_id = $1 AND module_id = $2 AND status = 'completed'`)).
		WithArgs(userID, moduleID).
		WillReturnRows(sqlmock.NewRows([]string{"xp_earned"}).AddRow(80))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*)
FROM learning_module_progress
WHERE user_id = $1
  AND status = 'completed'
  AND module_id IN ('home-evacuation-plan', 'office-school-drill', 'public-travel-safety')`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO learning_user_badges (user_id, badge_id)
VALUES ($1, $2)
ON CONFLICT (user_id, badge_id) DO NOTHING`)).
		WithArgs(userID, "first_step").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO learning_user_badges (user_id, badge_id)
VALUES ($1, $2)
ON CONFLICT (user_id, badge_id) DO NOTHING`)).
		WithArgs(userID, "three_contexts_ready").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	ctx := httptest.NewRequest(http.MethodPost, "/", nil).Context()
	err = completeLearningModule(ctx, db, userID, moduleID, learningCompletionBody{
		QuizScore:          1,
		QuizMaxScore:       1,
		ChecklistCompleted: true,
	}, time.Now().UTC())
	if err != nil {
		t.Fatalf("complete existing module: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("existing completion should evaluate badges without issuing XP mutations: %v", err)
	}
}

func TestCompleteLearningModuleDoesNotAwardXPWhenCompletionWinsConflict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	userID := "11111111-1111-1111-1111-111111111111"
	moduleID := "home-evacuation-plan"
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO learning_user_stats (user_id)
VALUES ($1)
ON CONFLICT (user_id) DO NOTHING`)).
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(1, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT total_xp, current_streak_days, longest_streak_days, last_activity_date
FROM learning_user_stats
WHERE user_id = $1
FOR UPDATE`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"total_xp", "current_streak_days", "longest_streak_days", "last_activity_date"}).
			AddRow(0, 0, 0, nil))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT xp_earned
FROM learning_module_progress
WHERE user_id = $1 AND module_id = $2 AND status = 'completed'`)).
		WithArgs(userID, moduleID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("INSERT INTO learning_module_progress").
		WithArgs(userID, moduleID, 1, 1, true, 80).
		WillReturnRows(sqlmock.NewRows([]string{"xp_earned"}))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*)
FROM learning_module_progress
WHERE user_id = $1
  AND status = 'completed'
  AND module_id IN ('home-evacuation-plan', 'office-school-drill', 'public-travel-safety')`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO learning_user_badges (user_id, badge_id)
VALUES ($1, $2)
ON CONFLICT (user_id, badge_id) DO NOTHING`)).
		WithArgs(userID, "first_step").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO learning_user_badges (user_id, badge_id)
VALUES ($1, $2)
ON CONFLICT (user_id, badge_id) DO NOTHING`)).
		WithArgs(userID, "home_ready").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	ctx := httptest.NewRequest(http.MethodPost, "/", nil).Context()
	err = completeLearningModule(ctx, db, userID, moduleID, learningCompletionBody{
		QuizScore:          1,
		QuizMaxScore:       1,
		ChecklistCompleted: true,
	}, time.Now().UTC())
	if err != nil {
		t.Fatalf("complete conflicted module: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("conflicted completion should not issue XP mutations: %v", err)
	}
}
