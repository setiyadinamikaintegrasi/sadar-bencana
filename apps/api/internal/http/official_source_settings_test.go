package http

import (
	"encoding/json"
	"strings"
	"testing"
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
	sanitized := sanitizePreview(map[string]any{
		"api_token": "secret",
		"nested":    map[string]any{"password": "secret"},
	}).(map[string]any)
	if sanitized["api_token"] != "[REDACTED]" {
		t.Fatal("token leaked into preview")
	}
	nested := sanitized["nested"].(map[string]any)
	if nested["password"] != "[REDACTED]" {
		t.Fatal("nested password leaked into preview")
	}
}
