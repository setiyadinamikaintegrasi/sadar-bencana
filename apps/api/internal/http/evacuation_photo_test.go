package http

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestEvacuationPhotoObjectName(t *testing.T) {
	name, err := evacuationPhotoObjectName("image/jpeg")
	if err != nil || !strings.HasSuffix(name, ".jpg") || len(name) < 10 {
		t.Fatalf("jpeg: name=%q err=%v", name, err)
	}
	if _, err := evacuationPhotoObjectName("application/pdf"); err == nil {
		t.Fatal("pdf harus ditolak")
	}
	a, _ := evacuationPhotoObjectName("image/png")
	b, _ := evacuationPhotoObjectName("image/png")
	if a == b {
		t.Fatal("nama objek harus unik antar panggilan")
	}
}

// TestEvacuationPhotoUploadRejectsOversizedBodyBeforeStorageCall memastikan
// body multipart yang melebihi batas ditolak oleh http.MaxBytesReader saat
// Gin mem-parsing form (di dalam FormFile), bukan hanya oleh pengecekan
// ukuran setelahnya. supabaseURL/serviceRoleKey diisi dummy non-kosong agar
// eksekusi mencapai FormFile; permintaan tidak akan pernah sampai memanggil
// storage karena parsing multipart gagal lebih dulu.
func TestEvacuationPhotoUploadRejectsOversizedBodyBeforeStorageCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/upload", EvacuationPhotoUpload("https://storage.example.test", "service-role-key"))

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "big.jpg")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	oversized := bytes.Repeat([]byte("a"), evacuationPhotoMaxBytes+1024)
	if _, err := part.Write(oversized); err != nil {
		t.Fatalf("write oversized payload: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/upload", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s, want 400", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"file_too_large"`) {
		t.Fatalf("unexpected response body: %s", recorder.Body.String())
	}
}
