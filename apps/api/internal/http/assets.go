package http

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Vessel mirrors a row of vessel_positions.
type Vessel struct {
	MMSI      string     `json:"mmsi"`
	Name      *string    `json:"name"`
	ShipType  *string    `json:"ship_type"`
	Latitude  float64    `json:"latitude"`
	Longitude float64    `json:"longitude"`
	SOG       *float64   `json:"sog"`
	COG       *float64   `json:"cog"`
	Heading   *float64   `json:"heading"`
	Timestamp time.Time  `json:"timestamp"`
	Source    string     `json:"source"`
}

// Aircraft mirrors a row of aircraft_positions.
type Aircraft struct {
	ICAO24         string    `json:"icao24"`
	Callsign       *string   `json:"callsign"`
	OriginCountry  string    `json:"origin_country"`
	Latitude       float64   `json:"latitude"`
	Longitude      float64   `json:"longitude"`
	Altitude       *float64  `json:"altitude"`
	Velocity       *float64  `json:"velocity"`
	Heading        *float64  `json:"heading"`
	OnGround       bool      `json:"on_ground"`
	Timestamp      time.Time `json:"timestamp"`
}

const vesselsQuery = `
SELECT mmsi, name, ship_type, latitude, longitude,
       sog, cog, heading, timestamp, source
FROM vessel_positions
ORDER BY timestamp DESC
LIMIT 500
`

const aircraftQuery = `
SELECT icao24, callsign, origin_country, latitude, longitude,
       altitude, velocity, heading, on_ground, timestamp
FROM aircraft_positions
ORDER BY timestamp DESC
LIMIT 500
`

// AssetsMarine returns latest vessel positions.
func AssetsMarine(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), vesselsQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		vessels := make([]Vessel, 0, 100)
		for rows.Next() {
			var v Vessel
			if err := rows.Scan(
				&v.MMSI, &v.Name, &v.ShipType,
				&v.Latitude, &v.Longitude,
				&v.SOG, &v.COG, &v.Heading,
				&v.Timestamp, &v.Source,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			vessels = append(vessels, v)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": vessels,
			"meta": gin.H{"count": len(vessels)},
		})
	}
}

// AssetsAviation returns latest aircraft positions.
func AssetsAviation(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), aircraftQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		aircraft := make([]Aircraft, 0, 100)
		for rows.Next() {
			var a Aircraft
			if err := rows.Scan(
				&a.ICAO24, &a.Callsign, &a.OriginCountry,
				&a.Latitude, &a.Longitude,
				&a.Altitude, &a.Velocity, &a.Heading,
				&a.OnGround, &a.Timestamp,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			aircraft = append(aircraft, a)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": aircraft,
			"meta": gin.H{"count": len(aircraft)},
		})
	}
}
