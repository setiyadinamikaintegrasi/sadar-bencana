package http

import (
	"strings"
	"testing"
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
