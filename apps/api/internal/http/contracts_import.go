package http

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ContractsImportTemplate returns a CSV with the canonical header and one sample row.
func ContractsImportTemplate() gin.HandlerFunc {
	return func(c *gin.Context) {
		sample := "FAC-2026-9999,PT Contoh Asuransi,Gedung Contoh,Jl. Contoh Jakarta,earthquake,facultative,office_highrise,-6.2088,106.8210,IDR,1000000000,15,150000000,2000000,0,2026-01-01,2026-12-31"
		body := strings.Join(contractCSVHeader, ",") + "\n" + sample + "\n"
		c.Header("Content-Disposition", "attachment; filename=acceptance_contracts_template.csv")
		c.Data(http.StatusOK, "text/csv; charset=utf-8", []byte(body))
	}
}

// ContractsImport ingests a CSV in a single all-or-nothing transaction.
func ContractsImport(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable", "message": "the database is not configured"})
			return
		}
		fileHeader, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing_file", "message": "multipart field 'file' is required"})
			return
		}
		f, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot_open_file", "message": err.Error()})
			return
		}
		defer f.Close()

		contracts, perr := parseContractsCSV(f)
		if perr != nil {
			var rowErr *csvRowError
			if e, ok := perr.(*csvRowError); ok {
				rowErr = e
			}
			resp := gin.H{"error": "parse_failed", "message": perr.Error()}
			if rowErr != nil {
				resp["errors"] = []gin.H{{"row": rowErr.Row, "message": rowErr.Message}}
			}
			c.JSON(http.StatusBadRequest, resp)
			return
		}

		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tx_begin_failed", "message": err.Error()})
			return
		}
		stmt, err := tx.PrepareContext(c.Request.Context(), contractInsertSQL)
		if err != nil {
			_ = tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "prepare_failed", "message": err.Error()})
			return
		}
		defer stmt.Close()

		inserted := 0
		for i, ct := range contracts {
			if _, err := stmt.ExecContext(c.Request.Context(),
				ct.ContractNo, ct.CedantName, ct.ObjectName, ct.ObjectAddress, ct.Peril, ct.TreatyType,
				ct.Occupancy, ct.Latitude, ct.Longitude, ct.Currency, ct.SumInsured, ct.SharePct,
				ct.ShareAmount, ct.Premium, ct.ClaimAmount, nullableDate(ct.InceptionDate), nullableDate(ct.ExpiryDate)); err != nil {
				_ = tx.Rollback()
				c.JSON(http.StatusBadRequest, gin.H{
					"error":    "import_failed",
					"message":  "transaction rolled back; no rows inserted",
					"inserted": 0,
					"failed":   len(contracts),
					"errors":   []gin.H{{"row": i + 1, "message": err.Error()}},
				})
				return
			}
			inserted++
		}
		if err := tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "commit_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"inserted": inserted, "failed": 0, "errors": []gin.H{}}})
	}
}
