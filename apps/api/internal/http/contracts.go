package http

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

const contractColumns = `id, contract_no, cedant_name, object_name, object_address, peril,
	treaty_type, occupancy, latitude, longitude, currency, sum_insured, share_pct,
	share_amount, premium, claim_amount,
	COALESCE(to_char(inception_date,'YYYY-MM-DD'),''),
	COALESCE(to_char(expiry_date,'YYYY-MM-DD'),''),
	to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF'),
	to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SSOF')`

type rowScanner interface{ Scan(...any) error }

func scanContract(s rowScanner) (Contract, error) {
	var c Contract
	err := s.Scan(&c.ID, &c.ContractNo, &c.CedantName, &c.ObjectName, &c.ObjectAddress,
		&c.Peril, &c.TreatyType, &c.Occupancy, &c.Latitude, &c.Longitude, &c.Currency,
		&c.SumInsured, &c.SharePct, &c.ShareAmount, &c.Premium, &c.ClaimAmount,
		&c.InceptionDate, &c.ExpiryDate, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

// nullableDate converts "" to a NULL-compatible arg, else the date string.
func nullableDate(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// countUserRisks mengembalikan jumlah risiko milik user. err non-nil = kegagalan DB.
func countUserRisks(c *gin.Context, db *sql.DB, authUserID string) (int, error) {
	var n int
	err := db.QueryRowContext(c.Request.Context(),
		"SELECT count(*) FROM risk_entries WHERE auth_user_id = $1", authUserID).Scan(&n)
	return n, err
}

func ContractsList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		var where []string
		var args []any
		add := func(clause string, val any) {
			args = append(args, val)
			where = append(where, strings.Replace(clause, "$$", "$"+strconv.Itoa(len(args)), 1))
		}
		// Privasi: hanya risiko milik user yang login.
		add("auth_user_id = $$", AuthUserID(c))
		if v := strings.TrimSpace(c.Query("peril")); v != "" {
			add("peril = $$", v)
		}
		if v := strings.TrimSpace(c.Query("treaty_type")); v != "" {
			add("treaty_type = $$", v)
		}
		if v := strings.TrimSpace(c.Query("cedant")); v != "" {
			add("cedant_name ILIKE '%'||$$||'%'", v)
		}
		if v := strings.TrimSpace(c.Query("q")); v != "" {
			args = append(args, v)
			n := strconv.Itoa(len(args))
			where = append(where, "(contract_no ILIKE '%'||$"+n+"||'%' OR object_name ILIKE '%'||$"+n+"||'%')")
		}
		if v := strings.TrimSpace(c.Query("active_on")); v != "" {
			add("(inception_date IS NULL OR inception_date <= $$)", v)
			add("(expiry_date IS NULL OR expiry_date >= $$)", v)
		}
		if v := strings.TrimSpace(c.Query("bbox")); v != "" {
			// bbox = minLon,minLat,maxLon,maxLat
			parts := strings.Split(v, ",")
			if len(parts) == 4 {
				f := func(s string) float64 { x, _ := strconv.ParseFloat(strings.TrimSpace(s), 64); return x }
				add("longitude >= $$", f(parts[0]))
				add("latitude  >= $$", f(parts[1]))
				add("longitude <= $$", f(parts[2]))
				add("latitude  <= $$", f(parts[3]))
			}
		}
		limit := 200
		if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 2000 {
			limit = v
		}
		offset := 0
		if v, err := strconv.Atoi(c.Query("offset")); err == nil && v >= 0 {
			offset = v
		}
		query := "SELECT " + contractColumns + " FROM risk_entries"
		if len(where) > 0 {
			query += " WHERE " + strings.Join(where, " AND ")
		}
		args = append(args, limit, offset)
		query += " ORDER BY share_amount DESC LIMIT $" + strconv.Itoa(len(args)-1) + " OFFSET $" + strconv.Itoa(len(args))

		rows, err := db.QueryContext(c.Request.Context(), query, args...)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()
		list := make([]Contract, 0, limit)
		for rows.Next() {
			ct, err := scanContract(rows)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			list = append(list, ct)
		}
		c.JSON(http.StatusOK, gin.H{"data": list, "meta": gin.H{"count": len(list)}})
	}
}

func ContractGet(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		row := db.QueryRowContext(c.Request.Context(),
			"SELECT "+contractColumns+" FROM risk_entries WHERE id = $1 AND auth_user_id = $2",
			c.Param("id"), AuthUserID(c))
		ct, err := scanContract(row)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "contract not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": ct})
	}
}

const contractInsertSQL = `
INSERT INTO risk_entries
  (contract_no, cedant_name, object_name, object_address, peril, treaty_type, occupancy,
   latitude, longitude, currency, sum_insured, share_pct, share_amount, premium, claim_amount,
   inception_date, expiry_date, auth_user_id)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
RETURNING ` + contractColumns

func ContractCreate(db *sql.DB, riskLimit int) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		var in Contract
		if err := c.ShouldBindJSON(&in); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		if err := in.normalizeAndValidate(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "validation_failed", "message": err.Error()})
			return
		}
		if riskLimit > 0 {
			n, err := countUserRisks(c, db, AuthUserID(c))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "count_failed", "message": err.Error()})
				return
			}
			if n >= riskLimit {
				c.JSON(http.StatusForbidden, gin.H{
					"error":   "risk_limit_reached",
					"message": "batas risiko gratis tercapai; jalankan versi self-hosted untuk jumlah tanpa batas",
				})
				return
			}
		}
		row := db.QueryRowContext(c.Request.Context(), contractInsertSQL,
			in.ContractNo, in.CedantName, in.ObjectName, in.ObjectAddress, in.Peril, in.TreatyType,
			in.Occupancy, in.Latitude, in.Longitude, in.Currency, in.SumInsured, in.SharePct,
			in.ShareAmount, in.Premium, in.ClaimAmount, nullableDate(in.InceptionDate), nullableDate(in.ExpiryDate),
			AuthUserID(c))
		ct, err := scanContract(row)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insert_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": ct})
	}
}

const contractUpdateSQL = `
UPDATE risk_entries SET
  contract_no=$1, cedant_name=$2, object_name=$3, object_address=$4, peril=$5, treaty_type=$6,
  occupancy=$7, latitude=$8, longitude=$9, currency=$10, sum_insured=$11, share_pct=$12,
  share_amount=$13, premium=$14, claim_amount=$15, inception_date=$16, expiry_date=$17, updated_at=now()
WHERE id=$18 AND auth_user_id=$19
RETURNING ` + contractColumns

func ContractUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		var in Contract
		if err := c.ShouldBindJSON(&in); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		if err := in.normalizeAndValidate(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "validation_failed", "message": err.Error()})
			return
		}
		row := db.QueryRowContext(c.Request.Context(), contractUpdateSQL,
			in.ContractNo, in.CedantName, in.ObjectName, in.ObjectAddress, in.Peril, in.TreatyType,
			in.Occupancy, in.Latitude, in.Longitude, in.Currency, in.SumInsured, in.SharePct,
			in.ShareAmount, in.Premium, in.ClaimAmount, nullableDate(in.InceptionDate), nullableDate(in.ExpiryDate),
			c.Param("id"), AuthUserID(c))
		ct, err := scanContract(row)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "contract not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "update_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": ct})
	}
}

func ContractDelete(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		res, err := db.ExecContext(c.Request.Context(),
			"DELETE FROM risk_entries WHERE id=$1 AND auth_user_id=$2",
			c.Param("id"), AuthUserID(c))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "delete_failed", "message": err.Error()})
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "contract not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
	}
}
