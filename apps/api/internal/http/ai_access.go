package http

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

const aiUsageStaleAfter = 5 * time.Minute

type AIUsageLimits struct {
	PerMinute        int
	PerDay           int
	Concurrent       int
	GlobalPerMinute  int
	GlobalPerDay     int
	GlobalConcurrent int
}

type AIUsageLease struct {
	db *sql.DB
	id string
}

func (lease *AIUsageLease) Finish(ctx context.Context, status string, responseStatus int) {
	if lease == nil || lease.db == nil || lease.id == "" {
		return
	}
	finishCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, _ = lease.db.ExecContext(finishCtx, `
UPDATE ai_usage_events
SET status=$2, response_status=$3, completed_at=NOW()
WHERE id=$1`, lease.id, status, responseStatus)
}

type aiLimitError struct {
	retryAfter int
	message    string
}

func (err *aiLimitError) Error() string { return err.message }

func beginAIUsage(ctx context.Context, db *sql.DB, authUserID, feature string, limits AIUsageLimits) (*AIUsageLease, error) {
	if db == nil {
		return nil, errors.New("AI usage database is unavailable")
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	lockKey := authUserID + ":" + feature
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return nil, err
	}
	if limits.GlobalConcurrent > 0 || limits.GlobalPerMinute > 0 || limits.GlobalPerDay > 0 {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "global:"+feature); err != nil {
			return nil, err
		}
	}

	var minuteCount, dayCount, activeCount int
	var globalMinuteCount, globalDayCount, globalActiveCount int
	if err := tx.QueryRowContext(ctx, `
SELECT
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 minute'),
  COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW())),
  COUNT(*) FILTER (
    WHERE status='started'
      AND created_at >= NOW() - ($3 * INTERVAL '1 second')
  ),
  (SELECT COUNT(*) FROM ai_usage_events global_usage
   WHERE global_usage.feature=$2
     AND global_usage.created_at >= NOW() - INTERVAL '1 minute'),
  (SELECT COUNT(*) FROM ai_usage_events global_usage
   WHERE global_usage.feature=$2
     AND global_usage.created_at >= date_trunc('day', NOW())),
  (SELECT COUNT(*) FROM ai_usage_events global_usage
   WHERE global_usage.feature=$2
     AND global_usage.status='started'
     AND global_usage.created_at >= NOW() - ($3 * INTERVAL '1 second'))
FROM ai_usage_events
WHERE auth_user_id=$1 AND feature=$2`,
		authUserID, feature, int(aiUsageStaleAfter.Seconds())).
		Scan(
			&minuteCount, &dayCount, &activeCount,
			&globalMinuteCount, &globalDayCount, &globalActiveCount,
		); err != nil {
		return nil, err
	}

	switch {
	case limits.GlobalPerMinute > 0 && globalMinuteCount >= limits.GlobalPerMinute:
		return nil, &aiLimitError{retryAfter: 60, message: "Kapasitas AI global per menit telah tercapai."}
	case limits.GlobalPerDay > 0 && globalDayCount >= limits.GlobalPerDay:
		return nil, &aiLimitError{retryAfter: secondsUntilTomorrow(), message: "Kuota AI global hari ini telah tercapai."}
	case limits.GlobalConcurrent > 0 && globalActiveCount >= limits.GlobalConcurrent:
		return nil, &aiLimitError{retryAfter: 30, message: "Executive Briefing sedang dibuat. Coba kembali sebentar lagi."}
	case limits.Concurrent > 0 && activeCount >= limits.Concurrent:
		return nil, &aiLimitError{retryAfter: 30, message: "Permintaan AI lain masih diproses untuk akun ini."}
	case limits.PerMinute > 0 && minuteCount >= limits.PerMinute:
		return nil, &aiLimitError{retryAfter: 60, message: "Batas permintaan AI per menit tercapai."}
	case limits.PerDay > 0 && dayCount >= limits.PerDay:
		return nil, &aiLimitError{retryAfter: secondsUntilTomorrow(), message: "Kuota AI harian akun ini telah tercapai."}
	}

	var id string
	if err := tx.QueryRowContext(ctx, `
INSERT INTO ai_usage_events (auth_user_id, feature, status)
VALUES ($1, $2, 'started')
RETURNING id`, authUserID, feature).Scan(&id); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &AIUsageLease{db: db, id: id}, nil
}

func acquireAIUsage(c *gin.Context, db *sql.DB, feature string, limits AIUsageLimits) (*AIUsageLease, bool) {
	lease, err := beginAIUsage(c.Request.Context(), db, AuthUserID(c), feature, limits)
	if err == nil {
		return lease, true
	}

	var limitErr *aiLimitError
	if errors.As(err, &limitErr) {
		c.Header("Retry-After", fmt.Sprintf("%d", limitErr.retryAfter))
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error":               "ai_rate_limited",
			"message":             limitErr.message,
			"retry_after_seconds": limitErr.retryAfter,
		})
		return nil, false
	}

	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error":   "ai_usage_unavailable",
		"message": "Kontrol penggunaan AI sedang tidak tersedia.",
	})
	return nil, false
}

func secondsUntilTomorrow() int {
	now := time.Now()
	tomorrow := now.AddDate(0, 0, 1)
	tomorrow = time.Date(tomorrow.Year(), tomorrow.Month(), tomorrow.Day(), 0, 0, 0, 0, now.Location())
	seconds := int(time.Until(tomorrow).Seconds())
	if seconds < 1 {
		return 1
	}
	return seconds
}
