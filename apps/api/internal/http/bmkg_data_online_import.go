package http

import (
	"bytes"
	"database/sql"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const maxBMKGWorkbookBytes = 10 << 20

func BMKGDataOnlinePreview(db *sql.DB, workerBaseURL string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBMKGWorkbookBytes)
		content, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "workbook_too_large"})
			return
		}
		if len(content) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "workbook_required"})
			return
		}
		endpoint := strings.TrimRight(workerBaseURL, "/") + "/api/v1/worker/imports/bmkg-data-online/preview"
		request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, endpoint, bytes.NewReader(content))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "worker_request_failed"})
			return
		}
		request.Header.Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "worker_unavailable"})
			return
		}
		defer response.Body.Close()
		c.DataFromReader(
			response.StatusCode,
			response.ContentLength,
			response.Header.Get("Content-Type"),
			response.Body,
			nil,
		)
	}
}
