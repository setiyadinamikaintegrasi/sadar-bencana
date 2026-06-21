package http

import "github.com/gin-gonic/gin"

func Meta(env string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{
			"service":     "Reinsurance Risk Monitor",
			"version":     "0.1.0",
			"environment": env,
			"endpoints":   []string{"/health", "/api/v1/meta"},
		})
	}
}
