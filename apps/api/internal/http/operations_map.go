package http

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	operationMapMaximumExtentDegrees = 20
	operationMapMaximumEventWindow   = 72 * time.Hour
)

// OperationMapFeatureProperties is the public, presentation-safe metadata for
// a GeoJSON feature served by an operational map endpoint.
type OperationMapFeatureProperties struct {
	ID                 string     `json:"id"`
	Layer              string     `json:"layer"`
	Label              string     `json:"label"`
	PerilType          string     `json:"peril_type,omitempty"`
	Severity           string     `json:"severity,omitempty"`
	Source             string     `json:"source"`
	Attribution        string     `json:"attribution"`
	SourceURL          string     `json:"source_url,omitempty"`
	VerificationStatus string     `json:"verification_status"`
	ObservedAt         *time.Time `json:"observed_at,omitempty"`
	EffectiveAt        *time.Time `json:"effective_at,omitempty"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	DataVintage        *time.Time `json:"data_vintage,omitempty"`
}

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
	c.Header("Vary", "Accept-Encoding")
	c.JSON(status, payload)
}

func writePrivateOperationMapJSON(c *gin.Context, status int, payload any) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, payload)
}
