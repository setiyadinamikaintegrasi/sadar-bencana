package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func adminUsersRouter(adminEmails string, handler gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("/admin/users", func(c *gin.Context) {
		c.Set(ctxAuthUserID, "user-1")
		c.Set(ctxAuthEmail, c.GetHeader("X-Test-Email"))
	}, RequireAdminEmail(adminEmails))
	{
		group.GET("", handler)
	}
	return router
}

func TestRequireAdminEmail(t *testing.T) {
	handler := func(c *gin.Context) { c.Status(http.StatusOK) }

	cases := []struct {
		name        string
		adminEmails string
		email       string
		want        int
	}{
		{"whitelist cocok (case-insensitive)", "Admin@Example.com,user@x.id", "USER@X.ID", http.StatusOK},
		{"email di luar whitelist", "admin@example.com", "intruder@x.id", http.StatusForbidden},
		{"whitelist kosong -> 403 not configured", "", "admin@example.com", http.StatusForbidden},
		{"spasi di daftar dibersihkan", "a@x.id , b@x.id", "b@x.id", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			router := adminUsersRouter(tc.adminEmails, handler)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/admin/users", nil)
			req.Header.Set("X-Test-Email", tc.email)
			router.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestAdminUsersListNotConfigured(t *testing.T) {
	handler := AdminUsersList("", "")
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	handler(c)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "admin_api_not_configured" {
		t.Fatalf("error = %v, want admin_api_not_configured", body["error"])
	}
}

func TestAdminUsersListProxiesGoTrue(t *testing.T) {
	var capturedPath, capturedAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.String()
		capturedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		confirmed := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
		_ = json.NewEncoder(w).Encode(gotrueUsersPage{
			Users: []gotrueUser{{
				ID:               "u-1",
				Email:            "a@x.id",
				EmailConfirmedAt: &confirmed,
				CreatedAt:        &confirmed,
				BannedUntil:      strPtr("2030-01-01T00:00:00Z"),
			}},
			Total: 1, Last: 1, Next: 0,
		})
	}))
	defer srv.Close()

	router := adminUsersRouter("admin@x.id", AdminUsersList(srv.URL, "role-key"))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/users?q=peru", nil)
	req.Header.Set("X-Test-Email", "admin@x.id")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(capturedPath, "search=peru") {
		t.Fatalf("path tidak meneruskan search: %s", capturedPath)
	}
	if capturedAuth != "Bearer role-key" {
		t.Fatalf("Authorization = %q", capturedAuth)
	}
	var body struct {
		Data []AdminUser `json:"data"`
		Meta struct {
			Total int `json:"total"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 1 || body.Data[0].Email != "a@x.id" {
		t.Fatalf("data = %+v", body.Data)
	}
	if body.Data[0].BannedUntil == nil {
		t.Fatal("BannedUntil harus terisi dari string RFC3339")
	}
	if body.Meta.Total != 1 {
		t.Fatalf("meta.total = %d", body.Meta.Total)
	}
}

func TestAdminUserBanBody(t *testing.T) {
	var capturedBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 128)
		n, _ := r.Body.Read(buf)
		capturedBody = string(buf[:n])
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"u-1","email":"a@x.id"}`))
	}))
	defer srv.Close()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/ban/:id", AdminUserBan(srv.URL, "k", nil))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/ban/u-1", strings.NewReader(`{"banned":true}`))
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(capturedBody, "ban_duration") {
		t.Fatalf("body ke GoTrue = %q", capturedBody)
	}
}

func TestAdminUserResendValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/resend/:id", AdminUserResendConfirmation("http://localhost:1", "k"))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/resend/u-1", strings.NewReader(`{"type":"sms"}`))
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 utk type invalid", rec.Code)
	}
}

func strPtr(s string) *string { return &s }
