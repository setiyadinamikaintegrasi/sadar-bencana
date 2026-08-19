package http

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	operationMapMaximumExtentDegrees = 20
	operationMapMaximumEventWindow   = 72 * time.Hour
	operationMapEventLimit           = 2000
	operationMapAlertLimit           = 200
	operationMapAirQualityLimit      = 500
	operationMapEvacuationLimit      = 2000
)

// OperationMapFeatureProperties is the public, presentation-safe metadata for
// a GeoJSON feature served by an operational map endpoint.
type OperationMapFeatureProperties struct {
	ID                 string     `json:"id"`
	Layer              string     `json:"layer"`
	Label              string     `json:"label"`
	PerilType          string     `json:"peril_type,omitempty"`
	Severity           string     `json:"severity,omitempty"`
	// Magnitude kejadian (gempa M, dsb.) + tempat agar popup peta informatif.
	Magnitude          *float64   `json:"magnitude,omitempty"`
	Place              string     `json:"place,omitempty"`
	Source             string     `json:"source"`
	Attribution        string     `json:"attribution"`
	SourceURL          string     `json:"source_url,omitempty"`
	VerificationStatus string     `json:"verification_status"`
	ObservedAt         *time.Time `json:"observed_at,omitempty"`
	EffectiveAt        *time.Time `json:"effective_at,omitempty"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	DataVintage        *time.Time `json:"data_vintage,omitempty"`
	Pollutant          string     `json:"pollutant,omitempty"`
	Value              *float64   `json:"value,omitempty"`
	Unit               string     `json:"unit,omitempty"`
	Category           string     `json:"category,omitempty"`
	Stale              *bool      `json:"stale,omitempty"`
	LocationType       string     `json:"location_type,omitempty"`
	Open               *bool      `json:"open,omitempty"`
	Full               *bool      `json:"full,omitempty"`
}

const operationMapWatchZonesQuery = `
SELECT id, label, latitude, longitude
FROM ews_watch_zones
WHERE subscriber_id = $1
  AND latitude BETWEEN $2 AND $3
  AND longitude BETWEEN $4 AND $5
ORDER BY label ASC, id ASC
`

const operationMapPersonalAssetsQuery = `
SELECT id, name, category, latitude, longitude
FROM personal_assets
WHERE auth_user_id = $1
  AND latitude BETWEEN $2 AND $3
  AND longitude BETWEEN $4 AND $5
ORDER BY name ASC, id ASC
`

const (
	operationMapPrivateSource             = "private"
	operationMapPrivateAttribution        = "Authenticated user"
	operationMapPrivateVerificationStatus = "user-provided"
)

// OperationMapFeature is a single WGS84 GeoJSON feature.
type OperationMapFeature struct {
	Type       string                        `json:"type"`
	ID         string                        `json:"id"`
	Geometry   json.RawMessage               `json:"geometry"`
	Properties OperationMapFeatureProperties `json:"properties"`
}

// OperationMapFeatureCollection is the bounded GeoJSON response envelope for
// one operational map layer.
type OperationMapFeatureCollection struct {
	Type      string                `json:"type"`
	Features  []OperationMapFeature `json:"features"`
	Truncated bool                  `json:"truncated"`
	Layer     string                `json:"layer"`
}

type operationMapBBox struct {
	MinLongitude float64
	MinLatitude  float64
	MaxLongitude float64
	MaxLatitude  float64
}

type operationMapTimeMode uint8

const (
	operationMapNoTime operationMapTimeMode = iota
	operationMapEventTimeWindow
	operationMapAtTime
)

type operationMapQueryOptions struct {
	permittedPerils []string
	timeMode        operationMapTimeMode
	now             func() time.Time
}

type operationMapQuery struct {
	BBox   operationMapBBox
	Zoom   *int
	Perils []string
	From   time.Time
	To     time.Time
	At     *time.Time
}

func parseOperationMapQuery(c *gin.Context, options operationMapQueryOptions) (operationMapQuery, error) {
	bbox, err := parseOperationMapBBox(c.Query("bbox"))
	if err != nil {
		return operationMapQuery{}, err
	}

	query := operationMapQuery{BBox: bbox}
	if raw := strings.TrimSpace(c.Query("zoom")); raw != "" {
		zoom, err := strconv.Atoi(raw)
		if err != nil || zoom < 0 || zoom > 18 {
			return operationMapQuery{}, fmt.Errorf("zoom must be an integer between 0 and 18")
		}
		query.Zoom = &zoom
	}

	perils, err := parseOperationMapPerils(c.Query("perils"), options.permittedPerils)
	if err != nil {
		return operationMapQuery{}, err
	}
	query.Perils = perils

	switch options.timeMode {
	case operationMapEventTimeWindow:
		from, to, err := parseOperationMapEventWindow(c.Query("from"), c.Query("to"), operationMapNow(options))
		if err != nil {
			return operationMapQuery{}, err
		}
		query.From, query.To = from, to
	case operationMapAtTime:
		if raw := strings.TrimSpace(c.Query("at")); raw != "" {
			at, err := parseOperationMapTimestamp(raw)
			if err != nil {
				return operationMapQuery{}, fmt.Errorf("invalid at: %w", err)
			}
			query.At = &at
		}
	}

	return query, nil
}

func parseOperationMapBBox(raw string) (operationMapBBox, error) {
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return operationMapBBox{}, fmt.Errorf("bbox must be minLon,minLat,maxLon,maxLat")
	}
	values := make([]float64, len(parts))
	for i, part := range parts {
		value, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return operationMapBBox{}, fmt.Errorf("bbox must contain finite numbers")
		}
		values[i] = value
	}
	bbox := operationMapBBox{
		MinLongitude: values[0],
		MinLatitude:  values[1],
		MaxLongitude: values[2],
		MaxLatitude:  values[3],
	}
	if bbox.MinLongitude < -180 || bbox.MaxLongitude > 180 || bbox.MinLatitude < -90 || bbox.MaxLatitude > 90 {
		return operationMapBBox{}, fmt.Errorf("bbox coordinates are outside the world")
	}
	if bbox.MinLongitude >= bbox.MaxLongitude || bbox.MinLatitude >= bbox.MaxLatitude {
		return operationMapBBox{}, fmt.Errorf("bbox values must be ordered min before max")
	}
	if bbox.MaxLongitude-bbox.MinLongitude > operationMapMaximumExtentDegrees || bbox.MaxLatitude-bbox.MinLatitude > operationMapMaximumExtentDegrees {
		return operationMapBBox{}, fmt.Errorf("bbox extent must not exceed %d degrees", operationMapMaximumExtentDegrees)
	}
	return bbox, nil
}

func parseOperationMapPerils(raw string, permitted []string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	allowed := make(map[string]struct{}, len(permitted))
	for _, peril := range permitted {
		allowed[strings.ToLower(strings.TrimSpace(peril))] = struct{}{}
	}
	seen := make(map[string]struct{})
	perils := make([]string, 0, len(strings.Split(raw, ",")))
	for _, rawPeril := range strings.Split(raw, ",") {
		peril := strings.ToLower(strings.TrimSpace(rawPeril))
		if peril == "" {
			return nil, fmt.Errorf("perils must not contain empty values")
		}
		if _, ok := allowed[peril]; !ok {
			return nil, fmt.Errorf("unsupported peril %q", peril)
		}
		if _, ok := seen[peril]; ok {
			continue
		}
		seen[peril] = struct{}{}
		perils = append(perils, peril)
	}
	return perils, nil
}

func parseOperationMapEventWindow(rawFrom, rawTo string, now time.Time) (time.Time, time.Time, error) {
	fromRaw, toRaw := strings.TrimSpace(rawFrom), strings.TrimSpace(rawTo)
	if fromRaw == "" && toRaw == "" {
		to := now.UTC()
		return to.Add(-operationMapMaximumEventWindow), to, nil
	}
	if fromRaw == "" || toRaw == "" {
		return time.Time{}, time.Time{}, fmt.Errorf("from and to must be supplied together")
	}
	from, err := parseOperationMapTimestamp(fromRaw)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid from: %w", err)
	}
	to, err := parseOperationMapTimestamp(toRaw)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid to: %w", err)
	}
	if !from.Before(to) {
		return time.Time{}, time.Time{}, fmt.Errorf("from must be before to")
	}
	if to.Sub(from) > operationMapMaximumEventWindow {
		return time.Time{}, time.Time{}, fmt.Errorf("event time window must not exceed 72 hours")
	}
	return from, to, nil
}

func parseOperationMapTimestamp(raw string) (time.Time, error) {
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("must be RFC3339")
	}
	return value.UTC(), nil
}

func operationMapNow(options operationMapQueryOptions) time.Time {
	if options.now != nil {
		return options.now().UTC()
	}
	return time.Now().UTC()
}

func writePublicOperationMapJSON(c *gin.Context, status int, payload any) {
	c.Header("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=60")
	addOperationMapVary(c, "Accept-Encoding")
	c.JSON(status, payload)
}

func writePrivateOperationMapJSON(c *gin.Context, status int, payload any) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, payload)
}

// OperationMapPrivateNoStore prevents caching for every private map response,
// including authentication failures that abort before a route handler runs.
func OperationMapPrivateNoStore() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}

func addOperationMapVary(c *gin.Context, value string) {
	for _, header := range c.Writer.Header().Values("Vary") {
		for _, existing := range strings.Split(header, ",") {
			if strings.EqualFold(strings.TrimSpace(existing), value) {
				return
			}
		}
	}
	c.Writer.Header().Add("Vary", value)
}

var operationMapEventsQuery = `
SELECT source, event_id, event_type, severity, magnitude, place, event_time, url, latitude, longitude
FROM events
WHERE ` + productionEventSQLPredicate("source", "event_id") + `
  AND event_time >= $1
  AND event_time < $2
  AND latitude BETWEEN $3 AND $4
  AND longitude BETWEEN $5 AND $6
  AND ($7::text[] IS NULL OR event_type = ANY($7::text[]))
ORDER BY event_time DESC NULLS LAST, source ASC, event_id ASC
LIMIT $8
`

const operationMapAlertsQuery = `
WITH active_alerts AS (
  SELECT source, source_alert_id, revision, headline, peril_type, severity,
         effective_at, expires_at, sent_at, source_url, area_geojson, latitude,
         longitude
  FROM official_alerts
  WHERE status = 'active'
    AND is_current = TRUE
    AND (effective_at IS NULL OR effective_at <= COALESCE($5::timestamptz, now()))
    AND (expires_at IS NULL OR expires_at >= COALESCE($5::timestamptz, now()))
    AND EXISTS (
      SELECT 1
      FROM official_source_settings s
      WHERE s.source_name = official_alerts.source
        AND s.enabled = TRUE
        AND s.run_mode = 'active'
    )
), area_candidates AS (
  SELECT *, CASE
    WHEN area_geojson IS NOT NULL
      AND jsonb_typeof(area_geojson) = 'object'
      AND (
        (
          area_geojson->>'type' = 'Polygon'
          AND jsonb_typeof(area_geojson->'coordinates') = 'array'
          AND jsonb_array_length(area_geojson->'coordinates') > 0
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(area_geojson->'coordinates') AS ring(value)
            WHERE jsonb_typeof(ring.value) <> 'array'
              OR jsonb_array_length(ring.value) < 4
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(ring.value) AS position(value)
                WHERE jsonb_typeof(position.value) <> 'array'
                  OR jsonb_array_length(position.value) < 2
                  OR jsonb_typeof(position.value->0) <> 'number'
                  OR jsonb_typeof(position.value->1) <> 'number'
                  OR position.value->0 < '-180'::jsonb
                  OR position.value->0 > '180'::jsonb
                  OR position.value->1 < '-90'::jsonb
                  OR position.value->1 > '90'::jsonb
              )
          )
        )
        OR (
          area_geojson->>'type' = 'MultiPolygon'
          AND jsonb_typeof(area_geojson->'coordinates') = 'array'
          AND jsonb_array_length(area_geojson->'coordinates') > 0
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(area_geojson->'coordinates') AS polygon(value)
            WHERE jsonb_typeof(polygon.value) <> 'array'
              OR jsonb_array_length(polygon.value) = 0
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(polygon.value) AS ring(value)
                WHERE jsonb_typeof(ring.value) <> 'array'
                  OR jsonb_array_length(ring.value) < 4
                  OR EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(ring.value) AS position(value)
                    WHERE jsonb_typeof(position.value) <> 'array'
                      OR jsonb_array_length(position.value) < 2
                      OR jsonb_typeof(position.value->0) <> 'number'
                      OR jsonb_typeof(position.value->1) <> 'number'
                      OR position.value->0 < '-180'::jsonb
                      OR position.value->0 > '180'::jsonb
                      OR position.value->1 < '-90'::jsonb
                      OR position.value->1 > '90'::jsonb
                  )
              )
          )
        )
      )
    THEN ST_SetSRID(ST_GeomFromGeoJSON(area_geojson::text), 4326)
  END AS area_geometry
  FROM active_alerts
), display_geometries AS (
  SELECT *, CASE
    WHEN area_geometry IS NOT NULL AND ST_IsValid(area_geometry) THEN area_geometry
    WHEN latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
      THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
  END AS display_geometry
  FROM area_candidates
)
SELECT source, source_alert_id, headline, peril_type, severity, effective_at,
       expires_at, sent_at, source_url, ST_AsGeoJSON(display_geometry)::json AS geometry
FROM display_geometries
WHERE display_geometry IS NOT NULL
  AND ST_Intersects(display_geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
ORDER BY sent_at DESC, source ASC, source_alert_id ASC, revision DESC
LIMIT $6
`

const operationMapAirQualityQuery = `
WITH latest AS (
  SELECT DISTINCT ON (o.station_id, o.pollutant)
         o.id, o.source, o.station_id, o.station_name, o.latitude, o.longitude,
         o.pollutant, o.value, o.unit, o.category, o.observed_at, o.source_url,
         (o.observed_at < COALESCE($5::timestamptz, now()) - make_interval(secs => 2 * s.expected_interval_seconds)) AS stale,
         o.ingested_at
  FROM air_quality_observations o
  JOIN official_source_settings s ON s.source_name = 'bmkg_air_quality'
    AND s.enabled = TRUE
    AND s.run_mode = 'active'
  WHERE o.observed_at <= COALESCE($5::timestamptz, now())
  ORDER BY o.station_id, o.pollutant, o.observed_at DESC, o.id ASC
)
SELECT id, source, station_id, station_name, latitude, longitude, pollutant,
       value, unit, category, observed_at, source_url, stale, ingested_at
FROM latest
WHERE latitude BETWEEN $2 AND $4
  AND longitude BETWEEN $1 AND $3
ORDER BY CASE category
           WHEN 'Berbahaya' THEN 5 WHEN 'Sangat Tidak Sehat' THEN 4
           WHEN 'Tidak Sehat' THEN 3 WHEN 'Sedang' THEN 2 ELSE 1
         END DESC,
         observed_at DESC,
         station_id ASC,
         pollutant ASC,
         id ASC
LIMIT $6
`

const operationMapEvacuationsQuery = `
SELECT id, name, location_type, source_type, latitude, longitude, is_open, is_full
FROM evacuation_locations
WHERE is_active = TRUE
  AND latitude BETWEEN $1 AND $2
  AND longitude BETWEEN $3 AND $4
ORDER BY name ASC, id ASC
LIMIT $5
`

var operationMapEventPerils = []string{"earthquake", "wildfire", "flood", "volcano"}

// OperationMapEvents serves public, viewport-bounded event features.
func OperationMapEvents(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		status, featureCount, truncated := http.StatusInternalServerError, 0, false
		defer operationMapTelemetry("events", started, &status, &featureCount, &truncated)

		if db == nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_unavailable")
			return
		}
		query, err := parseOperationMapQuery(c, operationMapQueryOptions{
			permittedPerils: operationMapEventPerils,
			timeMode:        operationMapEventTimeWindow,
		})
		if err != nil {
			status = http.StatusBadRequest
			operationMapError(c, status, "invalid_query")
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), operationMapEventsQuery,
			query.From, query.To, query.BBox.MinLatitude, query.BBox.MaxLatitude,
			query.BBox.MinLongitude, query.BBox.MaxLongitude, nullableOperationMapPerils(query.Perils), operationMapEventLimit+1)
		if err != nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_query_failed")
			return
		}
		defer rows.Close()

		features := make([]OperationMapFeature, 0, operationMapEventLimit)
		for rows.Next() {
			var source, eventID, eventType string
			var severity sql.NullString
			var place, url sql.NullString
			var magnitude sql.NullFloat64
			var eventTime time.Time
			var latitude, longitude float64
			if err := rows.Scan(&source, &eventID, &eventType, &severity, &magnitude, &place, &eventTime, &url, &latitude, &longitude); err != nil {
				status = http.StatusInternalServerError
				operationMapError(c, status, "row_scan_failed")
				return
			}
			if len(features) == operationMapEventLimit {
				truncated = true
				break
			}
			features = append(features, operationMapPointFeature(operationMapSourceQualifiedID(source, eventID), "events", operationMapLabel(nullableOperationMapString(place), eventType), longitude, latitude,
				OperationMapFeatureProperties{
					PerilType:          eventType,
					Severity:           nullableOperationMapString(severity),
					Magnitude:          operationMapFloat64Ptr(magnitude),
					Place:              nullableOperationMapString(place),
					Source:             source,
					Attribution:        operationMapAttribution(source),
					SourceURL:          nullableOperationMapString(url),
					VerificationStatus: "source-reported",
					ObservedAt:         operationMapTimePtr(eventTime),
				}))
		}
		if err := rows.Err(); err != nil {
			status = http.StatusInternalServerError
			operationMapError(c, status, "rows_iteration_failed")
			return
		}

		featureCount, status = len(features), http.StatusOK
		writePublicOperationMapJSON(c, status, operationMapCollection("events", features, truncated))
	}
}

// OperationMapAlerts serves active official alert features from enabled sources.
func OperationMapAlerts(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		status, featureCount, truncated := http.StatusInternalServerError, 0, false
		defer operationMapTelemetry("alerts", started, &status, &featureCount, &truncated)

		if db == nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_unavailable")
			return
		}
		query, err := parseOperationMapQuery(c, operationMapQueryOptions{timeMode: operationMapAtTime})
		if err != nil {
			status = http.StatusBadRequest
			operationMapError(c, status, "invalid_query")
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), operationMapAlertsQuery,
			query.BBox.MinLongitude, query.BBox.MinLatitude, query.BBox.MaxLongitude, query.BBox.MaxLatitude, query.At, operationMapAlertLimit+1)
		if err != nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_query_failed")
			return
		}
		defer rows.Close()

		features := make([]OperationMapFeature, 0, operationMapAlertLimit)
		for rows.Next() {
			var source, sourceAlertID string
			var headline, perilType, severity, sourceURL sql.NullString
			var effectiveAt, expiresAt sql.NullTime
			var sentAt time.Time
			var geometry json.RawMessage
			if err := rows.Scan(&source, &sourceAlertID, &headline, &perilType, &severity, &effectiveAt, &expiresAt, &sentAt, &sourceURL, &geometry); err != nil {
				status = http.StatusInternalServerError
				operationMapError(c, status, "row_scan_failed")
				return
			}
			if len(features) == operationMapAlertLimit {
				truncated = true
				break
			}

			properties := OperationMapFeatureProperties{
				PerilType:          nullableOperationMapString(perilType),
				Severity:           nullableOperationMapString(severity),
				Source:             source,
				Attribution:        operationMapAttribution(source),
				SourceURL:          nullableOperationMapString(sourceURL),
				VerificationStatus: "official",
				ObservedAt:         operationMapTimePtr(sentAt),
				EffectiveAt:        nullableOperationMapTime(effectiveAt),
				ExpiresAt:          nullableOperationMapTime(expiresAt),
			}
			features = append(features, operationMapGeometryFeature(operationMapSourceQualifiedID(source, sourceAlertID), "alerts", operationMapLabel(nullableOperationMapString(headline), nullableOperationMapString(perilType)), geometry, properties))
		}
		if err := rows.Err(); err != nil {
			status = http.StatusInternalServerError
			operationMapError(c, status, "rows_iteration_failed")
			return
		}

		featureCount, status = len(features), http.StatusOK
		writePublicOperationMapJSON(c, status, operationMapCollection("alerts", features, truncated))
	}
}

// OperationMapAirQuality serves public BMKG air-quality point features.
func OperationMapAirQuality(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		status, featureCount, truncated := http.StatusInternalServerError, 0, false
		defer operationMapTelemetry("air-quality", started, &status, &featureCount, &truncated)

		if db == nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_unavailable")
			return
		}
		query, err := parseOperationMapQuery(c, operationMapQueryOptions{timeMode: operationMapAtTime})
		if err != nil {
			status = http.StatusBadRequest
			operationMapError(c, status, "invalid_query")
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), operationMapAirQualityQuery,
			query.BBox.MinLongitude, query.BBox.MinLatitude, query.BBox.MaxLongitude, query.BBox.MaxLatitude, query.At, operationMapAirQualityLimit+1)
		if err != nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_query_failed")
			return
		}
		defer rows.Close()

		features := make([]OperationMapFeature, 0, operationMapAirQualityLimit)
		for rows.Next() {
			var id, source, stationID, stationName, pollutant, unit, category string
			var latitude, longitude float64
			var value float64
			var observedAt, ingestedAt time.Time
			var sourceURL sql.NullString
			var stale bool
			if err := rows.Scan(&id, &source, &stationID, &stationName, &latitude, &longitude, &pollutant, &value, &unit, &category, &observedAt, &sourceURL, &stale, &ingestedAt); err != nil {
				status = http.StatusInternalServerError
				operationMapError(c, status, "row_scan_failed")
				return
			}
			if len(features) == operationMapAirQualityLimit {
				truncated = true
				break
			}
			featureID := source + ":" + stationID + ":" + pollutant
			features = append(features, operationMapPointFeature(featureID, "air-quality", stationName, longitude, latitude,
				OperationMapFeatureProperties{
					Source:             source,
					Attribution:        operationMapAttribution(source),
					SourceURL:          nullableOperationMapString(sourceURL),
					VerificationStatus: "official",
					ObservedAt:         operationMapTimePtr(observedAt),
					DataVintage:        operationMapTimePtr(ingestedAt),
					Pollutant:          pollutant,
					Value:              &value,
					Unit:               unit,
					Category:           category,
					Stale:              &stale,
				}))
		}
		if err := rows.Err(); err != nil {
			status = http.StatusInternalServerError
			operationMapError(c, status, "rows_iteration_failed")
			return
		}

		featureCount, status = len(features), http.StatusOK
		writePublicOperationMapJSON(c, status, operationMapCollection("air-quality", features, truncated))
	}
}

// OperationMapEvacuations serves public, active evacuation-location features.
func OperationMapEvacuations(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		status, featureCount, truncated := http.StatusInternalServerError, 0, false
		defer operationMapTelemetry("evacuations", started, &status, &featureCount, &truncated)

		if db == nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_unavailable")
			return
		}
		query, err := parseOperationMapQuery(c, operationMapQueryOptions{timeMode: operationMapNoTime})
		if err != nil {
			status = http.StatusBadRequest
			operationMapError(c, status, "invalid_query")
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), operationMapEvacuationsQuery,
			query.BBox.MinLatitude, query.BBox.MaxLatitude, query.BBox.MinLongitude, query.BBox.MaxLongitude, operationMapEvacuationLimit+1)
		if err != nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_query_failed")
			return
		}
		defer rows.Close()

		features := make([]OperationMapFeature, 0, operationMapEvacuationLimit)
		for rows.Next() {
			var id, name, locationType, sourceType string
			var latitude, longitude float64
			var open, full sql.NullBool
			if err := rows.Scan(&id, &name, &locationType, &sourceType, &latitude, &longitude, &open, &full); err != nil {
				status = http.StatusInternalServerError
				operationMapError(c, status, "row_scan_failed")
				return
			}
			if len(features) == operationMapEvacuationLimit {
				truncated = true
				break
			}
			features = append(features, operationMapPointFeature(id, "evacuations", name, longitude, latitude,
				OperationMapFeatureProperties{
					Source:             sourceType,
					Attribution:        operationMapEvacuationAttribution(sourceType),
					VerificationStatus: operationMapEvacuationVerification(sourceType),
					LocationType:       locationType,
					Open:               nullableOperationMapBool(open),
					Full:               nullableOperationMapBool(full),
				}))
		}
		if err := rows.Err(); err != nil {
			status = http.StatusInternalServerError
			operationMapError(c, status, "rows_iteration_failed")
			return
		}

		featureCount, status = len(features), http.StatusOK
		writePublicOperationMapJSON(c, status, operationMapCollection("evacuations", features, truncated))
	}
}

// OperationMapWatchZones serves the authenticated subscriber's viewport-bounded watch zones.
func OperationMapWatchZones(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if db == nil {
			operationMapError(c, http.StatusServiceUnavailable, "database_unavailable")
			return
		}
		query, err := parseOperationMapQuery(c, operationMapQueryOptions{timeMode: operationMapNoTime})
		if err != nil {
			operationMapError(c, http.StatusBadRequest, "invalid_query")
			return
		}
		subscriberID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		rows, err := db.QueryContext(c.Request.Context(), operationMapWatchZonesQuery,
			subscriberID, query.BBox.MinLatitude, query.BBox.MaxLatitude,
			query.BBox.MinLongitude, query.BBox.MaxLongitude)
		if err != nil {
			operationMapError(c, http.StatusServiceUnavailable, "database_query_failed")
			return
		}
		defer rows.Close()

		features := make([]OperationMapFeature, 0)
		for rows.Next() {
			var id, label string
			var latitude, longitude float64
			if err := rows.Scan(&id, &label, &latitude, &longitude); err != nil {
				operationMapError(c, http.StatusInternalServerError, "row_scan_failed")
				return
			}
			features = append(features, operationMapPointFeature(id, "watch-zones", label, longitude, latitude,
				OperationMapFeatureProperties{
					Category:           "watch-zone",
					Source:             operationMapPrivateSource,
					Attribution:        operationMapPrivateAttribution,
					VerificationStatus: operationMapPrivateVerificationStatus,
				}))
		}
		if err := rows.Err(); err != nil {
			operationMapError(c, http.StatusInternalServerError, "rows_iteration_failed")
			return
		}
		writePrivateOperationMapJSON(c, http.StatusOK, operationMapCollection("watch-zones", features, false))
	}
}

// OperationMapPersonalAssets serves the authenticated user's viewport-bounded assets.
func OperationMapPersonalAssets(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if db == nil {
			operationMapError(c, http.StatusServiceUnavailable, "database_unavailable")
			return
		}
		query, err := parseOperationMapQuery(c, operationMapQueryOptions{timeMode: operationMapNoTime})
		if err != nil {
			operationMapError(c, http.StatusBadRequest, "invalid_query")
			return
		}
		rows, err := db.QueryContext(c.Request.Context(), operationMapPersonalAssetsQuery,
			AuthUserID(c), query.BBox.MinLatitude, query.BBox.MaxLatitude,
			query.BBox.MinLongitude, query.BBox.MaxLongitude)
		if err != nil {
			operationMapError(c, http.StatusServiceUnavailable, "database_query_failed")
			return
		}
		defer rows.Close()

		features := make([]OperationMapFeature, 0)
		for rows.Next() {
			var id, name, category string
			var latitude, longitude float64
			if err := rows.Scan(&id, &name, &category, &latitude, &longitude); err != nil {
				operationMapError(c, http.StatusInternalServerError, "row_scan_failed")
				return
			}
			features = append(features, operationMapPointFeature(id, "personal-assets", name, longitude, latitude,
				OperationMapFeatureProperties{
					Category:           category,
					Source:             operationMapPrivateSource,
					Attribution:        operationMapPrivateAttribution,
					VerificationStatus: operationMapPrivateVerificationStatus,
				}))
		}
		if err := rows.Err(); err != nil {
			operationMapError(c, http.StatusInternalServerError, "rows_iteration_failed")
			return
		}
		writePrivateOperationMapJSON(c, http.StatusOK, operationMapCollection("personal-assets", features, false))
	}
}

func operationMapCollection(layer string, features []OperationMapFeature, truncated bool) OperationMapFeatureCollection {
	return OperationMapFeatureCollection{Type: "FeatureCollection", Layer: layer, Features: features, Truncated: truncated}
}

func operationMapPointFeature(id, layer, label string, longitude, latitude float64, properties OperationMapFeatureProperties) OperationMapFeature {
	geometry, _ := json.Marshal(struct {
		Type        string    `json:"type"`
		Coordinates []float64 `json:"coordinates"`
	}{Type: "Point", Coordinates: []float64{longitude, latitude}})
	return operationMapGeometryFeature(id, layer, label, geometry, properties)
}

func operationMapGeometryFeature(id, layer, label string, geometry json.RawMessage, properties OperationMapFeatureProperties) OperationMapFeature {
	properties.ID = id
	properties.Layer = layer
	properties.Label = label
	return OperationMapFeature{Type: "Feature", ID: id, Geometry: geometry, Properties: properties}
}

func operationMapSourceQualifiedID(source, id string) string {
	return source + ":" + id
}

func operationMapError(c *gin.Context, status int, code string) {
	c.JSON(status, gin.H{"error": code})
}

func operationMapTelemetry(endpoint string, started time.Time, status, featureCount *int, truncated *bool) {
	log.Printf("operation_map endpoint=%s status=%d elapsed_ms=%d features=%d truncated=%t", endpoint, *status, time.Since(started).Milliseconds(), *featureCount, *truncated)
}

func operationMapAttribution(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "bmkg":
		return "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)"
	case "usgs":
		return "United States Geological Survey"
	case "nasa-firms":
		return "NASA FIRMS"
	default:
		return strings.TrimSpace(source)
	}
}

func operationMapEvacuationAttribution(sourceType string) string {
	if strings.EqualFold(strings.TrimSpace(sourceType), "osm") {
		return "OpenStreetMap contributors"
	}
	return "SadarBencana"
}

func operationMapEvacuationVerification(sourceType string) string {
	if strings.EqualFold(strings.TrimSpace(sourceType), "osm") {
		return "community-sourced"
	}
	return "operator-reported"
}

func operationMapLabel(primary, fallback string) string {
	if label := strings.TrimSpace(primary); label != "" {
		return label
	}
	return strings.TrimSpace(fallback)
}

func nullableOperationMapPerils(perils []string) any {
	if len(perils) == 0 {
		return nil
	}
	return toPGTextArray(perils)
}

func nullableOperationMapString(value sql.NullString) string {
	if value.Valid {
		return value.String
	}
	return ""
}

func nullableOperationMapTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return operationMapTimePtr(value.Time)
}

func operationMapTimePtr(value time.Time) *time.Time {
	utc := value.UTC()
	return &utc
}

func operationMapFloat64Ptr(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	result := value.Float64
	return &result
}

func nullableOperationMapBool(value sql.NullBool) *bool {
	if !value.Valid {
		return nil
	}
	result := value.Bool
	return &result
}
