package http

import (
	"context"
	"crypto/tls"
	"net"
	stdhttp "net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

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

	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	_, port, err := net.SplitHostPort(serverURL.Host)
	if err != nil {
		t.Fatalf("split test server host: %v", err)
	}

	originalTransport := stdhttp.DefaultTransport
	dialer := &net.Dialer{}
	transport := &stdhttp.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // test server certificate is self-signed.
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			if strings.HasPrefix(address, "bmkg.go.id:") {
				return dialer.DialContext(ctx, network, serverURL.Host)
			}
			return dialer.DialContext(ctx, network, address)
		},
	}
	stdhttp.DefaultTransport = transport
	t.Cleanup(func() {
		transport.CloseIdleConnections()
		stdhttp.DefaultTransport = originalTransport
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
