package http

import "github.com/gin-gonic/gin"

func Health(c *gin.Context) {
	c.JSON(200, gin.H{
		"status":  "ok",
		"service": "sadar-bencana-api",
		"version": "0.1.0",
	})
}
