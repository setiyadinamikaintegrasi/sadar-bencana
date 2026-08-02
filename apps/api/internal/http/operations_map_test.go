package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestOperationMapQueryParsesValidViewportAndPerils(t *testing.T) {
	now := time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC)
	query, err := parseOperationMapTestQuery(t,
		"bbox=106.7,-6.4,107.1,-6.0&zoom=8&perils=earthquake,flood,earthquake",
		operationMapQueryOptions{
			permittedPerils: []string{"earthquake", "flood"},
			timeMode:        operationMapEventTimeWindow,
			now:             func() time.Time { return now },
		},
	)
	if err != nil {
		t.Fatalf("parseOperationMapQuery() error = %v", err)
	}
	if got, want := query.BBox, (operationMapBBox{MinLongitude: 106.7, MinLatitude: -6.4, MaxLongitude: 107.1, MaxLatitude: -6.0}); got != want {
		t.Fatalf("bbox = %#v, want %#v", got, want)
	}
	if query.Zoom == nil || *query.Zoom != 8 {
		t.Fatalf("zoom = %#v, want 8", query.Zoom)
	}
	if got, want := query.Perils, []string{"earthquake", "flood"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("perils = %#v, want %#v", got, want)
	}
}

func TestOperationMapQueryRejectsInvalidValues(t *testing.T) {
	options := operationMapQueryOptions{
		permittedPerils: []string{"earthquake", "flood"},
		timeMode:        operationMapEventTimeWindow,
		now: func() time.Time {
			return time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC)
		},
	}

	for name, rawQuery := range map[string]string{
		"missing bbox":            "zoom=8",
		"malformed bbox":          "bbox=106.7,-6.4,not-a-number,-6.0",
		"inverted bbox":           "bbox=107.1,-6.4,106.7,-6.0",
		"latitude outside world":  "bbox=106.7,-91,107.1,-6.0",
		"longitude outside world": "bbox=181,-6.4,182,-6.0",
		"longitude extent":        "bbox=100,-6.4,121,-6.0",
		"latitude extent":         "bbox=106,-20,107,1",
		"zoom below range":        "bbox=106.7,-6.4,107.1,-6.0&zoom=-1",
		"zoom above range":        "bbox=106.7,-6.4,107.1,-6.0&zoom=19",
		"unsupported peril":       "bbox=106.7,-6.4,107.1,-6.0&perils=volcano",
		"malformed timestamp":     "bbox=106.7,-6.4,107.1,-6.0&from=not-a-time&to=2026-08-02T12:00:00Z",
		"event span above limit":  "bbox=106.7,-6.4,107.1,-6.0&from=2026-07-30T11:59:59Z&to=2026-08-02T12:00:00Z",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseOperationMapTestQuery(t, rawQuery, options); err == nil {
				t.Fatal("parseOperationMapQuery() error = nil, want validation error")
			}
		})
	}
}

func TestOperationMapQueryDefaultsEventWindowToMostRecent72Hours(t *testing.T) {
	now := time.Date(2026, time.August, 2, 12, 0, 0, 0, time.FixedZone("WIB", 7*60*60))
	query, err := parseOperationMapTestQuery(t, "bbox=106.7,-6.4,107.1,-6.0", operationMapQueryOptions{
		timeMode: operationMapEventTimeWindow,
		now:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("parseOperationMapQuery() error = %v", err)
	}
	if got, want := query.From, now.UTC().Add(-72*time.Hour); !got.Equal(want) || got.Location() != time.UTC {
		t.Fatalf("from = %s (%s), want %s (UTC)", got, got.Location(), want)
	}
	if got, want := query.To, now.UTC(); !got.Equal(want) || got.Location() != time.UTC {
		t.Fatalf("to = %s (%s), want %s (UTC)", got, got.Location(), want)
	}
}

func TestOperationMapQueryAcceptsSingleAtForAlertsAndAirQuality(t *testing.T) {
	for _, layer := range []string{"alerts", "air-quality"} {
		t.Run(layer, func(t *testing.T) {
			query, err := parseOperationMapTestQuery(t,
				"bbox=106.7,-6.4,107.1,-6.0&at=2026-08-02T07:00:00%2B07:00",
				operationMapQueryOptions{timeMode: operationMapAtTime},
			)
			if err != nil {
				t.Fatalf("parseOperationMapQuery() error = %v", err)
			}
			if query.At == nil || !query.At.Equal(time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC)) || query.At.Location() != time.UTC {
				t.Fatalf("at = %#v, want normalized UTC timestamp", query.At)
			}
		})
	}
}

func TestOperationMapFeatureCollectionJSONContract(t *testing.T) {
	collection := OperationMapFeatureCollection{
		Type:  "FeatureCollection",
		Layer: "events",
		Features: []OperationMapFeature{{
			Type:     "Feature",
			ID:       "event-1",
			Geometry: json.RawMessage(`{"type":"Point","coordinates":[106.8,-6.2]}`),
			Properties: OperationMapFeatureProperties{
				ID:                 "event-1",
				Layer:              "events",
				Label:              "Jakarta",
				Source:             "BMKG",
				Attribution:        "BMKG",
				VerificationStatus: "verified",
			},
		}},
	}

	body, err := json.Marshal(collection)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["type"] != "FeatureCollection" || decoded["layer"] != "events" || decoded["truncated"] != false {
		t.Fatalf("collection contract = %#v", decoded)
	}
	properties := decoded["features"].([]any)[0].(map[string]any)["properties"].(map[string]any)
	if _, exists := properties["peril_type"]; exists {
		t.Fatalf("optional peril_type was serialized: %#v", properties)
	}
}

func TestOperationMapJSONWritersSetFixedCacheHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		name  string
		write func(*gin.Context, int, any)
	}{
		{name: "public", write: writePublicOperationMapJSON},
		{name: "private", write: writePrivateOperationMapJSON},
	} {
		t.Run(test.name, func(t *testing.T) {
			router := gin.New()
			router.GET("/", func(c *gin.Context) {
				c.Header("Cache-Control", "caller-controlled")
				test.write(c, http.StatusOK, gin.H{"type": "FeatureCollection"})
			})
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			if test.name == "public" {
				if got, want := recorder.Header().Get("Cache-Control"), "public, max-age=30, s-maxage=60, stale-while-revalidate=60"; got != want {
					t.Fatalf("Cache-Control = %q, want %q", got, want)
				}
				if got, want := recorder.Header().Get("Vary"), "Accept-Encoding"; got != want {
					t.Fatalf("Vary = %q, want %q", got, want)
				}
			} else if got, want := recorder.Header().Get("Cache-Control"), "no-store"; got != want {
				t.Fatalf("Cache-Control = %q, want %q", got, want)
			}
		})
	}
}

func parseOperationMapTestQuery(t *testing.T, rawQuery string, options operationMapQueryOptions) (operationMapQuery, error) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	var query operationMapQuery
	var parseErr error
	router.GET("/", func(c *gin.Context) {
		query, parseErr = parseOperationMapQuery(c, options)
	})
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/?"+rawQuery, nil))
	return query, parseErr
}
