package http

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

const evacuationPhotoBucket = "evacuation-photos"
const evacuationPhotoMaxBytes = 5 << 20 // 5 MB

var evacuationPhotoExtensions = map[string]string{
	"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
}

// evacuationPhotoObjectName menghasilkan nama objek unik untuk content-type
// gambar yang diizinkan.
func evacuationPhotoObjectName(contentType string) (string, error) {
	ext, ok := evacuationPhotoExtensions[contentType]
	if !ok {
		return "", errors.New("tipe file harus JPEG, PNG, atau WebP")
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw) + ext, nil
}

// EvacuationPhotoUpload meneruskan foto (multipart) ke Supabase Storage via
// service role key. 503 bila storage belum dikonfigurasi (community deploy
// tanpa Supabase Storage tetap jalan tanpa fitur foto).
func EvacuationPhotoUpload(supabaseURL, serviceRoleKey string) gin.HandlerFunc {
	client := &http.Client{Timeout: 30 * time.Second}
	return func(c *gin.Context) {
		if supabaseURL == "" || serviceRoleKey == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "photo_storage_not_configured"})
			return
		}
		fileHeader, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing_file"})
			return
		}
		if fileHeader.Size > evacuationPhotoMaxBytes {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file_too_large", "message": "maksimum 5 MB"})
			return
		}
		contentType := fileHeader.Header.Get("Content-Type")
		objectName, err := evacuationPhotoObjectName(contentType)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_type", "message": err.Error()})
			return
		}
		f, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot_open_file"})
			return
		}
		defer f.Close()
		payload, err := io.ReadAll(io.LimitReader(f, evacuationPhotoMaxBytes+1))
		if err != nil || int64(len(payload)) > evacuationPhotoMaxBytes {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file_too_large"})
			return
		}
		uploadURL := fmt.Sprintf("%s/storage/v1/object/%s/%s", supabaseURL, evacuationPhotoBucket, objectName)
		req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, uploadURL, bytes.NewReader(payload))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "upload_request_failed"})
			return
		}
		req.Header.Set("Authorization", "Bearer "+serviceRoleKey)
		req.Header.Set("Content-Type", contentType)
		resp, err := client.Do(req)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "storage_unreachable"})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			c.JSON(http.StatusBadGateway, gin.H{"error": "storage_upload_failed", "status": resp.StatusCode})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": gin.H{
			"photo_url": fmt.Sprintf("%s/storage/v1/object/public/%s/%s", supabaseURL, evacuationPhotoBucket, objectName),
		}})
	}
}
