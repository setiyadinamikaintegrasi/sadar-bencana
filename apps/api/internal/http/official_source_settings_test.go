package http

import (
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
