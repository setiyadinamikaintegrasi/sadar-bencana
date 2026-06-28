package http

import "github.com/gin-gonic/gin"

// Meta melaporkan info layanan + risk_free_limit (0 = tanpa batas) agar UI
// tahu batas register risiko untuk deployment ini.
func Meta(env string, riskFreeLimit int) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{
			"service":         "Risk Monitor",
			"version":         "0.1.0",
			"environment":     env,
			"risk_free_limit": riskFreeLimit,
			"endpoints":       []string{"/health", "/api/v1/meta"},
		})
	}
}
