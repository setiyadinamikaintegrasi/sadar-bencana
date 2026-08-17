package http

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const testJWTSecret = "test-secret-that-is-longer-than-32-characters!!"

func postJSON(router http.Handler, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestLocalAuthRegisterIssuesToken(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`INSERT INTO local_users`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("user-123"))

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/register", LocalAuthRegister(db, testJWTSecret, ""))

	rec := postJSON(router, "/register", `{"email":"Uji@Example.com","password":"rahasia123"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			AccessToken string `json:"access_token"`
			User        struct {
				ID    string `json:"id"`
				Email string `json:"email"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Data.AccessToken == "" {
		t.Fatalf("expected access token")
	}
	if body.Data.User.Email != "uji@example.com" {
		t.Fatalf("email must be lowercased, got %q", body.Data.User.Email)
	}
	// Token must be verifiable with the same secret and carry sub/email.
	token, err := jwt.Parse(body.Data.AccessToken, func(t *jwt.Token) (interface{}, error) {
		return []byte(testJWTSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		t.Fatalf("issued token invalid: %v", err)
	}
	claims := token.Claims.(jwt.MapClaims)
	if claims["sub"] != "user-123" || claims["email"] != "uji@example.com" {
		t.Fatalf("unexpected claims: %v", claims)
	}
}

func TestLocalAuthRegisterValidatesInput(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/register", LocalAuthRegister(db, testJWTSecret, ""))

	cases := []string{
		`{"email":"not-an-email","password":"rahasia123"}`,
		`{"email":"uji@example.com","password":"short"}`,
		`{"email":"","password":""}`,
	}
	for _, body := range cases {
		rec := postJSON(router, "/register", body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %s: expected 400, got %d", body, rec.Code)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("no db calls expected but: %v", err)
	}
}

func TestLocalAuthRegisterDuplicateEmail(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`INSERT INTO local_users`).
		WillReturnError(errors.New(`pq: duplicate key value violates unique constraint "local_users_email_key"`))

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/register", LocalAuthRegister(db, testJWTSecret, ""))

	rec := postJSON(router, "/register", `{"email":"uji@example.com","password":"rahasia123"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", rec.Code)
	}
}

func TestLocalAuthLoginSuccessAndFailure(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("rahasia123"), bcrypt.MinCost)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	rows := sqlmock.NewRows([]string{"id", "email", "password_hash", "role"}).
		AddRow("user-9", "uji@example.com", string(hash), "user")
	mock.ExpectQuery(`SELECT id, email, password_hash, role FROM local_users`).
		WithArgs("uji@example.com").
		WillReturnRows(rows)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/login", LocalAuthLogin(db, testJWTSecret, ""))

	rec := postJSON(router, "/login", `{"email":"uji@example.com","password":"rahasia123"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Data.AccessToken == "" {
		t.Fatalf("missing token: %v", err)
	}

	// Wrong password: same query, different result.
	db2, mock2, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db2.Close()
	mock2.ExpectQuery(`SELECT id, email, password_hash, role FROM local_users`).
		WithArgs("uji@example.com").
		WillReturnRows(rows)
	router2 := gin.New()
	router2.POST("/login", LocalAuthLogin(db2, testJWTSecret, ""))
	rec2 := postJSON(router2, "/login", `{"email":"uji@example.com","password":"salah1234"}`)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong password, got %d", rec2.Code)
	}
}

func TestLocalAuthLoginUnknownEmailNoEnumeration(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT id, email, password_hash, role FROM local_users`).
		WithArgs("siapapun@example.com").
		WillReturnError(sql.ErrNoRows)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/login", LocalAuthLogin(db, testJWTSecret, ""))

	rec := postJSON(router, "/login", `{"email":"siapapun@example.com","password":"rahasia123"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid_credentials") {
		t.Fatalf("response must not reveal whether the email exists: %s", rec.Body.String())
	}
}
