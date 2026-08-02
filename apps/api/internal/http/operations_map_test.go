package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-contrib/cors"
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

func TestPublicOperationMapJSONPreservesCORSVaryValues(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const origin = "https://app.example.test"
	router := gin.New()
	router.Use(cors.New(cors.Config{AllowOrigins: []string{origin}}))
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Add("Vary", "Accept-Encoding")
		c.Next()
	})
	router.GET("/", func(c *gin.Context) {
		writePublicOperationMapJSON(c, http.StatusOK, gin.H{"type": "FeatureCollection"})
	})

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Origin", origin)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q", got, origin)
	}
	varyCount := map[string]int{}
	for _, header := range recorder.Header().Values("Vary") {
		for _, value := range strings.Split(header, ",") {
			varyCount[strings.TrimSpace(value)]++
		}
	}
	if got, want := varyCount["Origin"], 1; got != want {
		t.Fatalf("Vary Origin count = %d, want %d; headers = %#v", got, want, recorder.Header().Values("Vary"))
	}
	if got, want := varyCount["Accept-Encoding"], 1; got != want {
		t.Fatalf("Vary Accept-Encoding count = %d, want %d; headers = %#v", got, want, recorder.Header().Values("Vary"))
	}
}

func TestOperationMapPublicEventsReturnsBoundedSafeFeatures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC)
	rows := sqlmock.NewRows([]string{
		"source", "event_id", "event_type", "severity", "place", "event_time", "url", "latitude", "longitude",
	})
	for range 2001 {
		rows.AddRow("bmkg", "bmkg-20260802-1", "earthquake", "High", "Jakarta", now, "https://example.test/event", -6.2, 106.8)
	}
	mock.ExpectQuery("(?s)FROM events.*event_time.*latitude.*longitude.*LIMIT \\$8").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), -6.4, -6.0, 106.7, 107.1, nil, 2001).
		WillReturnRows(rows)

	body := requestOperationMap(t, OperationMapEvents(db), "/api/v1/map/operations/events?bbox=106.7,-6.4,107.1,-6.0&zoom=8")
	assertOperationMapPublicFeatureCollection(t, body, "events", 2000, []float64{106.8, -6.2})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOperationMapPublicEventsUsesSourceQualifiedIDsAndNullableFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	from := time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	rows := sqlmock.NewRows([]string{
		"source", "event_id", "event_type", "severity", "place", "event_time", "url", "latitude", "longitude",
	}).
		AddRow("bmkg", "shared-id", "earthquake", nil, nil, to, nil, -6.2, 106.8).
		AddRow("usgs", "shared-id", "earthquake", "High", "Jakarta", to, "https://example.test/event", -6.2, 106.8)
	productionPredicate := regexp.QuoteMeta(productionEventSQLPredicate("source", "event_id"))
	mock.ExpectQuery("(?s)SELECT source, event_id.*WHERE "+productionPredicate+".*ORDER BY event_time DESC NULLS LAST, source ASC, event_id ASC.*LIMIT \\$8").
		WithArgs(from, to, -6.4, -6.0, 106.7, 107.1, `{"earthquake"}`, 2001).
		WillReturnRows(rows)

	body := requestOperationMap(t, OperationMapEvents(db), "/api/v1/map/operations/events?bbox=106.7,-6.4,107.1,-6.0&from=2026-08-02T00:00:00Z&to=2026-08-02T01:00:00Z&perils=earthquake")
	features := body["features"].([]any)
	if got, want := []string{features[0].(map[string]any)["id"].(string), features[1].(map[string]any)["id"].(string)}, []string{"bmkg:shared-id", "usgs:shared-id"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("feature IDs = %#v, want %#v", got, want)
	}
	firstProperties := features[0].(map[string]any)["properties"].(map[string]any)
	if got := firstProperties["label"]; got != "earthquake" {
		t.Fatalf("NULL place label = %#v, want earthquake", got)
	}
	if _, exists := firstProperties["source_url"]; exists {
		t.Fatalf("NULL URL serialized: %#v", firstProperties)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOperationMapPublicAirQualityQueriesLatestAsOfSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	at := time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC)
	queryExpectation := `(?s)WITH latest AS.*DISTINCT ON \(o.station_id, o.pollutant\).*o.observed_at < COALESCE\(\$5::timestamptz, now\(\)\).*o.observed_at <= COALESCE\(\$5::timestamptz, now\(\)\).*LIMIT \$6`
	mock.ExpectQuery(queryExpectation).
		WithArgs(106.7, -6.4, 107.1, -6.0, at, 501).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "source", "station_id", "station_name", "latitude", "longitude", "pollutant", "value", "unit", "category", "observed_at", "source_url", "stale", "ingested_at",
		}).AddRow(
			"observation-row", "bmkg", "station-1", "Jakarta Station", -6.2, 106.8, "pm25", 66.2, "ug/m3", "Tidak Sehat", at.Add(-time.Minute), "https://example.test/aq", false, at,
		))

	body := requestOperationMap(t, OperationMapAirQuality(db), "/api/v1/map/operations/air-quality?bbox=106.7,-6.4,107.1,-6.0&at=2026-08-02T00:00:00Z")
	properties := body["features"].([]any)[0].(map[string]any)["properties"].(map[string]any)
	if got := properties["stale"]; got != false {
		t.Fatalf("stale = %#v, want false at the supplied snapshot time", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOperationMapPublicAlertsReturnsBoundedSafeFeatures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	at := time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC)
	rows := sqlmock.NewRows([]string{
		"source", "source_alert_id", "headline", "peril_type", "severity", "effective_at", "expires_at", "sent_at", "source_url", "geometry",
	})
	for range 201 {
		rows.AddRow("bmkg", "bmkg-alert-1", "Heavy rain", "weather", "High", at, at.Add(time.Hour), at, "https://example.test/alert", []byte(`{"type":"Polygon","coordinates":[[[106.7,-6.4],[107.1,-6.4],[107.1,-6.0],[106.7,-6.4]]]}`))
	}
	mock.ExpectQuery("(?s)WITH active_alerts AS.*FROM official_alerts.*status = 'active'.*is_current = TRUE.*s.enabled = TRUE.*s.run_mode = 'active'.*ST_MakeEnvelope.*LIMIT \\$6").
		WithArgs(106.7, -6.4, 107.1, -6.0, at, 201).
		WillReturnRows(rows)

	body := requestOperationMap(t, OperationMapAlerts(db), "/api/v1/map/operations/alerts?bbox=106.7,-6.4,107.1,-6.0&at=2026-08-02T00:00:00Z")
	assertOperationMapPublicFeatureCollection(t, body, "alerts", 200, nil)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOperationMapPublicAlertsFallsBackToValidatedPointForInvalidAreaGeometry(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	at := time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery("(?s)WITH active_alerts AS.*FROM official_alerts.*status = 'active'.*is_current = TRUE.*s.enabled = TRUE.*s.run_mode = 'active'.*ST_MakeEnvelope.*LIMIT \\$6").
		WithArgs(106.7, -6.4, 107.1, -6.0, at, 201).
		WillReturnRows(sqlmock.NewRows([]string{
			"source", "source_alert_id", "headline", "peril_type", "severity", "effective_at", "expires_at", "sent_at", "source_url", "geometry",
		}).AddRow(
			"bmkg", "bmkg-alert-1", "Heavy rain", "weather", "High", at, at.Add(time.Hour), at, "https://example.test/alert", []byte(`{"type":"Point","coordinates":[106.8,-6.2]}`),
		))

	body := requestOperationMap(t, OperationMapAlerts(db), "/api/v1/map/operations/alerts?bbox=106.7,-6.4,107.1,-6.0&at=2026-08-02T00:00:00Z")
	if got := body["truncated"]; got != false {
		t.Fatalf("truncated = %#v, want false", got)
	}
	feature := body["features"].([]any)[0].(map[string]any)
	geometry := feature["geometry"].(map[string]any)
	if got := geometry["type"]; got != "Point" {
		t.Fatalf("geometry type = %#v, want Point fallback", got)
	}
	coordinates := geometry["coordinates"].([]any)
	if got := []float64{coordinates[0].(float64), coordinates[1].(float64)}; !reflect.DeepEqual(got, []float64{106.8, -6.2}) {
		t.Fatalf("point coordinates = %#v, want longitude/latitude", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOperationMapPublicAirQualityReturnsBoundedSafeFeatures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC)
	rows := sqlmock.NewRows([]string{
		"id", "source", "station_id", "station_name", "latitude", "longitude", "pollutant", "value", "unit", "category", "observed_at", "source_url", "stale", "ingested_at",
	})
	for range 501 {
		rows.AddRow("observation-row", "bmkg", "station-1", "Jakarta Station", -6.2, 106.8, "pm25", 66.2, "ug/m3", "Tidak Sehat", now, "https://example.test/aq", false, now)
	}
	mock.ExpectQuery("(?s)FROM air_quality_observations.*official_source_settings.*latitude.*longitude.*LIMIT \\$6").
		WithArgs(106.7, -6.4, 107.1, -6.0, nil, 501).
		WillReturnRows(rows)

	body := requestOperationMap(t, OperationMapAirQuality(db), "/api/v1/map/operations/air-quality?bbox=106.7,-6.4,107.1,-6.0")
	assertOperationMapPublicFeatureCollection(t, body, "air-quality", 500, []float64{106.8, -6.2})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOperationMapPublicEvacuationsReturnsBoundedSafeFeatures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rows := sqlmock.NewRows([]string{"id", "name", "location_type", "source_type", "latitude", "longitude", "is_open", "is_full"})
	for range 2001 {
		rows.AddRow("evacuation-row", "Community Hall", "shelter", "osm", -6.2, 106.8, true, false)
	}
	mock.ExpectQuery("(?s)FROM evacuation_locations.*is_active = TRUE.*latitude.*longitude.*LIMIT \\$5").
		WithArgs(-6.4, -6.0, 106.7, 107.1, 2001).
		WillReturnRows(rows)

	body := requestOperationMap(t, OperationMapEvacuations(db), "/api/v1/map/operations/evacuations?bbox=106.7,-6.4,107.1,-6.0&zoom=8")
	assertOperationMapPublicFeatureCollection(t, body, "evacuations", 2000, []float64{106.8, -6.2})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func requestOperationMap(t *testing.T, handler gin.HandlerFunc, target string) map[string]any {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, target, nil)
	handler(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if got, want := recorder.Header().Get("Cache-Control"), "public, max-age=30, s-maxage=60, stale-while-revalidate=60"; got != want {
		t.Fatalf("Cache-Control = %q, want %q", got, want)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return body
}

func assertOperationMapPublicFeatureCollection(t *testing.T, body map[string]any, layer string, wantCount int, wantPoint []float64) {
	t.Helper()
	if got := body["type"]; got != "FeatureCollection" {
		t.Fatalf("type = %#v, want FeatureCollection", got)
	}
	if got := body["layer"]; got != layer {
		t.Fatalf("layer = %#v, want %q", got, layer)
	}
	if got := body["truncated"]; got != true {
		t.Fatalf("truncated = %#v, want true", got)
	}
	features, ok := body["features"].([]any)
	if !ok || len(features) != wantCount {
		t.Fatalf("features = %#v, want %d features", body["features"], wantCount)
	}
	feature := features[0].(map[string]any)
	properties := feature["properties"].(map[string]any)
	for _, property := range []string{"id", "layer", "label", "source", "attribution", "verification_status"} {
		if _, ok := properties[property]; !ok {
			t.Fatalf("feature properties missing %q: %#v", property, properties)
		}
	}
	if wantPoint != nil {
		coordinates := feature["geometry"].(map[string]any)["coordinates"].([]any)
		if got := []float64{coordinates[0].(float64), coordinates[1].(float64)}; !reflect.DeepEqual(got, wantPoint) {
			t.Fatalf("point coordinates = %#v, want longitude/latitude %#v", got, wantPoint)
		}
	}
	serialized, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"raw_payload", "subscriber", "email", "personal_asset", "created_by", "owner", "phone", "person_in_charge", "capacity", "internal_notes"} {
		if strings.Contains(string(serialized), forbidden) {
			t.Fatalf("serialized response leaked %q: %s", forbidden, serialized)
		}
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
