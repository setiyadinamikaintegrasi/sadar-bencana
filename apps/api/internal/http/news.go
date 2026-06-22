package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// NewsItem mirrors a row of the news_items table.
type NewsItem struct {
	ID          string     `json:"id"`
	ItemID      string     `json:"item_id"`
	Source      string     `json:"source"`
	Title       string     `json:"title"`
	Summary     string     `json:"summary"`
	URL         string     `json:"url"`
	PublishedAt *time.Time `json:"published_at"`
	Perils      []string   `json:"perils"`
	CreatedAt   time.Time  `json:"created_at"`
}

const newsQuery = `
SELECT id,
       item_id,
       source,
       title,
       summary,
       url,
       published_at,
       COALESCE(array_to_json(perils), '[]'::json),
       created_at
FROM news_items
ORDER BY published_at DESC NULLS LAST, created_at DESC
LIMIT 100
`

// News returns a gin.HandlerFunc that lists the most recent news items.
func News(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), newsQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		items := make([]NewsItem, 0, 100)
		for rows.Next() {
			item, err := scanNewsItem(rows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			items = append(items, item)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": items,
			"meta": gin.H{
				"count": len(items),
				"limit": 100,
			},
		})
	}
}

func scanNewsItem(scanner interface {
	Scan(dest ...any) error
}) (NewsItem, error) {
	var item NewsItem
	var perilsJSON []byte
	if err := scanner.Scan(
		&item.ID,
		&item.ItemID,
		&item.Source,
		&item.Title,
		&item.Summary,
		&item.URL,
		&item.PublishedAt,
		&perilsJSON,
		&item.CreatedAt,
	); err != nil {
		return NewsItem{}, err
	}
	if err := json.Unmarshal(perilsJSON, &item.Perils); err != nil {
		return NewsItem{}, err
	}
	return item, nil
}
