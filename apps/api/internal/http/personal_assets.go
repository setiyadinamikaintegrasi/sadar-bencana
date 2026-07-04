package http

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type PersonalAsset struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Category       string          `json:"category"`
	Address        string          `json:"address"`
	Latitude       float64         `json:"latitude"`
	Longitude      float64         `json:"longitude"`
	EstimatedValue *float64        `json:"estimated_value"`
	Currency       string          `json:"currency"`
	Notes          string          `json:"notes"`
	PerilTypes     []string        `json:"peril_types"`
	AlertRadiusKM  float64         `json:"alert_radius_km"`
	Thresholds     json.RawMessage `json:"thresholds"`
	IsActive       bool            `json:"is_active"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

type personalAssetBody struct {
	Name           string          `json:"name"`
	Category       string          `json:"category"`
	Address        string          `json:"address"`
	Latitude       *float64        `json:"latitude"`
	Longitude      *float64        `json:"longitude"`
	EstimatedValue *float64        `json:"estimated_value"`
	Currency       string          `json:"currency"`
	Notes          string          `json:"notes"`
	PerilTypes     []string        `json:"peril_types"`
	AlertRadiusKM  *float64        `json:"alert_radius_km"`
	Thresholds     json.RawMessage `json:"thresholds"`
	IsActive       *bool           `json:"is_active"`
}

const personalAssetColumns = `id,name,category,address,latitude,longitude,
	estimated_value,currency,notes,array_to_string(peril_types,','),
	alert_radius_km,thresholds,is_active,created_at,updated_at`

func scanPersonalAsset(scanner rowScanner) (PersonalAsset, error) {
	var asset PersonalAsset
	var value sql.NullFloat64
	var perils string
	var thresholds []byte
	err := scanner.Scan(&asset.ID, &asset.Name, &asset.Category, &asset.Address,
		&asset.Latitude, &asset.Longitude, &value, &asset.Currency, &asset.Notes,
		&perils, &asset.AlertRadiusKM, &thresholds, &asset.IsActive,
		&asset.CreatedAt, &asset.UpdatedAt)
	if value.Valid {
		asset.EstimatedValue = &value.Float64
	}
	asset.PerilTypes = parsePGTextArray(perils)
	asset.Thresholds = json.RawMessage(thresholds)
	return asset, err
}

func normalizePersonalAsset(body *personalAssetBody) error {
	body.Name = strings.TrimSpace(body.Name)
	body.Category = strings.ToLower(strings.TrimSpace(body.Category))
	body.Currency = strings.ToUpper(strings.TrimSpace(body.Currency))
	if body.Name == "" || body.Latitude == nil || body.Longitude == nil {
		return fmt.Errorf("name, latitude, and longitude are required")
	}
	if body.Category == "" {
		body.Category = "other"
	}
	validCategory := map[string]bool{"home": true, "building": true, "vehicle": true, "business": true, "land": true, "other": true}
	if !validCategory[body.Category] {
		return fmt.Errorf("invalid category")
	}
	if *body.Latitude < -90 || *body.Latitude > 90 || *body.Longitude < -180 || *body.Longitude > 180 {
		return fmt.Errorf("coordinates out of range")
	}
	if body.Currency == "" {
		body.Currency = "IDR"
	}
	if body.EstimatedValue != nil && *body.EstimatedValue < 0 {
		return fmt.Errorf("estimated_value must be non-negative")
	}
	if body.AlertRadiusKM == nil {
		value := 25.0
		body.AlertRadiusKM = &value
	}
	if *body.AlertRadiusKM <= 0 || *body.AlertRadiusKM > 5000 {
		return fmt.Errorf("alert_radius_km must be between 0 and 5000")
	}
	if len(body.Thresholds) == 0 || strings.TrimSpace(string(body.Thresholds)) == "{}" {
		body.Thresholds = json.RawMessage(`{
			"earthquake":{"min_magnitude":5.0},
			"flood":{"min_depth_cm":70},
			"volcano":{"min_activity_level":2},
			"wildfire":{"min_frp":100}
		}`)
	}
	if !json.Valid(body.Thresholds) {
		return fmt.Errorf("thresholds must be valid JSON")
	}
	return nil
}

func PersonalAssetsList(db *sql.DB, deploymentMode string, hostedLimit int) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		rows, err := db.QueryContext(c.Request.Context(),
			`SELECT `+personalAssetColumns+` FROM personal_assets WHERE auth_user_id=$1 ORDER BY created_at DESC`,
			AuthUserID(c))
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()
		assets := make([]PersonalAsset, 0)
		for rows.Next() {
			asset, scanErr := scanPersonalAsset(rows)
			if scanErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			assets = append(assets, asset)
		}
		limit := 0
		if strings.EqualFold(deploymentMode, "hosted") {
			limit = hostedLimit
		}
		c.JSON(http.StatusOK, gin.H{"data": assets, "meta": gin.H{"count": len(assets), "limit": limit}})
	}
}

func PersonalAssetCreate(db *sql.DB, deploymentMode string, hostedLimit int) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		var body personalAssetBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}
		if err := normalizePersonalAsset(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "validation_failed", "message": err.Error()})
			return
		}
		if strings.EqualFold(deploymentMode, "hosted") && hostedLimit > 0 {
			var count int
			if err := db.QueryRowContext(c.Request.Context(),
				`SELECT count(*) FROM personal_assets WHERE auth_user_id=$1`, AuthUserID(c)).Scan(&count); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "count_failed"})
				return
			}
			if count >= hostedLimit {
				c.JSON(http.StatusForbidden, gin.H{"error": "personal_asset_limit_reached"})
				return
			}
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "transaction_failed"})
			return
		}
		defer tx.Rollback()
		active := true
		if body.IsActive != nil {
			active = *body.IsActive
		}
		var asset PersonalAsset
		asset, err = scanPersonalAsset(tx.QueryRowContext(c.Request.Context(), `
INSERT INTO personal_assets
  (auth_user_id,name,category,address,latitude,longitude,estimated_value,currency,
   notes,peril_types,alert_radius_km,thresholds,is_active)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12::jsonb,$13)
RETURNING `+personalAssetColumns,
			AuthUserID(c), body.Name, body.Category, strings.TrimSpace(body.Address),
			body.Latitude, body.Longitude, body.EstimatedValue, body.Currency,
			strings.TrimSpace(body.Notes), toPGTextArray(body.PerilTypes),
			body.AlertRadiusKM, string(body.Thresholds), active))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insert_failed", "message": err.Error()})
			return
		}
		_, err = tx.ExecContext(c.Request.Context(), `
INSERT INTO ews_watch_zones
  (subscriber_id,label,latitude,longitude,radius_km,peril_types,thresholds,is_active,personal_asset_id)
VALUES ($1,$2,$3,$4,$5,$6::text[],$7::jsonb,$8,$9)`,
			subID, body.Name, body.Latitude, body.Longitude, body.AlertRadiusKM,
			toPGTextArray(body.PerilTypes), string(body.Thresholds), active, asset.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "watch_zone_failed", "message": err.Error()})
			return
		}
		if err = tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "commit_failed"})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": asset})
	}
}

func PersonalAssetUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		var body personalAssetBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}
		if err := normalizePersonalAsset(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "validation_failed", "message": err.Error()})
			return
		}
		active := true
		if body.IsActive != nil {
			active = *body.IsActive
		}
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "transaction_failed"})
			return
		}
		defer tx.Rollback()
		asset, err := scanPersonalAsset(tx.QueryRowContext(c.Request.Context(), `
UPDATE personal_assets SET name=$3,category=$4,address=$5,latitude=$6,longitude=$7,
 estimated_value=$8,currency=$9,notes=$10,peril_types=$11::text[],
 alert_radius_km=$12,thresholds=$13::jsonb,is_active=$14,updated_at=now()
WHERE id=$1 AND auth_user_id=$2
RETURNING `+personalAssetColumns,
			c.Param("id"), AuthUserID(c), body.Name, body.Category, strings.TrimSpace(body.Address),
			body.Latitude, body.Longitude, body.EstimatedValue, body.Currency,
			strings.TrimSpace(body.Notes), toPGTextArray(body.PerilTypes),
			body.AlertRadiusKM, string(body.Thresholds), active))
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "personal_asset_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "update_failed", "message": err.Error()})
			return
		}
		_, err = tx.ExecContext(c.Request.Context(), `
UPDATE ews_watch_zones SET label=$2,latitude=$3,longitude=$4,radius_km=$5,
 peril_types=$6::text[],thresholds=$7::jsonb,is_active=$8,updated_at=now()
WHERE personal_asset_id=$1`, asset.ID, body.Name, body.Latitude, body.Longitude,
			body.AlertRadiusKM, toPGTextArray(body.PerilTypes), string(body.Thresholds), active)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "watch_zone_sync_failed"})
			return
		}
		if err = tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "commit_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": asset})
	}
}

func PersonalAssetDelete(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		result, err := db.ExecContext(c.Request.Context(),
			`DELETE FROM personal_assets WHERE id=$1 AND auth_user_id=$2`, c.Param("id"), AuthUserID(c))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "delete_failed"})
			return
		}
		if count, _ := result.RowsAffected(); count == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "personal_asset_not_found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
	}
}

type personalRiskEvent struct {
	EventID    string  `json:"event_id"`
	EventType  string  `json:"event_type"`
	Place      string  `json:"place"`
	Magnitude  float64 `json:"magnitude"`
	DistanceKM float64 `json:"distance_km"`
	Score      float64 `json:"score"`
	Severity   string  `json:"severity"`
	EventTime  string  `json:"event_time"`
	Source     string  `json:"source"`
	HasAlert   bool    `json:"-"`
}

func PersonalAssetRisk(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		var lat, lon, radius float64
		var perils string
		err := db.QueryRowContext(c.Request.Context(), `
SELECT latitude,longitude,alert_radius_km,array_to_string(peril_types,',')
FROM personal_assets WHERE id=$1 AND auth_user_id=$2`,
			c.Param("id"), AuthUserID(c)).Scan(&lat, &lon, &radius, &perils)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "personal_asset_not_found"})
			return
		}
		minLat, maxLat, minLon, maxLon := boundingBox(lat, lon, radius)
		rows, err := db.QueryContext(c.Request.Context(), `
SELECT e.event_id,e.event_type,COALESCE(e.place,''),COALESCE(e.magnitude,0),
       COALESCE(e.severity,''),COALESCE(to_char(e.event_time,'YYYY-MM-DD"T"HH24:MI:SSOF'),''),
       e.source,COALESCE(rs.score,0),e.latitude,e.longitude,
       EXISTS(SELECT 1 FROM alerts a WHERE a.event_id=e.id AND a.acknowledged=FALSE)
FROM events e
LEFT JOIN LATERAL (
  SELECT score FROM risk_scores
  WHERE entity_type='event' AND entity_id=e.event_id
  ORDER BY calculated_at DESC LIMIT 1
) rs ON true
WHERE e.latitude BETWEEN $1 AND $2 AND e.longitude BETWEEN $3 AND $4
  AND e.event_time >= now()-interval '30 days'
ORDER BY e.event_time DESC LIMIT 200`, minLat, maxLat, minLon, maxLon)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()
		allowed := map[string]bool{}
		for _, peril := range parsePGTextArray(perils) {
			allowed[peril] = true
		}
		matches := make([]personalRiskEvent, 0)
		for rows.Next() {
			var item personalRiskEvent
			var eventLat, eventLon float64
			if err := rows.Scan(&item.EventID, &item.EventType, &item.Place, &item.Magnitude,
				&item.Severity, &item.EventTime, &item.Source, &item.Score,
				&eventLat, &eventLon, &item.HasAlert); err != nil {
				continue
			}
			if len(allowed) > 0 && !allowed[item.EventType] &&
				!(item.EventType == "wildfire" && allowed["fire"]) &&
				!(item.EventType == "fire" && allowed["wildfire"]) {
				continue
			}
			item.DistanceKM = haversineKm(lat, lon, eventLat, eventLon)
			if item.DistanceKM <= radius {
				matches = append(matches, item)
			}
		}
		sort.Slice(matches, func(i, j int) bool {
			if matches[i].Score == matches[j].Score {
				return matches[i].DistanceKM < matches[j].DistanceKM
			}
			return matches[i].Score > matches[j].Score
		})
		alertCount := 0
		for _, item := range matches {
			if item.HasAlert {
				alertCount++
			}
		}
		var nearest any
		if len(matches) > 0 {
			nearest = matches[0]
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"nearby_events": matches, "nearby_event_count": len(matches),
			"active_alert_count": alertCount, "top_event": nearest,
			"assessed_at": time.Now().UTC(), "radius_km": radius,
			"status_note": "Tidak ada kejadian terdeteksi bukan berarti lokasi dinyatakan aman.",
		}})
	}
}

type geocodingResult struct {
	Label     string  `json:"label"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type geocodingCacheEntry struct {
	results   []geocodingResult
	expiresAt time.Time
}

var geocodingState = struct {
	sync.Mutex
	lastRequest time.Time
	cache       map[string]geocodingCacheEntry
}{cache: make(map[string]geocodingCacheEntry)}

func GeocodingSearch(baseURL, userAgent string) gin.HandlerFunc {
	client := &http.Client{Timeout: 8 * time.Second}
	return func(c *gin.Context) {
		query := strings.TrimSpace(c.Query("q"))
		if len([]rune(query)) < 3 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "query_too_short"})
			return
		}
		cacheKey := strings.ToLower(query)
		geocodingState.Lock()
		if cached, ok := geocodingState.cache[cacheKey]; ok && cached.expiresAt.After(time.Now()) {
			geocodingState.Unlock()
			c.JSON(http.StatusOK, gin.H{"data": cached.results, "attribution": "© OpenStreetMap contributors", "cached": true})
			return
		}
		if elapsed := time.Since(geocodingState.lastRequest); elapsed < time.Second {
			geocodingState.Unlock()
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "geocoder_rate_limited", "retry_after_seconds": 1})
			return
		}
		geocodingState.lastRequest = time.Now()
		geocodingState.Unlock()
		endpoint := strings.TrimRight(baseURL, "/") + "/search"
		values := url.Values{
			"q": {query}, "format": {"jsonv2"}, "limit": {"5"},
			"countrycodes": {"id"}, "addressdetails": {"1"},
		}
		request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, endpoint+"?"+values.Encode(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "geocoder_request_failed"})
			return
		}
		request.Header.Set("User-Agent", userAgent)
		response, err := client.Do(request)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "geocoder_unavailable"})
			return
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			c.JSON(http.StatusBadGateway, gin.H{"error": "geocoder_upstream_error", "status": response.StatusCode})
			return
		}
		var upstream []struct {
			DisplayName string `json:"display_name"`
			Lat         string `json:"lat"`
			Lon         string `json:"lon"`
		}
		if err := json.NewDecoder(response.Body).Decode(&upstream); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "geocoder_invalid_response"})
			return
		}
		results := make([]geocodingResult, 0, len(upstream))
		for _, item := range upstream {
			latValue, latErr := strconv.ParseFloat(item.Lat, 64)
			lonValue, lonErr := strconv.ParseFloat(item.Lon, 64)
			if latErr == nil && lonErr == nil {
				results = append(results, geocodingResult{Label: item.DisplayName, Latitude: latValue, Longitude: lonValue})
			}
		}
		geocodingState.Lock()
		geocodingState.cache[cacheKey] = geocodingCacheEntry{results: results, expiresAt: time.Now().Add(24 * time.Hour)}
		geocodingState.Unlock()
		c.Header("Cache-Control", "private, max-age=3600")
		c.JSON(http.StatusOK, gin.H{"data": results, "attribution": "© OpenStreetMap contributors"})
	}
}
