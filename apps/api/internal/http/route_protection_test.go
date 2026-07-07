package http

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func TestAlertAcknowledgeRequiresAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.PATCH(
		"/api/v1/alerts/:id/acknowledge",
		SupabaseAuth("test-secret", ""),
		AcknowledgeAlert(nil),
	)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/alerts/alert-1/acknowledge", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated acknowledge to return 401, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	token := signTestToken(t, "test-secret", jwt.MapClaims{
		"sub":   "11111111-1111-1111-1111-111111111111",
		"email": "analyst@example.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	})
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPatch, "/api/v1/alerts/alert-1/acknowledge", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(recorder, request)

	if recorder.Code == http.StatusUnauthorized {
		t.Fatalf("expected authenticated acknowledge request to pass auth middleware")
	}
}

func TestCorrelationReviewQueueRequiresAdminAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	router := gin.New()
	router.GET(
		"/api/v1/correlations/review-queue",
		SupabaseAuth("test-secret", ""),
		RequireEWSAdmin(db),
		CorrelationReviewQueue(db),
	)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/correlations/review-queue", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated review queue to return 401, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	token := signTestToken(t, "test-secret", jwt.MapClaims{
		"sub":   "11111111-1111-1111-1111-111111111111",
		"email": "viewer@example.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	})
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/v1/correlations/review-queue", nil)
	request.Header.Set("Authorization", "Bearer "+token)

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT role FROM ews_subscribers
		 WHERE lower(email)=lower($1) AND is_active=TRUE
		 LIMIT 1`)).
		WithArgs("viewer@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("viewer"))

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected authenticated non-admin review queue request to return 403, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
