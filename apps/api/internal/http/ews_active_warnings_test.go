package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

var activeWarningsQueryPattern = regexp.QuoteMeta(
	"array_to_json(array_agg(z.id::text ORDER BY z.created_at, z.id)),",
) + `\s+` + regexp.QuoteMeta(
	"array_to_json(array_agg(z.label ORDER BY z.created_at, z.id)),",
) + `(?s).*` + regexp.QuoteMeta(
	"JOIN ews_watch_zones z ON z.subscriber_id = $1",
) + `(?s).*` + regexp.QuoteMeta(
	"CASE WHEN oa.area_geojson IS NOT NULL AND ST_IsValid(",
) + `(?s).*` + regexp.QuoteMeta(
	"ELSE FALSE END",
) + `(?s).*` + regexp.QuoteMeta(
	"WHERE oa.is_current = TRUE AND oa.status = 'active'",
) + `(?s).*` + regexp.QuoteMeta(
	"AND oa.peril_type IS NOT NULL AND oa.severity IS NOT NULL",
)

var notificationHistoryQueryPattern = regexp.QuoteMeta(
	"FROM ews_notification_log l LEFT JOIN official_alerts oa ON oa.id = l.official_alert_id",
) + `\s+` + regexp.QuoteMeta(
	"LEFT JOIN ews_watch_zones z ON z.id = l.matched_watch_zone_id WHERE l.subscriber_id = $1",
) + `\s+` + regexp.QuoteMeta(
	"ORDER BY l.created_at DESC LIMIT $2",
)

func TestEWSMeActiveWarningsIsScopedToAuthenticatedSubscriber(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT id FROM ews_subscribers").
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("subscriber-1"))
	now := time.Now().UTC().Round(time.Microsecond)
	rows := sqlmock.NewRows([]string{
		"id", "source", "message_type", "status", "sent_at", "peril_type", "severity", "category", "headline",
		"description", "area_name", "effective_at", "expires_at", "source_url",
		"area_geojson", "latitude", "longitude",
		"matched_watch_zone_ids", "matched_watch_zone_labels", "guidance", "guidance_source",
	}).AddRow(
		"alert-1", "bmkg_cap", "update", "active", now, "weather", "High", nil,
		"Peringatan Dini Cuaca", "Hujan lebat", "Jawa Barat",
		now, now.Add(time.Hour), "https://www.bmkg.go.id/alerts/alert-1",
		[]byte(`{"type":"Polygon","coordinates":[]}`), nil, nil,
		[]byte(`["zone-1"]`), []byte(`["Rumah"]`),
		[]byte(`{"before":[],"during":["Hindari area terbuka."],"after":[]}`),
		"https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca",
	)
	mock.ExpectQuery(activeWarningsQueryPattern).
		WithArgs("subscriber-1", 100).
		WillReturnRows(rows)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(ctxAuthUserID, "user-1")
	context.Set(ctxAuthEmail, "user@example.test")
	context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/ews/me/active-warnings", nil)
	EWSMeActiveWarnings(db)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var body struct {
		Data []EWSActiveWarning `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 1 || body.Data[0].Source != "bmkg_cap" {
		t.Fatalf("unexpected data: %#v", body.Data)
	}
	if !reflect.DeepEqual(body.Data[0].MatchedWatchZoneIDs, []string{"zone-1"}) ||
		!reflect.DeepEqual(body.Data[0].MatchedWatchZoneLabels, []string{"Rumah"}) {
		t.Fatalf("unexpected matched watch zones: %#v", body.Data[0])
	}
	if string(body.Data[0].Guidance) != `{"before":[],"during":["Hindari area terbuka."],"after":[]}` {
		t.Fatalf("guidance = %s", body.Data[0].Guidance)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEWSMeActiveWarningsPreservesNullableFieldsAndRequestLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT id FROM ews_subscribers").
		WithArgs("user-2").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("subscriber-2"))
	rows := sqlmock.NewRows([]string{
		"id", "source", "message_type", "status", "sent_at", "peril_type", "severity", "category", "headline",
		"description", "area_name", "effective_at", "expires_at", "source_url",
		"area_geojson", "latitude", "longitude",
		"matched_watch_zone_ids", "matched_watch_zone_labels", "guidance", "guidance_source",
	}).AddRow(
		"alert-2", "bmkg_cap", "alert", "active", time.Now(), "air_quality", "Moderate", nil, nil,
		nil, nil, nil, nil, nil, nil, nil, nil,
		[]byte(`[]`), []byte(`[]`), nil, nil,
	)
	mock.ExpectQuery(activeWarningsQueryPattern).
		WithArgs("subscriber-2", 25).
		WillReturnRows(rows)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(ctxAuthUserID, "user-2")
	context.Set(ctxAuthEmail, "user-2@example.test")
	context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/ews/me/active-warnings?limit=25", nil)
	EWSMeActiveWarnings(db)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var body struct {
		Data []EWSActiveWarning `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 1 {
		t.Fatalf("len(data) = %d, want 1", len(body.Data))
	}
	warning := body.Data[0]
	if warning.Category != nil || warning.Headline != nil || warning.Description != nil ||
		warning.AreaName != nil || warning.EffectiveAt != nil || warning.ExpiresAt != nil ||
		warning.SourceURL != nil || warning.Latitude != nil || warning.Longitude != nil ||
		warning.GuidanceSource != nil {
		t.Fatalf("nullable fields were not preserved: %#v", warning)
	}
	if !reflect.DeepEqual(warning.MatchedWatchZoneIDs, []string{}) ||
		!reflect.DeepEqual(warning.MatchedWatchZoneLabels, []string{}) {
		t.Fatalf("empty watch zones = %#v", warning)
	}
	var rawBody struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &rawBody); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"area_geojson", "guidance", "guidance_source"} {
		if value := rawBody.Data[0][key]; value != nil {
			t.Fatalf("%s = %#v, want null", key, value)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEWSMeNotificationsIncludesLifecycleMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT id FROM ews_subscribers").
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("subscriber-1"))
	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "alert_id", "channel", "status", "error_message", "sent_at",
		"created_at", "headline", "peril_type", "lifecycle_action", "matched_watch_zone_label",
	}).AddRow("notification-1", nil, "email", "sent", nil, now, now,
		"Peringatan Dini Cuaca", "weather", "update", "Rumah")
	mock.ExpectQuery(notificationHistoryQueryPattern).
		WithArgs("subscriber-1", 100).
		WillReturnRows(rows)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(ctxAuthUserID, "user-1")
	context.Set(ctxAuthEmail, "user@example.test")
	context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/ews/me/notifications", nil)
	EWSMeNotifications(db)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var body struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	row := body.Data[0]
	if row["headline"] != "Peringatan Dini Cuaca" || row["peril_type"] != "weather" ||
		row["lifecycle_action"] != "update" || row["matched_watch_zone_label"] != "Rumah" {
		t.Fatalf("missing lifecycle metadata: %#v", row)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEWSMeNotificationsReturnsNullableLifecycleMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT id FROM ews_subscribers").
		WithArgs("user-3").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("subscriber-3"))
	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "alert_id", "channel", "status", "error_message", "sent_at",
		"created_at", "headline", "peril_type", "lifecycle_action", "matched_watch_zone_label",
	}).AddRow("notification-2", nil, "telegram", "failed", "unreachable", nil, now,
		nil, nil, nil, nil)
	mock.ExpectQuery(notificationHistoryQueryPattern).
		WithArgs("subscriber-3", 100).
		WillReturnRows(rows)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(ctxAuthUserID, "user-3")
	context.Set(ctxAuthEmail, "user-3@example.test")
	context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/ews/me/notifications", nil)
	EWSMeNotifications(db)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var body struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	row := body.Data[0]
	for _, key := range []string{"headline", "peril_type", "lifecycle_action", "matched_watch_zone_label"} {
		if value, exists := row[key]; !exists || value != nil {
			t.Fatalf("%s = %#v, want null", key, value)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
