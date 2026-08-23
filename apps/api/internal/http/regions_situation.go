package http

import (
	"database/sql"
	"math"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// Situasi Wilayah — agregasi bencana per wilayah besar Indonesia dari feed
// events live (72 jam–7 hari). Menjawab "bagaimana situasi di wilayah X?"
// tanpa menunggu warehouse historis terisi.
// ============================================================================

// RegionDefinition mendefinisikan wilayah besar dengan bbox kasar.
// Definisi statis di kode: cukup presisi utk agregasi situasional dan
// tidak memerlukan tabel boundaries (warehouse historis belum terisi).
type RegionDefinition struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	MinLon   float64 `json:"min_lon"`
	MinLat   float64 `json:"min_lat"`
	MaxLon   float64 `json:"max_lon"`
	MaxLat   float64 `json:"max_lat"`
	CenterLn float64 `json:"center_lon"`
	CenterLt float64 `json:"center_lat"`
}

// Peril Wilayah
type RegionPerilSituation struct {
	PerilType    string  `json:"peril_type"`
	Count72h     int     `json:"count_72h"`
	CountToday   int     `json:"count_today"`
	MaxMagnitude float64 `json:"max_magnitude"`
	LatestAt     string  `json:"latest_at"`
	FirstAt      string  `json:"first_at"`
}

// Prakiraan cuaca satu hari utk satu wilayah (Open-Meteo)
type RegionForecastDay struct {
	Date             string  `json:"date"`
	RainProbability  int     `json:"rain_probability"`
	RainSumMM        float64 `json:"rain_sum_mm"`
	WindMaxKmh       float64 `json:"wind_max_kmh"`
	WeatherLabel     string  `json:"weather_label"`
}

// Kartu situasi satu wilayah
type RegionSituation struct {
	Code          string                  `json:"code"`
	Name          string                  `json:"name"`
	BBox          [4]float64              `json:"bbox"`
	Center        [2]float64              `json:"center"`
	Perils        []RegionPerilSituation  `json:"perils"`
	NewsCount7d   int                     `json:"news_count_7d"`
	TopPlaces     []string                `json:"top_places"`
	SeverityIndex int                     `json:"severity_index"`
	TotalEvents   int                     `json:"total_events"`
	Forecast      []RegionForecastDay     `json:"forecast"`
	Daylight      *RegionDaylight         `json:"daylight,omitempty"`
}

// Jendela siang/malam wilayah hari ini (sunrise-sunset.org)
type RegionDaylight struct {
	Sunrise                 string  `json:"sunrise"`
	Sunset                  string  `json:"sunset"`
	DaylightRemainingHours float64 `json:"daylight_remaining_hours"`
	IsNight                 bool    `json:"is_night"`
}

type RegionSituationResponse struct {
	Regions     []RegionSituation `json:"regions"`
	GeneratedAt string            `json:"generated_at"`
	WindowHours int               `json:"window_hours"`
}

var regionDefinitions = []RegionDefinition{
	{Code: "sumatera", Name: "Sumatera", MinLon: 94.5, MinLat: -6.5, MaxLon: 108.5, MaxLat: 6.0, CenterLn: 101.5, CenterLt: -0.5},
	{Code: "jawa", Name: "Jawa", MinLon: 105.0, MinLat: -8.8, MaxLon: 115.0, MaxLat: -5.5, CenterLn: 110.0, CenterLt: -7.0},
	{Code: "kalimantan", Name: "Kalimantan", MinLon: 108.5, MinLat: -4.5, MaxLon: 119.5, MaxLat: 2.5, CenterLn: 114.0, CenterLt: -0.5},
	{Code: "sulawesi", Name: "Sulawesi", MinLon: 118.0, MinLat: -6.0, MaxLon: 125.5, MaxLat: 1.5, CenterLn: 121.5, CenterLt: -2.0},
	{Code: "bali-nusra", Name: "Bali & Nusa Tenggara Barat", MinLon: 114.5, MinLat: -9.0, MaxLon: 120.0, MaxLat: -7.5, CenterLn: 117.0, CenterLt: -8.3},
	{Code: "ntt", Name: "Nusa Tenggara Timur", MinLon: 118.0, MinLat: -11.5, MaxLon: 127.5, MaxLat: -8.0, CenterLn: 122.5, CenterLt: -9.7},
	{Code: "maluku", Name: "Maluku", MinLon: 124.5, MinLat: -8.5, MaxLon: 135.0, MaxLat: 1.0, CenterLn: 129.5, CenterLt: -3.5},
	{Code: "papua", Name: "Papua", MinLon: 130.5, MinLat: -9.0, MaxLon: 141.0, MaxLat: -0.5, CenterLn: 136.0, CenterLt: -4.5},
}

func regionCaseSQL() string {
	sql := "CASE"
	for _, r := range regionDefinitions {
		sql += " WHEN longitude >= " + ftoa(r.MinLon) + " AND longitude <= " + ftoa(r.MaxLon) +
			" AND latitude >= " + ftoa(r.MinLat) + " AND latitude <= " + ftoa(r.MaxLat) +
			" THEN '" + r.Code + "'"
	}
	return sql + " ELSE NULL END"
}

func ftoa(v float64) string {
	b, _ := json.Marshal(v)
	return string(b)
}

const regionDaylightQuery = `
SELECT sunrise, sunset
FROM region_daylight
WHERE region_code = $1 AND date = CURRENT_DATE
`

const regionForecastQuery = `
SELECT to_char(forecast_date, 'YYYY-MM-DD') AS d,
       COALESCE(rain_probability, 0),
       COALESCE(rain_sum_mm, 0),
       COALESCE(wind_max_kmh, 0),
       COALESCE(weather_label, '')
FROM weather_forecasts
WHERE region_code = $1 AND forecast_date >= CURRENT_DATE
ORDER BY forecast_date
LIMIT 3
`

const regionNewsQuery = `
SELECT count(*)
FROM news_items
WHERE published_at >= now() - interval '7 days'
  AND lat BETWEEN $2 AND $3
  AND lon BETWEEN $1 AND $4
`

// RegionsSituation mengembalikan agregasi bencana per wilayah besar.
// GET /api/v1/regions/situation
func RegionsSituation(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		status := http.StatusOK

		if db == nil {
			status = http.StatusServiceUnavailable
			c.JSON(status, gin.H{"error": "database_unavailable"})
			return
		}

		perilRows, err := db.QueryContext(c.Request.Context(), buildRegionPerilQuery())
		if err != nil {
			status = http.StatusServiceUnavailable
			c.JSON(status, gin.H{"error": "database_query_failed"})
			return
		}
		defer perilRows.Close()

		type perilKey struct{ region, peril string }
		perils := make(map[perilKey][]RegionPerilSituation)
		regionEventTotals := make(map[string]int)
		for perilRows.Next() {
			var region, peril string
			var count72, countToday int
			var maxMag float64
			var latest, first time.Time
			if err := perilRows.Scan(&region, &peril, &count72, &countToday, &maxMag, &latest, &first); err != nil {
				status = http.StatusInternalServerError
				c.JSON(status, gin.H{"error": "row_scan_failed"})
				return
			}
			perils[perilKey{region, peril}] = append(perils[perilKey{region, peril}], RegionPerilSituation{
				PerilType: peril, Count72h: count72, CountToday: countToday,
				MaxMagnitude: maxMag, LatestAt: latest.UTC().Format(time.RFC3339),
				FirstAt: first.UTC().Format(time.RFC3339),
			})
			regionEventTotals[region] += count72
		}
		if err := perilRows.Err(); err != nil {
			status = http.StatusInternalServerError
			c.JSON(status, gin.H{"error": "rows_iteration_failed"})
			return
		}

		placeRows, err := db.QueryContext(c.Request.Context(), buildRegionPlacesQuery())
		if err != nil {
			status = http.StatusServiceUnavailable
			c.JSON(status, gin.H{"error": "database_query_failed"})
			return
		}
		defer placeRows.Close()
		type placeEntry struct {
			name  string
			count int
		}
		places := make(map[string][]placeEntry)
		for placeRows.Next() {
			var region, place string
			var count int
			if err := placeRows.Scan(&region, &place, &count); err != nil {
				status = http.StatusInternalServerError
				c.JSON(status, gin.H{"error": "row_scan_failed"})
				return
			}
			places[region] = append(places[region], placeEntry{place, count})
		}

		// severity: normalisasi jumlah event vs total nasional (0-70)
		// + bonus magnitudo besar (maks 30) — transparan & sederhana.
		nationalTotal := 0
		for _, t := range regionEventTotals {
			nationalTotal += t
		}

		regions := make([]RegionSituation, 0, len(regionDefinitions))
		for _, def := range regionDefinitions {
			situation := RegionSituation{
				Code:   def.Code,
				Name:   def.Name,
				BBox:   [4]float64{def.MinLon, def.MinLat, def.MaxLon, def.MaxLat},
				Center: [2]float64{def.CenterLn, def.CenterLt},
			}

			for pk, list := range perils {
				if pk.region == def.Code {
					situation.Perils = append(situation.Perils, list...)
				}
			}
			if len(situation.Perils) == 0 {
				situation.Perils = []RegionPerilSituation{}
			}

			var newsCount int
			_ = db.QueryRowContext(c.Request.Context(), regionNewsQuery,
				def.MinLon, def.MinLat, def.MaxLat, def.MaxLon).Scan(&newsCount)
			situation.NewsCount7d = newsCount

			forecast := []RegionForecastDay{}
			fRows, fErr := db.QueryContext(c.Request.Context(), regionForecastQuery, def.Code)
			if fErr == nil {
				for fRows.Next() {
					var fd RegionForecastDay
					if err := fRows.Scan(&fd.Date, &fd.RainProbability, &fd.RainSumMM, &fd.WindMaxKmh, &fd.WeatherLabel); err == nil {
						forecast = append(forecast, fd)
					}
				}
				fRows.Close()
			}
			situation.Forecast = forecast

			// Daylight: jendela siang hari ini + sisa jam siang real-time.
			var sunriseStr, sunsetStr string
			if err := db.QueryRowContext(c.Request.Context(), regionDaylightQuery, def.Code).Scan(&sunriseStr, &sunsetStr); err == nil {
				now := time.Now()
				sunrise, e1 := time.Parse("15:04:05", sunriseStr)
				sunset, e2 := time.Parse("15:04:05", sunsetStr)
				if e1 == nil && e2 == nil {
					today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
					sunriseAt := today.Add(time.Duration(sunrise.Hour())*time.Hour + time.Duration(sunrise.Minute())*time.Minute)
					sunsetAt := today.Add(time.Duration(sunset.Hour())*time.Hour + time.Duration(sunset.Minute())*time.Minute)
					remaining := sunsetAt.Sub(now).Hours()
					isNight := now.Before(sunriseAt) || now.After(sunsetAt)
					if isNight {
						remaining = 0
					}
					if remaining < 0 {
						remaining = 0
					}
					situation.Daylight = &RegionDaylight{
						Sunrise:                 sunriseStr,
						Sunset:                  sunsetStr,
						DaylightRemainingHours: math.Round(remaining*10) / 10,
						IsNight:                 isNight,
					}
				}
			}

			if entries, ok := places[def.Code]; ok {
				for i, e := range entries {
					if i >= 4 {
						break
					}
					situation.TopPlaces = append(situation.TopPlaces, e.name)
				}
			}
			if situation.TopPlaces == nil {
				situation.TopPlaces = []string{}
			}

			total := regionEventTotals[def.Code]
			situation.TotalEvents = total
			share := 0.0
			if nationalTotal > 0 {
				share = float64(total) / float64(nationalTotal)
			}
			severity := int(share * 70.0)
			for _, p := range situation.Perils {
				if p.MaxMagnitude >= 6.0 {
					severity += 30
					break
				} else if p.MaxMagnitude >= 5.0 {
					severity += 15
					break
				}
			}
			if severity > 100 {
				severity = 100
			}
			situation.SeverityIndex = severity

			regions = append(regions, situation)
		}

		c.JSON(status, RegionSituationResponse{
			Regions:     regions,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
			WindowHours: 72,
		})
	}
}

func buildRegionPerilQuery() string {
	caseSQL := regionCaseSQL()
	return `
WITH tagged AS (
  SELECT ` + caseSQL + ` AS region, event_type, magnitude, event_time, place
  FROM events
  WHERE event_time >= now() - interval '72 hours'
    AND latitude IS NOT NULL AND longitude IS NOT NULL
)
SELECT region, event_type,
       count(*),
       count(*) FILTER (WHERE event_time >= date_trunc('day', now())),
       COALESCE(max(magnitude), 0),
       max(event_time), min(event_time)
FROM tagged
WHERE region IS NOT NULL
GROUP BY region, event_type
ORDER BY region, count(*) DESC
`
}

func buildRegionPlacesQuery() string {
	caseSQL := regionCaseSQL()
	return `
WITH tagged AS (
  SELECT ` + caseSQL + ` AS region,
         COALESCE(NULLIF(split_part(place, ',', 1), ''), place) AS place_key
  FROM events
  WHERE event_time >= now() - interval '72 hours'
    AND latitude IS NOT NULL AND longitude IS NOT NULL
)
SELECT region, place_key, count(*)
FROM tagged
WHERE region IS NOT NULL AND place_key IS NOT NULL AND length(trim(place_key)) > 2
GROUP BY region, place_key
ORDER BY region, count(*) DESC
`
}
