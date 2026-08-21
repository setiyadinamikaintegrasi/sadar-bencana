package http

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// Admin Pengguna — proxy ke GoTrue (Supabase Auth) Admin API.
// Akses dibatasi ke whitelist email (ADMIN_EMAILS) — tanpa tabel role baru.
// ============================================================================

// AdminUser adalah representasi ringkas user GoTrue untuk UI admin.
type AdminUser struct {
	ID                string     `json:"id"`
	Email             string     `json:"email"`
	EmailConfirmedAt  *time.Time `json:"email_confirmed_at"`
	InvitedAt         *time.Time `json:"invited_at"`
	LastSignInAt      *time.Time `json:"last_sign_in_at"`
	CreatedAt         *time.Time `json:"created_at"`
	BannedUntil       *time.Time `json:"banned_until"`
	RawUserMetaData   map[string]any `json:"raw_user_meta_data,omitempty"`
}

type gotrueUser struct {
	ID               string     `json:"id"`
	Email            string     `json:"email"`
	EmailConfirmedAt *time.Time `json:"email_confirmed_at"`
	InvitedAt        *time.Time `json:"invited_at"`
	LastSignInAt     *time.Time `json:"last_sign_in_at"`
	CreatedAt        *time.Time `json:"created_at"`
	BannedUntil      *string    `json:"banned_until"`
	RawUserMetaData  map[string]any `json:"raw_user_meta_data"`
}

type gotrueUsersPage struct {
	Users []gotrueUser `json:"users"`
	Next  int          `json:"next_page"`
	Last  int          `json:"last_page"`
	Total int          `json:"total"`
}

// RequireAdminEmail membatasi route ke email yang terdaftar di ADMIN_EMAILS
// (dipisah koma, case-insensitive). Kosong berarti fitur admin nonaktif.
func RequireAdminEmail(adminEmails string) gin.HandlerFunc {
	allowed := make(map[string]struct{})
	for _, raw := range strings.Split(adminEmails, ",") {
		email := strings.ToLower(strings.TrimSpace(raw))
		if email != "" {
			allowed[email] = struct{}{}
		}
	}
	return func(c *gin.Context) {
		if len(allowed) == 0 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin_users_not_configured", "message": "ADMIN_EMAILS belum dikonfigurasi di server."})
			return
		}
		email := strings.ToLower(AuthEmail(c))
		if _, ok := allowed[email]; !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin_required"})
			return
		}
		c.Next()
	}
}

func gotrueAdminRequest(c *gin.Context, supabaseURL, serviceRoleKey, method, path string, body io.Reader) (*http.Response, error) {
	endpoint := strings.TrimRight(supabaseURL, "/") + path
	req, err := http.NewRequestWithContext(c.Request.Context(), method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+serviceRoleKey)
	req.Header.Set("apikey", serviceRoleKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 15 * time.Second}
	return client.Do(req)
}

func toAdminUser(u gotrueUser) AdminUser {
	return AdminUser{
		ID:               u.ID,
		Email:            u.Email,
		EmailConfirmedAt: u.EmailConfirmedAt,
		InvitedAt:        u.InvitedAt,
		LastSignInAt:     u.LastSignInAt,
		CreatedAt:        u.CreatedAt,
		BannedUntil:      parseGotrueTime(u.BannedUntil),
		RawUserMetaData:  u.RawUserMetaData,
	}
}

func parseGotrueTime(raw *string) *time.Time {
	if raw == nil || *raw == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, *raw)
	if err != nil {
		return nil
	}
	return &t
}

// AdminUsersList mendaftar pengguna GoTrue dengan pencarian opsional.
// GET /api/v1/admin/users?q=&page=&per_page=
func AdminUsersList(supabaseURL, serviceRoleKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if serviceRoleKey == "" || supabaseURL == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "admin_api_not_configured", "message": "SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL belum diset."})
			return
		}
		params := url.Values{}
		if q := strings.TrimSpace(c.Query("q")); q != "" {
			params.Set("search", q)
		}
		params.Set("per_page", "50")
		page := 1
		if raw := c.Query("page"); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
				page = parsed
			}
		}

		var all []AdminUser
		total := 0
		last := 1
		for p := 1; ; p++ {
			params.Set("page", strconv.Itoa(p))
			resp, err := gotrueAdminRequest(c, supabaseURL, serviceRoleKey, http.MethodGet, "/admin/users?"+params.Encode(), nil)
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "auth_admin_unreachable", "message": err.Error()})
				return
			}
			defer resp.Body.Close()
			rawBody, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != http.StatusOK {
				c.JSON(resp.StatusCode, gin.H{"error": "auth_admin_error", "status": resp.StatusCode, "message": truncateForJSON(rawBody, 300)})
				return
			}
			var pageData gotrueUsersPage
			if err := json.Unmarshal(rawBody, &pageData); err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "auth_admin_decode_failed", "message": err.Error()})
				return
			}
			for _, u := range pageData.Users {
				all = append(all, toAdminUser(u))
			}
			total = pageData.Total
			last = pageData.Last
			if pageData.Next == 0 || p >= pageData.Last || p >= 20 {
				break
			}
		}
		if all == nil {
			all = []AdminUser{}
		}
		c.JSON(http.StatusOK, gin.H{"data": all, "meta": gin.H{"total": total, "pages": last, "page": page}})
	}
}

// AdminUserDelete menghapus pengguna permanen. DELETE /api/v1/admin/users/:id
func AdminUserDelete(supabaseURL, serviceRoleKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id_required"})
			return
		}
		resp, err := gotrueAdminRequest(c, supabaseURL, serviceRoleKey, http.MethodDelete, "/admin/users/"+url.PathEscape(id), nil)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "auth_admin_unreachable", "message": err.Error()})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
			rawBody, _ := io.ReadAll(resp.Body)
			c.JSON(resp.StatusCode, gin.H{"error": "auth_admin_error", "message": truncateForJSON(rawBody, 300)})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": id})
	}
}

// AdminUserBan memberi/menghapus ban pada pengguna.
// Ban: PUT /admin/users/:id {"ban_duration":"876000h"} (terverifikasi GoTrue v2.181).
// Unban: GoTrue build ini MENGABAIKAN banned_until:null pada PUT (bug diverifikasi)
// sehingga unban dilakukan langsung ke auth.users (jalur yang terverifikasi).
// POST /api/v1/admin/users/:id/ban  {"banned": true|false}
func AdminUserBan(supabaseURL, serviceRoleKey string, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var payload struct {
			Banned bool `json:"banned"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}

		if payload.Banned {
			bodyBytes, _ := json.Marshal(map[string]any{"ban_duration": "876000h"})
			resp, err := gotrueAdminRequest(c, supabaseURL, serviceRoleKey, http.MethodPut, "/admin/users/"+url.PathEscape(id), bytes.NewReader(bodyBytes))
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "auth_admin_unreachable", "message": err.Error()})
				return
			}
			defer resp.Body.Close()
			rawBody, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != http.StatusOK {
				c.JSON(resp.StatusCode, gin.H{"error": "auth_admin_error", "message": truncateForJSON(rawBody, 300)})
				return
			}
			var updated gotrueUser
			_ = json.Unmarshal(rawBody, &updated)
			c.JSON(http.StatusOK, gin.H{"data": toAdminUser(updated)})
			return
		}

		// Unban: langsung ke DB — PUT banned_until:null diabaikan GoTrue build ini.
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
			return
		}
		result, err := db.ExecContext(c.Request.Context(),
			`UPDATE auth.users SET banned_until = NULL, updated_at = now() WHERE id = $1`, id)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "user_not_found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id, "banned_until": nil}})
	}
}

// AdminUserResendConfirmation membuat tautan konfirmasi baru untuk pengguna.
// GoTrue v2.181 build ini tidak punya /admin/users/:id/resend — diverifikasi
// bahwa /admin/generate_link {"type":"signup"} bekerja untuk user existing
// dan mengembalikan action_link (yang bisa dikirim via email channel sendiri).
// POST /api/v1/admin/users/:id/resend  (body opsional {"type":"signup"|"invite"})
func AdminUserResendConfirmation(supabaseURL, serviceRoleKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		payload := struct {
			Type string `json:"type"`
		}{Type: "magiclink"}
		_ = c.ShouldBindJSON(&payload)
		if payload.Type != "magiclink" && payload.Type != "invite" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_type", "message": "type harus 'magiclink' (tautan masuk utk user terdaftar) atau 'invite' (undangan utk email baru)."})
			return
		}

		// Ambil email user dari GoTrue admin list (search by id tidak tersedia;
		// gunakan GET /admin/users/:id yang didukung).
		resp, err := gotrueAdminRequest(c, supabaseURL, serviceRoleKey, http.MethodGet, "/admin/users/"+url.PathEscape(id), nil)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "auth_admin_unreachable", "message": err.Error()})
			return
		}
		defer resp.Body.Close()
		rawBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			c.JSON(resp.StatusCode, gin.H{"error": "auth_admin_error", "message": truncateForJSON(rawBody, 300)})
			return
		}
		var target gotrueUser
		if err := json.Unmarshal(rawBody, &target); err != nil || target.Email == "" {
			c.JSON(http.StatusBadGateway, gin.H{"error": "auth_admin_decode_failed"})
			return
		}

		linkBody, _ := json.Marshal(map[string]string{"type": payload.Type, "email": target.Email})
		linkResp, err := gotrueAdminRequest(c, supabaseURL, serviceRoleKey, http.MethodPost, "/admin/generate_link", bytes.NewReader(linkBody))
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "auth_admin_unreachable", "message": err.Error()})
			return
		}
		defer linkResp.Body.Close()
		linkRaw, _ := io.ReadAll(linkResp.Body)
		if linkResp.StatusCode != http.StatusOK {
			c.JSON(linkResp.StatusCode, gin.H{"error": "auth_admin_error", "message": truncateForJSON(linkRaw, 300)})
			return
		}
		var linkResult struct {
			ActionLink string `json:"action_link"`
		}
		_ = json.Unmarshal(linkRaw, &linkResult)
		// SMTP belum dikonfigurasi di lingkungan ini — kembalikan action_link
		// agar admin dapat menyalin/mengirim lewat kanal manual sampai SMTP aktif.
		c.JSON(http.StatusOK, gin.H{"resent": payload.Type, "action_link": linkResult.ActionLink, "email": target.Email})
	}
}

func truncateForJSON(b []byte, n int) string {
	s := strings.TrimSpace(string(b))
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
