package http

import (
	"database/sql"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func Accumulation(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
		lon, errLon := strconv.ParseFloat(c.Query("lon"), 64)
		radius, errR := strconv.ParseFloat(c.Query("radius_km"), 64)
		if errLat != nil || errLon != nil || errR != nil || radius <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_params", "message": "lat, lon, and positive radius_km are required"})
			return
		}
		peril := strings.ToLower(strings.TrimSpace(c.Query("peril")))
		activeOn := strings.TrimSpace(c.Query("active_on"))

		minLat, maxLat, minLon, maxLon := boundingBox(lat, lon, radius)

		// Bounding-box prefilter (index-friendly) + optional filters; precise
		// haversine is applied in Go over the small candidate set.
		where := []string{"latitude BETWEEN $1 AND $2", "longitude BETWEEN $3 AND $4"}
		args := []any{minLat, maxLat, minLon, maxLon}
		if peril != "" {
			args = append(args, peril)
			where = append(where, "peril = $"+strconv.Itoa(len(args)))
		}
		if activeOn != "" {
			args = append(args, activeOn)
			n := strconv.Itoa(len(args))
			where = append(where, "(inception_date IS NULL OR inception_date <= $"+n+")")
			where = append(where, "(expiry_date IS NULL OR expiry_date >= $"+n+")")
		}
		query := "SELECT " + contractColumns + " FROM acceptance_contracts WHERE " + strings.Join(where, " AND ")

		rows, err := db.QueryContext(c.Request.Context(), query, args...)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()

		var affected []Contract
		var sumInsured, shareAmount, premium, claim float64
		byPeril := map[string]struct {
			share float64
			count int
		}{}
		for rows.Next() {
			ct, err := scanContract(rows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			d := haversineKm(lat, lon, ct.Latitude, ct.Longitude)
			if d > radius {
				continue
			}
			ct.DistanceKm = d
			affected = append(affected, ct)
			sumInsured += ct.SumInsured
			shareAmount += ct.ShareAmount
			premium += ct.Premium
			claim += ct.ClaimAmount
			agg := byPeril[ct.Peril]
			agg.share += ct.ShareAmount
			agg.count++
			byPeril[ct.Peril] = agg
		}

		sort.Slice(affected, func(i, j int) bool { return affected[i].ShareAmount > affected[j].ShareAmount })
		if len(affected) > 500 {
			affected = affected[:500]
		}
		perilList := make([]gin.H, 0, len(byPeril))
		for p, v := range byPeril {
			perilList = append(perilList, gin.H{"peril": p, "share_amount": v.share, "count": v.count})
		}
		sort.Slice(perilList, func(i, j int) bool {
			return perilList[i]["share_amount"].(float64) > perilList[j]["share_amount"].(float64)
		})

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"summary": gin.H{
				"sum_insured": sumInsured, "share_amount": shareAmount,
				"premium": premium, "claim_amount": claim, "count": len(affected),
			},
			"by_peril":  perilList,
			"contracts": affected,
			"params": gin.H{
				"lat": lat, "lon": lon, "radius_km": radius, "peril": peril, "active_on": activeOn,
			},
		}})
	}
}
