package http

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
)

func isEWSAdmin(c *gin.Context, db *sql.DB) bool {
	var role string
	err := db.QueryRowContext(c.Request.Context(),
		`SELECT role FROM ews_subscribers
		 WHERE lower(email)=lower($1) AND is_active=TRUE
		 LIMIT 1`,
		AuthEmail(c),
	).Scan(&role)
	return err == nil && role == "admin"
}

// RequireEWSAdmin restricts administrative EWS routes to active subscribers
// whose role is explicitly set to admin.
func RequireEWSAdmin(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			c.Abort()
			return
		}
		if !isEWSAdmin(c, db) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin_required"})
			return
		}
		c.Next()
	}
}
