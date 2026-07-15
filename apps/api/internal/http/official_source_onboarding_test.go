package http

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"net"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func validAirQualityPreviewPayload() map[string]any {
	return map[string]any{
		"warnings": []any{map[string]any{
			"source_alert_id": "aq-jabar-20260715",
			"message_type":    "alert",
			"status":          "active",
			"sent_at":         "2026-07-15T08:00:00+07:00",
			"effective_at":    "2026-07-16T00:00:00+07:00",
			"expires_at":      "2026-07-17T00:00:00+07:00",
			"category":        "Tidak Sehat",
			"area_name":       "Jawa Barat",
			"area_geojson": map[string]any{
				"type": "Polygon",
				"coordinates": []any{[]any{
					[]any{106.0, -7.0}, []any{108.0, -7.0},
					[]any{108.0, -6.0}, []any{106.0, -7.0},
				}},
			},
			"headline":    "Peringatan Dini Kualitas Udara Jawa Barat",
			"description": "Potensi kualitas udara tidak sehat.",
			"source_url":  "https://iklim.bmkg.go.id/kualitas-udara-indonesia/",
		}},
		"observations": []any{map[string]any{
			"station_id":   "kmy3",
			"station_name": "Kemayoran",
			"latitude":     -6.155,
			"longitude":    106.84,
			"value":        66.2,
			"unit":         "ug/m3",
			"category":     "Tidak Sehat",
			"observed_at":  "2026-07-15T04:00:00+07:00",
			"source_url":   "https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
		}},
	}
}

func executeAirQualityPreviewBody(t *testing.T, body []byte) (sourcePreviewResult, error) {
	t.Helper()
	server := httptest.NewTLSServer(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)

	originalLookup := lookupOfficialSourceIPs
	originalDial := dialOfficialSourceContext
	originalTLSConfig := officialSourceTLSConfig
	t.Cleanup(func() {
		lookupOfficialSourceIPs = originalLookup
		dialOfficialSourceContext = originalDial
		officialSourceTLSConfig = originalTLSConfig
	})
	lookupOfficialSourceIPs = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
	}
	dialer := &net.Dialer{}
	dialOfficialSourceContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return dialer.DialContext(ctx, network, server.Listener.Addr().String())
	}
	officialSourceTLSConfig = func(host string) *tls.Config {
		return &tls.Config{ServerName: host, InsecureSkipVerify: true} // test server certificate is self-signed.
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(stdhttp.MethodPost, "/preview", nil)
	return executeSourcePreview(ctx, sourceRuntimeConfig{
		Source: "bmkg_air_quality", Endpoint: "https://iklim.bmkg.go.id/api/air-quality",
		AdapterVersion: "v1", FieldMapping: map[string]string{},
	})
}

func TestPreviewCapIndexAcceptsBMKGLinks(t *testing.T) {
	body := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item><title>Alert 1</title><link>https://warning.bmkg.go.id/cap/202607120101.xml</link></item>
    <item><title>Alert 2</title><link>https://ews.bmkg.go.id/cap/202607120102.xml</link></item>
    <item><title>Ignored</title><link>https://bmkg.go.id.evil.example/cap/202607120103.xml</link></item>
  </channel>
</rss>`)

	result, ok := previewCapIndex(body, sourcePreviewResult{
		Reachable:   true,
		StatusCode:  200,
		ContentType: "application/rss+xml",
	})

	if !ok {
		t.Fatal("expected RSS CAP index to be recognized")
	}
	if !result.ContractValid {
		t.Fatalf("expected contract to be valid: %#v", result)
	}
	if result.RecordCount != 2 || result.ValidCount != 2 || result.InvalidCount != 0 {
		t.Fatalf("unexpected counts: record=%d valid=%d invalid=%d", result.RecordCount, result.ValidCount, result.InvalidCount)
	}
	links, ok := result.RawSample.([]string)
	if !ok {
		t.Fatalf("expected raw sample to be link list, got %T", result.RawSample)
	}
	if len(links) != 2 || links[0] != "https://warning.bmkg.go.id/cap/202607120101.xml" {
		t.Fatalf("unexpected raw sample: %#v", links)
	}
}

func TestPreviewCapIndexRejectsRSSWithoutBMKGLinks(t *testing.T) {
	body := []byte(`<rss><channel><item><link>https://example.com/cap.xml</link></item></channel></rss>`)

	result, ok := previewCapIndex(body, sourcePreviewResult{
		Reachable:   true,
		StatusCode:  200,
		ContentType: "application/rss+xml",
	})

	if !ok {
		t.Fatal("expected RSS body to be recognized")
	}
	if result.ContractValid {
		t.Fatalf("expected contract to be invalid without BMKG CAP links: %#v", result)
	}
	if result.RecordCount != 0 || result.ValidCount != 0 {
		t.Fatalf("unexpected counts: record=%d valid=%d", result.RecordCount, result.ValidCount)
	}
	if len(result.Errors) == 0 {
		t.Fatal("expected a validation error")
	}
}

func TestCapPreviewDoesNotTreatJSONAsXML(t *testing.T) {
	body := []byte(`{"items":[{"id":"weather-1"}]}`)

	if likelyXMLResponse("application/json", body) {
		t.Fatal("JSON response should not be treated as XML")
	}
	if _, ok := previewCapIndex(body, sourcePreviewResult{Reachable: true, StatusCode: 200}); ok {
		t.Fatal("JSON body should not be recognized as a CAP RSS index")
	}
}

func TestAirQualityPreviewSeparatesWarningsAndObservations(t *testing.T) {
	payload := validAirQualityPreviewPayload()
	base := sourcePreviewResult{
		Reachable:      true,
		StatusCode:     200,
		AdapterVersion: "v1",
	}

	result := previewAirQualityPayload(payload, map[string]string{}, base)

	if !result.ContractValid {
		t.Fatalf("expected valid air-quality contract: %#v", result)
	}
	if result.WarningCount != 1 || result.ObservationCount != 1 {
		t.Fatalf("collections were not separated: %#v", result)
	}
	if result.RecordCount != 2 || result.ValidCount != 2 || result.InvalidCount != 0 {
		t.Fatalf("unexpected counts: %#v", result)
	}
	if result.PayloadStored {
		t.Fatal("preview must never persist payload")
	}
	if result.MappedSample[0]["severity"] != "Moderate" {
		t.Fatalf("warning severity mapping missing from preview: %#v", result.MappedSample[0])
	}
}

func TestExecuteAirQualityPreviewRequiresExactlyOneJSONValue(t *testing.T) {
	encoded, err := json.Marshal(validAirQualityPreviewPayload())
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name  string
		tail  string
		valid bool
	}{
		{name: "one value with trailing whitespace", tail: "\n\t ", valid: true},
		{name: "trailing garbage", tail: "not-json"},
		{name: "second JSON value", tail: ` {"warnings":[],"observations":[]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := append(append([]byte{}, encoded...), test.tail...)
			result, err := executeAirQualityPreviewBody(t, body)
			if err != nil {
				t.Fatalf("preview failed: %v", err)
			}
			if result.ContractValid != test.valid {
				t.Fatalf("contract_valid=%t, want %t: %#v", result.ContractValid, test.valid, result)
			}
			if !test.valid && (len(result.Errors) != 1 || result.Errors[0] != "response is not valid JSON") {
				t.Fatalf("invalid JSON did not return the bounded error: %#v", result)
			}
		})
	}
}

func TestExecuteAirQualityPreviewEnforcesOneMiBResponseLimit(t *testing.T) {
	encoded, err := json.Marshal(validAirQualityPreviewPayload())
	if err != nil {
		t.Fatal(err)
	}
	const limit = 1 << 20
	exactLimit := make([]byte, limit)
	copy(exactLimit, encoded)
	for index := len(encoded); index < len(exactLimit); index++ {
		exactLimit[index] = ' '
	}

	result, err := executeAirQualityPreviewBody(t, exactLimit)
	if err != nil || !result.ContractValid {
		t.Fatalf("exactly 1 MiB response was rejected: result=%#v err=%v", result, err)
	}

	hiddenSecondValue := append(append([]byte{}, exactLimit...), []byte(`{"warnings":[],"observations":[]}`)...)
	result, err = executeAirQualityPreviewBody(t, hiddenSecondValue)
	if err == nil || !strings.Contains(err.Error(), "exceeds 1 MiB") {
		t.Fatalf("oversized response was not rejected explicitly: result=%#v err=%v", result, err)
	}
	if result.ContractValid {
		t.Fatalf("second JSON value beyond the old truncation boundary was accepted: %#v", result)
	}
}

func TestSensitivePreviewKeyRecognizesNormalizedCredentialPatterns(t *testing.T) {
	for _, key := range []string{
		"backup_secret_key_material",
		"secret_access_key",
		"access_key_id",
		"aws_access_key_id",
		"aws_secret_access_key",
		"aws_session_token",
		"service_credential_token",
		"private-key",
		"basicAuth",
		"requestAuthorizationHeaderValue",
		"client_secret_value",
		"x-api-key-header",
		"service_credentials_blob",
		"browser_cookies_copy",
		"refresh_tokens_list",
		"database_passwords_hash",
		"legacy_passwd_digest",
	} {
		t.Run(key, func(t *testing.T) {
			if !sensitivePreviewKey(key) {
				t.Fatalf("sensitive key %q was not recognized", key)
			}
		})
	}
	for _, key := range []string{
		"secretary_name",
		"tokenizer_version",
		"cookieless_mode",
		"passwordless_enabled",
		"public_key",
		"authorization_status",
	} {
		t.Run(key, func(t *testing.T) {
			if sensitivePreviewKey(key) {
				t.Fatalf("ordinary key %q was treated as a credential", key)
			}
		})
	}
}

func TestSanitizePreviewRemovesURLUserinfoRegardlessOfFieldKey(t *testing.T) {
	payload := map[string]any{
		"homepage": "https://alice:homepage-secret@example.com/path?region=java#latest",
		"nested": []any{map[string]any{
			"ordinary":     "https://bob:nested-secret@iklim.bmkg.go.id/data?station=kmy3",
			"network_path": "//dave:network-secret@bmkg.go.id/archive?year=2026",
			"public":       "https://iklim.bmkg.go.id/data?station=kmy3",
			"invalid":      "https://carol:invalid-secret@bmkg.go.id/%zz",
		}},
	}

	encoded, err := json.Marshal(sanitizePreview(payload))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{
		"alice", "homepage-secret", "bob", "nested-secret", "carol", "invalid-secret",
		"dave", "network-secret",
	} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("URL credential %q leaked from ordinary field: %s", secret, encoded)
		}
	}
	for _, metadata := range []string{
		"https://example.com/path?region=java#latest",
		"https://iklim.bmkg.go.id/data?station=kmy3",
		"//bmkg.go.id/archive?year=2026",
	} {
		if !strings.Contains(string(encoded), metadata) {
			t.Fatalf("non-secret URL metadata %q was not preserved: %s", metadata, encoded)
		}
	}
}

func TestAirQualityPreviewRedactsNestedRawAndMappedSamples(t *testing.T) {
	payload := validAirQualityPreviewPayload()
	warning := payload["warnings"].([]any)[0].(map[string]any)
	warning["security_metadata"] = []any{
		map[string]any{
			"backup_secret_key_material": "leak-secret-key",
			"secretary_name":             "visible-secretary",
		},
		map[string]any{
			"wrapper": map[string]any{
				"client_secret_value": "leak-client-secret",
				"public_key":          "visible-public-key",
			},
		},
	}
	warning["reference_url"] = "https://reader:raw-url-secret@iklim.bmkg.go.id/reference?area=jabar"
	observation := payload["observations"].([]any)[0].(map[string]any)
	observation["service_credentials_blob"] = map[string]any{
		"browser_cookies_copy": "leak-cookie",
		"refresh_tokens_list":  []any{"leak-token"},
	}
	observation["ordinary_metadata"] = map[string]any{"status": "visible-ordinary"}
	observation["dashboard_url"] = "https://viewer:mapped-url-secret@bmkg.go.id/dashboard?station=kmy3"

	result := previewAirQualityPayload(payload, map[string]string{}, sourcePreviewResult{
		Reachable: true, StatusCode: 200, AdapterVersion: "v1",
	})
	if !result.ContractValid {
		t.Fatalf("credential metadata changed contract validity: %#v", result)
	}
	for name, sample := range map[string]any{
		"raw": result.RawSample, "mapped": result.MappedSample,
	} {
		encoded, err := json.Marshal(sample)
		if err != nil {
			t.Fatal(err)
		}
		for _, leaked := range []string{
			"leak-secret-key", "leak-client-secret", "leak-cookie", "leak-token",
			"raw-url-secret", "mapped-url-secret", "reader", "viewer",
		} {
			if strings.Contains(string(encoded), leaked) {
				t.Fatalf("%s sample leaked %q: %s", name, leaked, encoded)
			}
		}
		for _, visible := range []string{
			"visible-secretary", "visible-public-key", "visible-ordinary",
			"iklim.bmkg.go.id/reference?area=jabar", "bmkg.go.id/dashboard?station=kmy3",
		} {
			if !strings.Contains(string(encoded), visible) {
				t.Fatalf("%s sample removed ordinary value %q: %s", name, visible, encoded)
			}
		}
	}
}

func TestAirQualityPreviewAcceptsWorkerNumericStringCoercions(t *testing.T) {
	payload := validAirQualityPreviewPayload()
	warning := payload["warnings"].([]any)[0].(map[string]any)
	warning["latitude"], warning["longitude"] = " -6.2 ", " 106.8 "
	observation := payload["observations"].([]any)[0].(map[string]any)
	observation["latitude"], observation["longitude"] = " -6.155 ", " 106.84 "
	observation["value"] = " 66.2 "

	result := previewAirQualityPayload(payload, map[string]string{}, sourcePreviewResult{
		Reachable: true, StatusCode: 200, AdapterVersion: "v1",
	})
	if !result.ContractValid || result.ValidCount != 2 || result.InvalidCount != 0 {
		t.Fatalf("Pydantic-compatible numeric strings were rejected: %#v", result)
	}
}

func TestAirQualityPreviewAcceptsDatetimeFromISOFormatVariants(t *testing.T) {
	for _, timestamp := range []string{
		"2026-07-15T04:00:00+0700",
		"2026-07-15 04:00:00+07:00",
		"20260715T040000+0700",
		"2026-W29-3T04:00:00+07:00",
		"2026W293T040000+0700",
		"2026-07-15T04:00:00+07",
		"2026-07-15T04:00:00+07:00:30.5",
	} {
		t.Run(timestamp, func(t *testing.T) {
			payload := validAirQualityPreviewPayload()
			warning := payload["warnings"].([]any)[0].(map[string]any)
			for _, field := range []string{"sent_at", "effective_at", "expires_at"} {
				warning[field] = timestamp
			}
			payload["observations"].([]any)[0].(map[string]any)["observed_at"] = timestamp

			result := previewAirQualityPayload(payload, map[string]string{}, sourcePreviewResult{
				Reachable: true, StatusCode: 200, AdapterVersion: "v1",
			})
			if !result.ContractValid {
				t.Fatalf("datetime.fromisoformat-compatible timestamp was rejected: %#v", result)
			}
		})
	}
}

func TestAirQualityPreviewRejectsUnsafeNumericAndTimestampStrings(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "naive timestamp", mutate: func(record map[string]any) { record["observed_at"] = "2026-07-15T04:00:00" }},
		{name: "malformed offset", mutate: func(record map[string]any) { record["observed_at"] = "2026-07-15T04:00:00+-1" }},
		{name: "infinite value", mutate: func(record map[string]any) { record["value"] = "Infinity" }},
		{name: "not a number coordinate", mutate: func(record map[string]any) { record["latitude"] = "NaN" }},
		{name: "negative value", mutate: func(record map[string]any) { record["value"] = "-0.1" }},
		{name: "out of range coordinate", mutate: func(record map[string]any) { record["longitude"] = "181" }},
		{name: "year zero extended date", mutate: func(record map[string]any) { record["observed_at"] = "0000-01-01T04:00:00+07:00" }},
		{name: "year zero basic date", mutate: func(record map[string]any) { record["observed_at"] = "00000101T040000+0700" }},
		{name: "year zero week date", mutate: func(record map[string]any) { record["observed_at"] = "0000-W01-1T04:00:00+07:00" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := validAirQualityPreviewPayload()
			test.mutate(payload["observations"].([]any)[0].(map[string]any))
			result := previewAirQualityPayload(payload, map[string]string{}, sourcePreviewResult{
				Reachable: true, StatusCode: 200, AdapterVersion: "v1",
			})
			if result.ContractValid || result.ValidCount != 1 || result.InvalidCount != 1 {
				t.Fatalf("unsafe value was accepted: %#v", result)
			}
		})
	}
}

func TestAirQualityPreviewRejectsCollectionSchemaDrift(t *testing.T) {
	result := previewAirQualityPayload(
		map[string]any{"warnings": map[string]any{}, "observations": []any{}},
		map[string]string{},
		sourcePreviewResult{Reachable: true, StatusCode: 200, AdapterVersion: "v1"},
	)

	if result.ContractValid || result.InvalidCount == 0 || len(result.Errors) == 0 {
		t.Fatalf("schema drift was accepted: %#v", result)
	}
}

func TestAirQualityPreviewRejectsMalformedRecordsWithoutDiscardingValidSiblingCounts(t *testing.T) {
	tests := []struct {
		name       string
		collection string
		mutate     func(map[string]any)
	}{
		{name: "warning required identifier", collection: "warnings", mutate: func(record map[string]any) { delete(record, "source_alert_id") }},
		{name: "warning identifier type", collection: "warnings", mutate: func(record map[string]any) { record["source_alert_id"] = 42 }},
		{name: "warning identifier length", collection: "warnings", mutate: func(record map[string]any) { record["source_alert_id"] = strings.Repeat("a", 256) }},
		{name: "warning timezone", collection: "warnings", mutate: func(record map[string]any) { record["sent_at"] = "2026-07-15T08:00:00" }},
		{name: "warning message type", collection: "warnings", mutate: func(record map[string]any) { record["message_type"] = "observation" }},
		{name: "warning status", collection: "warnings", mutate: func(record map[string]any) { record["status"] = "draft" }},
		{name: "warning extreme category", collection: "warnings", mutate: func(record map[string]any) { record["category"] = "Baik" }},
		{name: "warning BMKG URL", collection: "warnings", mutate: func(record map[string]any) { record["source_url"] = "https://evil.example/warning" }},
		{name: "warning paired coordinates", collection: "warnings", mutate: func(record map[string]any) { record["latitude"] = -6.2 }},
		{name: "warning coordinate bounds", collection: "warnings", mutate: func(record map[string]any) { record["latitude"], record["longitude"] = -91.0, 106.8 }},
		{name: "warning polygon geometry", collection: "warnings", mutate: func(record map[string]any) {
			record["area_geojson"] = map[string]any{"type": "Polygon", "coordinates": []any{[]any{
				[]any{106.0, -7.0}, []any{108.0, -7.0}, []any{108.0, -6.0}, []any{107.0, -7.0},
			}}}
		}},
		{name: "warning polygon numeric strings", collection: "warnings", mutate: func(record map[string]any) {
			record["area_geojson"] = map[string]any{"type": "Polygon", "coordinates": []any{[]any{
				[]any{"106", "-7"}, []any{"108", "-7"}, []any{"108", "-6"}, []any{"106", "-7"},
			}}}
		}},
		{name: "observation required station", collection: "observations", mutate: func(record map[string]any) { delete(record, "station_name") }},
		{name: "observation identifier length", collection: "observations", mutate: func(record map[string]any) { record["station_id"] = strings.Repeat("s", 256) }},
		{name: "observation category", collection: "observations", mutate: func(record map[string]any) { record["category"] = "Unknown" }},
		{name: "observation unit", collection: "observations", mutate: func(record map[string]any) { record["unit"] = "ppm" }},
		{name: "observation timezone", collection: "observations", mutate: func(record map[string]any) { record["observed_at"] = "2026-07-15T04:00:00" }},
		{name: "observation BMKG URL", collection: "observations", mutate: func(record map[string]any) { record["source_url"] = "https://evil.example/observation" }},
		{name: "observation paired coordinates", collection: "observations", mutate: func(record map[string]any) { record["longitude"] = nil }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := validAirQualityPreviewPayload()
			record := payload[test.collection].([]any)[0].(map[string]any)
			invalid := make(map[string]any, len(record))
			for key, value := range record {
				invalid[key] = value
			}
			test.mutate(invalid)
			payload[test.collection] = append(payload[test.collection].([]any), invalid)

			result := previewAirQualityPayload(payload, map[string]string{}, sourcePreviewResult{
				Reachable: true, StatusCode: 200, AdapterVersion: "v1",
			})

			if result.ContractValid {
				t.Fatalf("malformed payload satisfied activation contract: %#v", result)
			}
			if result.RecordCount != 3 || result.ValidCount != 2 || result.InvalidCount != 1 {
				t.Fatalf("partial-record counts are wrong: %#v", result)
			}
			if len(result.Errors) != 1 {
				t.Fatalf("expected one record error, got %#v", result.Errors)
			}
		})
	}
}

func TestOfficialSourceIPClassificationRejectsSpecialUseAddresses(t *testing.T) {
	tests := []struct {
		address string
		public  bool
	}{
		{address: "8.8.8.8", public: true},
		{address: "2606:4700:4700::1111", public: true},
		{address: "10.0.0.1"},
		{address: "100.64.0.1"},
		{address: "127.0.0.1"},
		{address: "169.254.169.254"},
		{address: "192.0.2.1"},
		{address: "::1"},
		{address: "::ffff:127.0.0.1"},
		{address: "2001::1"},
		{address: "2001:2::1"},
		{address: "2001:db8::1"},
		{address: "2002::1"},
		{address: "3fff::1"},
		{address: "fc00::1"},
		{address: "fe80::1"},
	}
	for _, test := range tests {
		t.Run(test.address, func(t *testing.T) {
			if got := isPublicSourceIP(net.ParseIP(test.address)); got != test.public {
				t.Fatalf("isPublicSourceIP(%s)=%t, want %t", test.address, got, test.public)
			}
		})
	}
}

func TestSourcePreviewRejectsPrivateDNSResolutionBeforeDial(t *testing.T) {
	originalLookup := lookupOfficialSourceIPs
	originalDial := dialOfficialSourceContext
	t.Cleanup(func() {
		lookupOfficialSourceIPs = originalLookup
		dialOfficialSourceContext = originalDial
	})
	lookupOfficialSourceIPs = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
	}
	dialed := false
	dialOfficialSourceContext = func(context.Context, string, string) (net.Conn, error) {
		dialed = true
		return nil, nil
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(stdhttp.MethodPost, "/preview", nil)
	_, err := executeSourcePreview(ctx, sourceRuntimeConfig{
		Source: "bmkg_air_quality", Endpoint: "https://iklim.bmkg.go.id/api/air-quality",
		AdapterVersion: "v1", FieldMapping: map[string]string{},
	})

	if err == nil || !strings.Contains(err.Error(), "blocked IP") {
		t.Fatalf("private DNS result was not rejected: %v", err)
	}
	if dialed {
		t.Fatal("private DNS result reached the dialer")
	}
}

func TestSourcePreviewRejectsMixedPublicAndBlockedDNSAnswersBeforeDial(t *testing.T) {
	originalLookup := lookupOfficialSourceIPs
	originalDial := dialOfficialSourceContext
	t.Cleanup(func() {
		lookupOfficialSourceIPs = originalLookup
		dialOfficialSourceContext = originalDial
	})
	lookupOfficialSourceIPs = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{
			{IP: net.ParseIP("8.8.8.8")},
			{IP: net.ParseIP("169.254.169.254")},
		}, nil
	}
	dialed := false
	dialOfficialSourceContext = func(context.Context, string, string) (net.Conn, error) {
		dialed = true
		return nil, nil
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(stdhttp.MethodPost, "/preview", nil)
	_, err := executeSourcePreview(ctx, sourceRuntimeConfig{
		Source: "bmkg_air_quality", Endpoint: "https://iklim.bmkg.go.id/api/air-quality",
		AdapterVersion: "v1", FieldMapping: map[string]string{},
	})

	if err == nil || !strings.Contains(err.Error(), "blocked IP 169.254.169.254") {
		t.Fatalf("mixed DNS answers did not fail closed: %v", err)
	}
	if dialed {
		t.Fatal("mixed DNS answers reached the dialer")
	}
}

func TestSourcePreviewPinsPublicIPAndPreservesHostAndSNI(t *testing.T) {
	var requestHost, serverName string
	server := httptest.NewTLSServer(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		requestHost = r.Host
		serverName = r.TLS.ServerName
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(validAirQualityPreviewPayload())
	}))
	defer server.Close()

	originalLookup := lookupOfficialSourceIPs
	originalDial := dialOfficialSourceContext
	originalTLSConfig := officialSourceTLSConfig
	t.Cleanup(func() {
		lookupOfficialSourceIPs = originalLookup
		dialOfficialSourceContext = originalDial
		officialSourceTLSConfig = originalTLSConfig
	})
	lookupOfficialSourceIPs = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
	}
	dialer := &net.Dialer{}
	dialAddress := ""
	dialOfficialSourceContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		dialAddress = address
		return dialer.DialContext(ctx, network, server.Listener.Addr().String())
	}
	officialSourceTLSConfig = func(host string) *tls.Config {
		return &tls.Config{ServerName: host, InsecureSkipVerify: true} // test server certificate is self-signed.
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(stdhttp.MethodPost, "/preview", nil)
	result, err := executeSourcePreview(ctx, sourceRuntimeConfig{
		Source: "bmkg_air_quality", Endpoint: "https://iklim.bmkg.go.id/api/air-quality",
		AdapterVersion: "v1", FieldMapping: map[string]string{},
	})

	if err != nil || !result.ContractValid {
		t.Fatalf("pinned preview failed: result=%#v err=%v", result, err)
	}
	if dialAddress != "8.8.8.8:443" {
		t.Fatalf("dial was not pinned to resolved public IP: %q", dialAddress)
	}
	if requestHost != "iklim.bmkg.go.id" || serverName != "iklim.bmkg.go.id" {
		t.Fatalf("original host/SNI not preserved: host=%q sni=%q", requestHost, serverName)
	}
}

func TestSourcePreviewDoesNotExposeCredentialsFromNonJSONBody(t *testing.T) {
	server := httptest.NewTLSServer(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("upstream error api_key=leak-preview-secret"))
	}))
	defer server.Close()

	originalLookup := lookupOfficialSourceIPs
	originalDial := dialOfficialSourceContext
	originalTLSConfig := officialSourceTLSConfig
	t.Cleanup(func() {
		lookupOfficialSourceIPs = originalLookup
		dialOfficialSourceContext = originalDial
		officialSourceTLSConfig = originalTLSConfig
	})
	lookupOfficialSourceIPs = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
	}
	dialer := &net.Dialer{}
	dialOfficialSourceContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return dialer.DialContext(ctx, network, server.Listener.Addr().String())
	}
	officialSourceTLSConfig = func(host string) *tls.Config {
		return &tls.Config{ServerName: host, InsecureSkipVerify: true} // test server certificate is self-signed.
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(stdhttp.MethodPost, "/preview", nil)
	result, err := executeSourcePreview(ctx, sourceRuntimeConfig{
		Source: "bnpb", Endpoint: "https://data.bnpb.go.id/feed",
		AdapterVersion: "v1", FieldMapping: map[string]string{},
	})
	if err != nil {
		t.Fatalf("preview failed: %v", err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "leak-preview-secret") {
		t.Fatalf("non-JSON credential leaked into browser response: %s", encoded)
	}
}

func TestExecuteSourcePreviewReadsBMKGCAPRSSIndex(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := httptest.NewTLSServer(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item><link>https://warning.bmkg.go.id/cap/202607120201.xml</link></item>
    <item><link>https://ews.bmkg.go.id/cap/202607120202.xml</link></item>
  </channel>
</rss>`))
	}))
	defer server.Close()

	_, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatalf("split test server host: %v", err)
	}

	originalLookup := lookupOfficialSourceIPs
	originalDial := dialOfficialSourceContext
	originalTLSConfig := officialSourceTLSConfig
	lookupOfficialSourceIPs = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
	}
	dialer := &net.Dialer{}
	dialOfficialSourceContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return dialer.DialContext(ctx, network, server.Listener.Addr().String())
	}
	officialSourceTLSConfig = func(host string) *tls.Config {
		return &tls.Config{ServerName: host, InsecureSkipVerify: true} // test server certificate is self-signed.
	}
	t.Cleanup(func() {
		lookupOfficialSourceIPs = originalLookup
		dialOfficialSourceContext = originalDial
		officialSourceTLSConfig = originalTLSConfig
	})

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(stdhttp.MethodPost, "/preview", nil)

	result, err := executeSourcePreview(ctx, sourceRuntimeConfig{
		Source:         "bmkg_cap",
		Endpoint:       "https://bmkg.go.id:" + port + "/alerts/nowcast/id",
		AdapterVersion: "v1",
		FieldMapping:   map[string]string{},
	})
	if err != nil {
		t.Fatalf("preview failed: %v", err)
	}
	if !result.Reachable || !result.ContractValid {
		t.Fatalf("expected reachable valid CAP preview: %#v", result)
	}
	if result.RecordCount != 2 || result.ValidCount != 2 || result.InvalidCount != 0 {
		t.Fatalf("unexpected counts: record=%d valid=%d invalid=%d", result.RecordCount, result.ValidCount, result.InvalidCount)
	}
}
