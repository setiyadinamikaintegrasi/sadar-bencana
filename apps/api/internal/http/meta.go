package http

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// Meta melaporkan info layanan + risk_free_limit (0 = tanpa batas) agar UI
// tahu batas register risiko untuk deployment ini.
func Meta(env string, riskFreeLimit int, deploymentMode string, personalAssetLimit int) gin.HandlerFunc {
	return func(c *gin.Context) {
		effectivePersonalLimit := personalAssetLimit
		if strings.EqualFold(deploymentMode, "community") {
			effectivePersonalLimit = 0
		}
		c.JSON(200, gin.H{
			"service":              "Risk Monitor",
			"version":              "0.1.0",
			"environment":          env,
			"risk_free_limit":      riskFreeLimit,
			"deployment_mode":      deploymentMode,
			"personal_asset_limit": effectivePersonalLimit,
			"endpoints":            []string{"/health", "/api/v1/meta"},
		})
	}
}
