package http

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	localTokenTTL          = 7 * 24 * time.Hour
	localPasswordMinLength = 8
	localTokenIssuer       = "sadar-bencana"
)

type localUser struct {
	ID       string
	Email    string
	Password string
	Role     string
}

// verifyTurnstile validates a Cloudflare Turnstile response token when a
// secret is configured. Without a secret (local development) verification is
// skipped; callers that require captcha in production must set
// TURNSTILE_SECRET_KEY.
func verifyTurnstile(client *http.Client, secret, responseToken string) error {
	if secret == "" {
		return nil
	}
	if responseToken == "" {
		return errors.New("missing captcha token")
	}
	form := url.Values{
		"secret":   {secret},
		"response": {responseToken},
	}
	resp, err := client.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify", form)
	if err != nil {
		return fmt.Errorf("turnstile unreachable: %w", err)
	}
	defer resp.Body.Close()
	var body struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("turnstile response invalid: %w", err)
	}
	if !body.Success {
		return errors.New("captcha verification failed")
	}
	return nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	// lib/pq and pgx both surface the SQLSTATE: 23505 = unique_violation;
	// pgx error text also reads "violates unique constraint".
	msg := err.Error()
	return strings.Contains(msg, "23505") || strings.Contains(msg, "violates unique constraint")
}

func issueLocalToken(jwtSecret, userID, email string) (string, time.Time, error) {
	expiresAt := time.Now().Add(localTokenTTL)
	claims := jwt.MapClaims{
		"sub":   userID,
		"email": email,
		"iss":   localTokenIssuer,
		"iat":   time.Now().Unix(),
		"exp":   expiresAt.Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(jwtSecret))
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expiresAt, nil
}

func localAuthResponse(jwtSecret, userID, email, role string) (gin.H, error) {
	token, expiresAt, err := issueLocalToken(jwtSecret, userID, email)
	if err != nil {
		return nil, err
	}
	return gin.H{
		"access_token": token,
		"token_type":   "bearer",
		"expires_in":   int(localTokenTTL.Seconds()),
		"expires_at":   expiresAt.UTC().Format(time.RFC3339),
		"user": gin.H{
			"id":    userID,
			"email": email,
			"role":  role,
		},
	}, nil
}

func validateCredentials(email, password string) error {
	if _, err := mail.ParseAddress(email); err != nil || !strings.Contains(email, "@") {
		return errors.New("invalid email address")
	}
	if len(password) < localPasswordMinLength {
		return fmt.Errorf("password must be at least %d characters", localPasswordMinLength)
	}
	return nil
}

// fetchLocalUserByEmail loads a local user by email for login.
func fetchLocalUserByEmail(db *sql.DB, email string) (localUser, error) {
	var u localUser
	err := db.QueryRow(
		`SELECT id, email, password_hash, role FROM local_users WHERE email = $1`,
		strings.ToLower(email),
	).Scan(&u.ID, &u.Email, &u.Password, &u.Role)
	if errors.Is(err, sql.ErrNoRows) {
		return localUser{}, err
	}
	if err != nil {
		return localUser{}, fmt.Errorf("query local user: %w", err)
	}
	return u, nil
}

// LocalAuthRegister creates a local account and returns a signed JWT.
func LocalAuthRegister(db *sql.DB, jwtSecret, turnstileSecret string) gin.HandlerFunc {
	client := &http.Client{Timeout: 10 * time.Second}
	return func(c *gin.Context) {
		var req struct {
			Email        string `json:"email"`
			Password     string `json:"password"`
			CaptchaToken string `json:"captcha_token"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
			return
		}
		if err := validateCredentials(req.Email, req.Password); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_credentials", "message": err.Error()})
			return
		}
		if err := verifyTurnstile(client, turnstileSecret, req.CaptchaToken); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "captcha_failed", "message": err.Error()})
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "password_hash_failed"})
			return
		}

		var id string
		err = db.QueryRow(
			`INSERT INTO local_users (email, password_hash) VALUES ($1, $2) RETURNING id`,
			strings.ToLower(req.Email), string(hash),
		).Scan(&id)
		if err != nil {
			if isUniqueViolation(err) {
				c.JSON(http.StatusConflict, gin.H{"error": "email_already_registered"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "registration_failed"})
			return
		}

		body, err := localAuthResponse(jwtSecret, id, strings.ToLower(req.Email), "user")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "token_failed"})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": body})
	}
}

// LocalAuthLogin verifies credentials and returns a signed JWT.
func LocalAuthLogin(db *sql.DB, jwtSecret, turnstileSecret string) gin.HandlerFunc {
	client := &http.Client{Timeout: 10 * time.Second}
	return func(c *gin.Context) {
		var req struct {
			Email        string `json:"email"`
			Password     string `json:"password"`
			CaptchaToken string `json:"captcha_token"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
			return
		}
		if err := verifyTurnstile(client, turnstileSecret, req.CaptchaToken); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "captcha_failed", "message": err.Error()})
			return
		}

		user, err := fetchLocalUserByEmail(db, req.Email)
		if errors.Is(err, sql.ErrNoRows) {
			// Same response as wrong password to avoid user enumeration.
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_credentials"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "login_failed"})
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)) != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_credentials"})
			return
		}

		body, err := localAuthResponse(jwtSecret, user.ID, user.Email, user.Role)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "token_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": body})
	}
}

// LocalAuthMe returns the authenticated local user (requires SupabaseAuth
// middleware; the same JWT format is used for both).
func LocalAuthMe(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := AuthUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		var email, role string
		err := db.QueryRow(
			`SELECT email, role FROM local_users WHERE id = $1`, userID,
		).Scan(&email, &role)
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "profile_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": userID, "email": email, "role": role}})
	}
}
