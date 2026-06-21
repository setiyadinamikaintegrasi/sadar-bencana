package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ExposureRule mirrors an active exposure baseline rule for a region.
type ExposureRule struct {
	ID              string    `json:"id"`
	RegionName      string    `json:"region_name"`
	RegionKeywords  []string  `json:"region_keywords"`
	TotalExposure   int64     `json:"total_exposure"`
	TreatyCategory  string    `json:"treaty_category"`
	RiskMultiplier  float64   `json:"risk_multiplier"`
	IsActive        bool      `json:"is_active"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	EstimatedImpact int64     `json:"estimated_impact,omitempty"`
	MatchedKeyword  string    `json:"matched_keyword,omitempty"`
	MatchedPlace    string    `json:"matched_place,omitempty"`
}

const exposureRulesQuery = `
SELECT id,
       region_name,
       COALESCE(array_to_json(region_keywords), '[]'::json),
       total_exposure,
       treaty_category,
       risk_multiplier,
       is_active,
       created_at,
       updated_at
FROM exposure_rules
WHERE is_active = TRUE
ORDER BY total_exposure DESC, region_name ASC
`

const exposureRuleMatchQuery = `
SELECT er.id,
       er.region_name,
       COALESCE(array_to_json(er.region_keywords), '[]'::json),
       er.total_exposure,
       er.treaty_category,
       er.risk_multiplier,
       er.is_active,
       er.created_at,
       er.updated_at,
       ROUND(er.total_exposure * er.risk_multiplier, 0)::BIGINT AS estimated_impact,
       (
           SELECT keyword
           FROM unnest(er.region_keywords) AS keyword
           WHERE POSITION(LOWER(keyword) IN LOWER($1)) > 0
           ORDER BY LENGTH(keyword) DESC
           LIMIT 1
       ) AS matched_keyword
FROM exposure_rules er
WHERE er.is_active = TRUE
  AND EXISTS (
      SELECT 1
      FROM unnest(er.region_keywords) AS keyword
      WHERE POSITION(LOWER(keyword) IN LOWER($1)) > 0
  )
ORDER BY (
    SELECT MAX(LENGTH(keyword))
    FROM unnest(er.region_keywords) AS keyword
    WHERE POSITION(LOWER(keyword) IN LOWER($1)) > 0
) DESC,
 er.total_exposure DESC
LIMIT 1
`

// Exposures returns a gin.HandlerFunc that lists all active exposure rules.
func Exposures(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), exposureRulesQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		rules := make([]ExposureRule, 0)
		for rows.Next() {
			rule, err := scanExposureRule(rows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			rules = append(rules, rule)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": rules,
			"meta": gin.H{
				"count": len(rules),
			},
		})
	}
}

// ExposureMatch returns the best active exposure rule matched against an event place string.
func ExposureMatch(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		place := strings.TrimSpace(c.Query("place"))
		if place == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_place",
				"message": "query parameter 'place' is required",
			})
			return
		}

		var (
			rule           ExposureRule
			keywordsJSON   []byte
			riskMultiplier float64
			matchedKeyword sql.NullString
		)

		err := db.QueryRowContext(c.Request.Context(), exposureRuleMatchQuery, place).Scan(
			&rule.ID,
			&rule.RegionName,
			&keywordsJSON,
			&rule.TotalExposure,
			&rule.TreatyCategory,
			&riskMultiplier,
			&rule.IsActive,
			&rule.CreatedAt,
			&rule.UpdatedAt,
			&rule.EstimatedImpact,
			&matchedKeyword,
		)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusOK, gin.H{
					"data": []ExposureRule{},
					"meta": gin.H{
						"count": 0,
						"place": place,
					},
				})
				return
			}
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}

		rule.RiskMultiplier = riskMultiplier
		rule.MatchedPlace = place
		if matchedKeyword.Valid {
			rule.MatchedKeyword = matchedKeyword.String
		}
		if err := json.Unmarshal(keywordsJSON, &rule.RegionKeywords); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "row_scan_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": []ExposureRule{rule},
			"meta": gin.H{
				"count": 1,
				"place": place,
			},
		})
	}
}

func scanExposureRule(scanner interface {
	Scan(dest ...any) error
}) (ExposureRule, error) {
	var rule ExposureRule
	var keywordsJSON []byte
	var riskMultiplier float64
	if err := scanner.Scan(
		&rule.ID,
		&rule.RegionName,
		&keywordsJSON,
		&rule.TotalExposure,
		&rule.TreatyCategory,
		&riskMultiplier,
		&rule.IsActive,
		&rule.CreatedAt,
		&rule.UpdatedAt,
	); err != nil {
		return ExposureRule{}, err
	}
	if err := json.Unmarshal(keywordsJSON, &rule.RegionKeywords); err != nil {
		return ExposureRule{}, err
	}
	rule.RiskMultiplier = riskMultiplier
	return rule, nil
}
