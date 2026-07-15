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
		{name: "observation required station", collection: "observations", mutate: func(record map[string]any) { delete(record, "station_name") }},
		{name: "observation identifier length", collection: "observations", mutate: func(record map[string]any) { record["station_id"] = strings.Repeat("s", 256) }},
		{name: "observation numeric value", collection: "observations", mutate: func(record map[string]any) { record["value"] = "66.2" }},
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
