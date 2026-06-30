package http

import (
	"database/sql"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var administrativeCodePattern = regexp.MustCompile(`^[0-9]{2}(\.[0-9]{2}){0,2}$`)

const regionalCountsQuery = `
SELECT date_part('year', occurred_at)::int AS year, peril_type, count(*)
FROM historical_disaster_events
WHERE administrative_code = $1
  AND occurred_at >= $2 AND occurred_at < $3
  AND ($4 = '' OR peril_type = $4)
GROUP BY 1, 2 ORDER BY 1, 2
`

const regionalSeasonalityQuery = `
SELECT date_part('month', occurred_at)::int AS month, count(*)
FROM historical_disaster_events
WHERE administrative_code = $1
  AND occurred_at >= $2 AND occurred_at < $3
  AND ($4 = '' OR peril_type = $4)
GROUP BY 1 ORDER BY 1
`

const regionalImpactQuery = `
WITH latest AS (
  SELECT DISTINCT ON (historical_event_id) *
  FROM historical_impact_revisions
  ORDER BY historical_event_id, revision DESC
)
SELECT COALESCE(sum(deaths),0), COALESCE(sum(missing),0),
       COALESCE(sum(injured),0), COALESCE(sum(displaced),0),
       COALESCE(sum(houses_damaged),0)
FROM historical_disaster_events e
LEFT JOIN latest i ON i.historical_event_id = e.id
WHERE e.administrative_code = $1
  AND e.occurred_at >= $2 AND e.occurred_at < $3
  AND ($4 = '' OR e.peril_type = $4)
`

const regionalCoverageQuery = `
SELECT d.source_name, d.dataset_version, max(d.ingested_at), count(e.id)
FROM historical_datasets d
JOIN historical_disaster_events e ON e.dataset_id = d.id
WHERE e.administrative_code = $1
  AND e.occurred_at >= $2 AND e.occurred_at < $3
  AND ($4 = '' OR e.peril_type = $4)
GROUP BY d.source_name, d.dataset_version
ORDER BY d.source_name
`

// RegionalHistoryProfile returns reproducible warehouse statistics by admin code.
func RegionalHistoryProfile(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		code := strings.TrimSpace(c.Param("code"))
		if !administrativeCodePattern.MatchString(code) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_administrative_code"})
			return
		}
		to := time.Now().UTC()
		from := to.AddDate(-10, 0, 0)
		var err error
		if raw := strings.TrimSpace(c.Query("from")); raw != "" {
			from, err = time.Parse("2006-01-02", raw)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_from"})
				return
			}
		}
		if raw := strings.TrimSpace(c.Query("to")); raw != "" {
			to, err = time.Parse("2006-01-02", raw)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_to"})
				return
			}
			to = to.AddDate(0, 0, 1)
		}
		if !from.Before(to) || to.Sub(from) > 50*366*24*time.Hour {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_period"})
			return
		}
		peril := strings.ToLower(strings.TrimSpace(c.Query("peril")))

		rows, err := db.QueryContext(c.Request.Context(), regionalCountsQuery, code, from, to, peril)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		timeline := make([]gin.H, 0)
		for rows.Next() {
			var year, count int
			var perilType string
			if err := rows.Scan(&year, &perilType, &count); err != nil {
				rows.Close()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			timeline = append(timeline, gin.H{"year": year, "peril": perilType, "event_count": count})
		}
		rows.Close()

		rows, err = db.QueryContext(c.Request.Context(), regionalSeasonalityQuery, code, from, to, peril)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		seasonality := make([]gin.H, 0)
		for rows.Next() {
			var month, count int
			if err := rows.Scan(&month, &count); err != nil {
				rows.Close()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			seasonality = append(seasonality, gin.H{"month": month, "event_count": count})
		}
		rows.Close()

		var deaths, missing, injured, displaced, damaged int64
		if err := db.QueryRowContext(c.Request.Context(), regionalImpactQuery, code, from, to, peril).
			Scan(&deaths, &missing, &injured, &displaced, &damaged); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}

		rows, err = db.QueryContext(c.Request.Context(), regionalCoverageQuery, code, from, to, peril)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		coverage := make([]gin.H, 0)
		var freshest *time.Time
		for rows.Next() {
			var source, version string
			var ingested time.Time
			var count int
			if err := rows.Scan(&source, &version, &ingested, &count); err != nil {
				rows.Close()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			if freshest == nil || ingested.After(*freshest) {
				value := ingested
				freshest = &value
			}
			coverage = append(coverage, gin.H{"source": source, "dataset_version": version, "event_count": count})
		}
		rows.Close()

		c.JSON(http.StatusOK, gin.H{
			"administrative_code": code,
			"period":              gin.H{"from": from.Format("2006-01-02"), "to": to.AddDate(0, 0, -1).Format("2006-01-02")},
			"peril_filter":        peril,
			"timeline":            timeline,
			"seasonality":         seasonality,
			"impact":              gin.H{"deaths": deaths, "missing": missing, "injured": injured, "displaced": displaced, "houses_damaged": damaged},
			"source_coverage":     coverage,
			"data_freshness":      freshest,
			"method":              "warehouse-counts-v1; latest immutable impact revision per event",
			"limitations":         []string{"Missing impact values are excluded from source records and aggregate as zero.", "Boundary resolution uses administrative code and dataset validity."},
		})
	}
}
