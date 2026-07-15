package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestApprovedOfficialSourceHosts(t *testing.T) {
	if !approvedSourceHost("bmkg", "data.bmkg.go.id") {
		t.Fatal("BMKG open-data host rejected")
	}
	if !approvedSourceHost("inatews", "rtsp.bmkg.go.id") {
		t.Fatal("official BMKG host rejected")
	}
	if !approvedSourceHost("bmkg_air_quality", "iklim.bmkg.go.id") {
		t.Fatal("official BMKG air-quality host rejected")
	}
	if approvedSourceHost("bmkg_air_quality", "bmkg.go.id.evil.example") {
		t.Fatal("BMKG air-quality suffix confusion accepted")
	}
	if !approvedSourceHost("pvmbg", "magma.esdm.go.id") {
		t.Fatal("official ESDM host rejected")
	}
	if approvedSourceHost("bnpb", "bnpb.go.id.evil.example") {
		t.Fatal("suffix confusion accepted")
	}
	if approvedSourceHost("inarisk", "evil.example") {
		t.Fatal("unofficial host accepted")
	}
}

func TestAirQualityEndpointRequiresApprovedHTTPS443URL(t *testing.T) {
	if !approvedSourceEndpoint("bmkg_air_quality", "https://iklim.bmkg.go.id/api/air-quality") {
		t.Fatal("approved BMKG HTTPS endpoint rejected")
	}
	for _, endpoint := range []string{
		"http://iklim.bmkg.go.id/api/air-quality",
		"https://attacker@iklim.bmkg.go.id/api/air-quality",
		"https://iklim.bmkg.go.id:8443/api/air-quality",
		"https://evil.example/api/air-quality",
	} {
		if approvedSourceEndpoint("bmkg_air_quality", endpoint) {
			t.Fatalf("unsafe endpoint accepted: %s", endpoint)
		}
	}
}

func TestVersionedAdapterMapsNestedContract(t *testing.T) {
	mapping := map[string]string{
		"__records":   "response.records",
		"report_id":   "identifier",
		"observed_at": "time.observed",
	}
	payload := map[string]any{
		"response": map[string]any{
			"records": []any{map[string]any{
				"identifier": "report-42",
				"time":       map[string]any{"observed": "2026-06-30T00:00:00Z"},
			}},
		},
	}
	records := payloadRecords(payload, mapping)
	if len(records) != 1 {
		t.Fatalf("expected one record, got %d", len(records))
	}
	mapped := mapOfficialRecord(records[0], mapping)
	if mapped["report_id"] != "report-42" || mapped["observed_at"] == nil {
		t.Fatalf("mapping failed: %#v", mapped)
	}
	if err := validateAdapterConfiguration("bnpb", "v1", mapping); err != nil {
		t.Fatalf("valid adapter rejected: %v", err)
	}
}

func TestAdapterRejectsUnknownVersion(t *testing.T) {
	err := validateAdapterConfiguration("bnpb", "v999", nil)
	if err == nil || !strings.Contains(err.Error(), "not registered") {
		t.Fatalf("expected unknown adapter rejection, got %v", err)
	}
}

func TestAdapterRegistersAirQualityCollectionContract(t *testing.T) {
	if err := validateAdapterConfiguration("bmkg_air_quality", "v1", map[string]string{
		"__warnings":     "result.warnings",
		"__observations": "result.observations",
	}); err != nil {
		t.Fatalf("valid air-quality adapter rejected: %v", err)
	}
	fields := adapterContracts["bmkg_air_quality"]["v1"]
	if len(fields) != 2 || fields[0] != "__warnings" || fields[1] != "__observations" {
		t.Fatalf("unexpected air-quality contract: %#v", fields)
	}
}

func TestOfficialSourceExpectedIntervalJSONContract(t *testing.T) {
	encoded, err := json.Marshal(OfficialSourceSetting{ExpectedIntervalSeconds: 3600})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"expected_interval_seconds":3600`) {
		t.Fatalf("response omits expected interval: %s", encoded)
	}

	var update sourceSettingUpdate
	if err := json.Unmarshal([]byte(`{"expected_interval_seconds":7200}`), &update); err != nil {
		t.Fatal(err)
	}
	if update.ExpectedIntervalSeconds != 7200 {
		t.Fatalf("update ignored expected interval: %#v", update)
	}
}

func TestPreviewRedactsCredentialFields(t *testing.T) {
	payload := map[string]any{
		"api_key":     "leak-api-key",
		"apikey":      "leak-apikey",
		"credential":  "leak-credential",
		"credentials": map[string]any{"username": "safe", "passwd": "leak-passwd"},
		"nested": []any{
			map[string]any{"Cookie": "leak-cookie", "set-cookie": "leak-set-cookie"},
			[]any{map[string]any{"authorization": "leak-authorization", "auth": "leak-auth"}},
			map[string]any{"client_secret": "leak-secret", "password": "leak-password"},
		},
		"access_token":  "leak-access-token",
		"refresh-token": "leak-refresh-token",
		"public":        "visible",
	}
	sanitized := sanitizePreview(payload)
	encoded, err := json.Marshal(sanitized)
	if err != nil {
		t.Fatal(err)
	}
	for _, leaked := range []string{
		"leak-api-key", "leak-apikey", "leak-credential", "leak-passwd",
		"leak-cookie", "leak-set-cookie", "leak-authorization", "leak-auth",
		"leak-secret", "leak-password", "leak-access-token", "leak-refresh-token",
	} {
		if strings.Contains(string(encoded), leaked) {
			t.Fatalf("credential leaked into browser preview: %s in %s", leaked, encoded)
		}
	}
	if !strings.Contains(string(encoded), `"public":"visible"`) {
		t.Fatalf("non-sensitive preview data was removed: %s", encoded)
	}
}

func TestActiveSourceIngestionChangesForceDryRunInUpdateHandler(t *testing.T) {
	baseBody := map[string]any{
		"enabled": true, "run_mode": "active", "mode": "custom_api",
		"adapter_version": "v1", "field_mapping": map[string]string{},
		"custom_api_url":        "https://iklim.bmkg.go.id/api/air-quality",
		"poll_interval_seconds": 3600, "expected_interval_seconds": 3600,
	}
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "endpoint", mutate: func(body map[string]any) { body["custom_api_url"] = "https://data.bmkg.go.id/api/air-quality" }},
		{name: "mapping", mutate: func(body map[string]any) {
			body["field_mapping"] = map[string]string{"observation.station_id": "station.id"}
		}},
		{name: "adapter version", mutate: func(body map[string]any) { body["adapter_version"] = "v2" }},
		{name: "token", mutate: func(body map[string]any) { body["api_token"] = "rotated-secret" }},
		{name: "poll interval", mutate: func(body map[string]any) { body["poll_interval_seconds"] = 1800 }},
		{name: "expected interval", mutate: func(body map[string]any) { body["expected_interval_seconds"] = 7200 }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.name == "adapter version" {
				adapterContracts["bmkg_air_quality"]["v2"] = adapterContracts["bmkg_air_quality"]["v1"]
				t.Cleanup(func() { delete(adapterContracts["bmkg_air_quality"], "v2") })
			}
			body := make(map[string]any, len(baseBody))
			for key, value := range baseBody {
				body[key] = value
			}
			test.mutate(body)
			encoded, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}

			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock: %v", err)
			}
			defer db.Close()
			mock.ExpectQuery("SELECT role FROM ews_subscribers").
				WithArgs("admin@example.test").
				WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("admin"))
			mock.ExpectBegin()
			mock.ExpectQuery(regexp.QuoteMeta(`SELECT run_mode, mode, adapter_version, field_mapping,
			       custom_api_url, poll_interval_seconds, expected_interval_seconds
			FROM official_source_settings WHERE source_name=$1 FOR UPDATE`)).
				WithArgs("bmkg_air_quality").
				WillReturnRows(sqlmock.NewRows([]string{
					"run_mode", "mode", "adapter_version", "field_mapping", "custom_api_url",
					"poll_interval_seconds", "expected_interval_seconds",
				}).AddRow("active", "custom_api", "v1", []byte(`{}`),
					"https://iklim.bmkg.go.id/api/air-quality", 3600, 3600))
			mock.ExpectQuery("(?s)WITH updated AS .*config_version=config_version\\+1,.*last_dry_run_at=NULL, last_dry_run_valid=NULL,.*last_dry_run_config_version=NULL,.*RETURNING version").
				WithArgs(
					"bmkg_air_quality", true, "dry_run", body["mode"], body["adapter_version"],
					sqlmock.AnyArg(), body["custom_api_url"], body["poll_interval_seconds"],
					body["expected_interval_seconds"], valueOrEmpty(body["api_token"]), "test-key",
					"admin@example.test", "",
				).
				WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(8))
			mock.ExpectExec("INSERT INTO official_source_setting_audit").
				WithArgs("bmkg_air_quality", "admin@example.test", 8, "dry_run", body["adapter_version"]).
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectCommit()

			gin.SetMode(gin.TestMode)
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Params = gin.Params{{Key: "source", Value: "bmkg_air_quality"}}
			ctx.Set(ctxAuthEmail, "admin@example.test")
			ctx.Request = httptest.NewRequest(http.MethodPatch, "/settings/official-sources/bmkg_air_quality", bytes.NewReader(encoded))
			ctx.Request.Header.Set("Content-Type", "application/json")

			OfficialSourceSettingUpdate(db, "test-key")(ctx)

			if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"run_mode":"dry_run"`) {
				t.Fatalf("active config change was not demoted: status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unmet SQL expectations: %v", err)
			}
		})
	}
}

func TestStaleActiveSourceSaveCannotReactivateLockedDryRunConfig(t *testing.T) {
	body := []byte(`{
		"enabled":true,"run_mode":"active","mode":"custom_api",
		"adapter_version":"v1","field_mapping":{},
		"custom_api_url":"https://iklim.bmkg.go.id/api/air-quality",
		"poll_interval_seconds":3600,"expected_interval_seconds":3600
	}`)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT role FROM ews_subscribers").
		WithArgs("admin@example.test").
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("admin"))
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT run_mode, mode, adapter_version, field_mapping,
		       custom_api_url, poll_interval_seconds, expected_interval_seconds
		FROM official_source_settings WHERE source_name=$1 FOR UPDATE`)).
		WithArgs("bmkg_air_quality").
		WillReturnRows(sqlmock.NewRows([]string{
			"run_mode", "mode", "adapter_version", "field_mapping", "custom_api_url",
			"poll_interval_seconds", "expected_interval_seconds",
		}).AddRow("dry_run", "custom_api", "v1", []byte(`{}`),
			"https://iklim.bmkg.go.id/api/air-quality", 3600, 3600))
	mock.ExpectRollback()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Params = gin.Params{{Key: "source", Value: "bmkg_air_quality"}}
	ctx.Set(ctxAuthEmail, "admin@example.test")
	ctx.Request = httptest.NewRequest(http.MethodPatch, "/settings/official-sources/bmkg_air_quality", bytes.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")

	OfficialSourceSettingUpdate(db, "test-key")(ctx)

	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), `"error":"dry_run_required"`) {
		t.Fatalf("stale active save was not rejected: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestUnchangedActiveSourceSavePreservesTokenAndClearsDryRunEvidence(t *testing.T) {
	body := []byte(`{
		"enabled":true,"run_mode":"active","mode":"custom_api",
		"adapter_version":"v1","field_mapping":{},
		"custom_api_url":"https://iklim.bmkg.go.id/api/air-quality",
		"poll_interval_seconds":3600,"expected_interval_seconds":3600
	}`)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT role FROM ews_subscribers").
		WithArgs("admin@example.test").
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("admin"))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT run_mode, mode, adapter_version, field_mapping,.*FOR UPDATE").
		WithArgs("bmkg_air_quality").
		WillReturnRows(sqlmock.NewRows([]string{
			"run_mode", "mode", "adapter_version", "field_mapping", "custom_api_url",
			"poll_interval_seconds", "expected_interval_seconds",
		}).AddRow("active", "custom_api", "v1", []byte(`{}`),
			"https://iklim.bmkg.go.id/api/air-quality", 3600, 3600))
	mock.ExpectQuery("(?s)WITH updated AS .*api_token_encrypted=CASE WHEN \\$10='' THEN api_token_encrypted.*ELSE pgp_sym_encrypt\\(\\$10,\\$11\\) END,.*config_version=config_version\\+1,.*last_dry_run_at=NULL, last_dry_run_valid=NULL,.*last_dry_run_config_version=NULL,.*RETURNING version").
		WithArgs(
			"bmkg_air_quality", true, "active", "custom_api", "v1", sqlmock.AnyArg(),
			"https://iklim.bmkg.go.id/api/air-quality", 3600, 3600, "", "test-key",
			"admin@example.test", "",
		).
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(9))
	mock.ExpectExec("INSERT INTO official_source_setting_audit").
		WithArgs("bmkg_air_quality", "admin@example.test", 9, "active", "v1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Params = gin.Params{{Key: "source", Value: "bmkg_air_quality"}}
	ctx.Set(ctxAuthEmail, "admin@example.test")
	ctx.Request = httptest.NewRequest(http.MethodPatch, "/settings/official-sources/bmkg_air_quality", bytes.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")

	OfficialSourceSettingUpdate(db, "test-key")(ctx)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"config_version":9`) ||
		!strings.Contains(recorder.Body.String(), `"run_mode":"active"`) {
		t.Fatalf("unchanged active save changed semantics: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func valueOrEmpty(value any) string {
	text, _ := value.(string)
	return text
}

func TestOfficialSourceSettingTestRejectsPrivateDNSResolution(t *testing.T) {
	originalLookup := lookupOfficialSourceIPs
	originalDial := dialOfficialSourceContext
	t.Cleanup(func() {
		lookupOfficialSourceIPs = originalLookup
		dialOfficialSourceContext = originalDial
	})
	lookupOfficialSourceIPs = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("169.254.169.254")}}, nil
	}
	dialed := false
	dialOfficialSourceContext = func(context.Context, string, string) (net.Conn, error) {
		dialed = true
		return nil, nil
	}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT role FROM ews_subscribers").
		WithArgs("admin@example.test").
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("admin"))
	mock.ExpectQuery("(?s)SELECT mode, default_api_url, custom_api_url,.*FROM official_source_settings").
		WithArgs("bmkg_air_quality", "test-key").
		WillReturnRows(sqlmock.NewRows([]string{"mode", "default_api_url", "custom_api_url", "api_token"}).
			AddRow("custom_api", nil, "https://iklim.bmkg.go.id/api/air-quality", nil))

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Params = gin.Params{{Key: "source", Value: "bmkg_air_quality"}}
	ctx.Set(ctxAuthEmail, "admin@example.test")
	ctx.Request = httptest.NewRequest(http.MethodPost, "/settings/official-sources/bmkg_air_quality/test", nil)

	OfficialSourceSettingTest(db, "test-key")(ctx)

	if recorder.Code != http.StatusBadGateway || !strings.Contains(recorder.Body.String(), "blocked IP") {
		t.Fatalf("private DNS result was not rejected: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if dialed {
		t.Fatal("private DNS result reached the dialer")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
