package http

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

var evacuationCSVHeader = []string{"name", "location_type", "latitude", "longitude",
	"address", "capacity", "phone", "person_in_charge", "facilities", "operating_hours"}

// parseEvacuationCSV membaca CSV admin dan memvalidasi tiap baris.
// Error menyebut nomor baris (header = baris 1).
func parseEvacuationCSV(r io.Reader) ([]evacuationLocationInput, error) {
	reader := csv.NewReader(r)
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("gagal membaca header: %w", err)
	}
	if len(header) != len(evacuationCSVHeader) {
		return nil, fmt.Errorf("header harus: %s", strings.Join(evacuationCSVHeader, ","))
	}
	for i, col := range evacuationCSVHeader {
		if strings.TrimSpace(strings.ToLower(header[i])) != col {
			return nil, fmt.Errorf("kolom %d harus %q", i+1, col)
		}
	}
	var rows []evacuationLocationInput
	for line := 2; ; line++ {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("baris %d: %w", line, err)
		}
		in := evacuationLocationInput{
			Name: strings.TrimSpace(record[0]), LocationType: strings.TrimSpace(record[1]),
			Address: strings.TrimSpace(record[4]), Phone: strings.TrimSpace(record[6]),
			PersonInCharge: strings.TrimSpace(record[7]),
			OperatingHours: strings.TrimSpace(record[9]),
		}
		if in.Latitude, err = strconv.ParseFloat(strings.TrimSpace(record[2]), 64); err != nil {
			return nil, fmt.Errorf("baris %d: latitude bukan angka", line)
		}
		if in.Longitude, err = strconv.ParseFloat(strings.TrimSpace(record[3]), 64); err != nil {
			return nil, fmt.Errorf("baris %d: longitude bukan angka", line)
		}
		if raw := strings.TrimSpace(record[5]); raw != "" {
			capValue, err := strconv.Atoi(raw)
			if err != nil {
				return nil, fmt.Errorf("baris %d: capacity bukan angka", line)
			}
			in.Capacity = &capValue
		}
		if raw := strings.TrimSpace(record[8]); raw != "" {
			for _, f := range strings.Split(raw, ";") {
				if f = strings.TrimSpace(f); f != "" {
					in.Facilities = append(in.Facilities, f)
				}
			}
		}
		if err := validateEvacuationLocationInput(&in); err != nil {
			return nil, fmt.Errorf("baris %d: %s", line, err.Error())
		}
		rows = append(rows, in)
	}
	return rows, nil
}

// EvacuationImportTemplate mengembalikan template CSV statis (publik, pola
// sama dengan contracts/import/template).
func EvacuationImportTemplate() gin.HandlerFunc {
	return func(c *gin.Context) {
		sample := "Titik Kumpul Alun-Alun,titik_kumpul,-6.9147,107.6098,Jl. Asia Afrika Bandung,500,0227654321,Pak Budi,toilet;air bersih,24 jam"
		body := strings.Join(evacuationCSVHeader, ",") + "\n" + sample + "\n"
		c.Header("Content-Disposition", "attachment; filename=evacuation_locations_template.csv")
		c.Data(http.StatusOK, "text/csv; charset=utf-8", []byte(body))
	}
}

// EvacuationImport memasukkan CSV dalam satu transaksi all-or-nothing.
func EvacuationImport(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		fileHeader, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing_file", "message": "field multipart 'file' wajib ada"})
			return
		}
		f, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot_open_file", "message": err.Error()})
			return
		}
		defer f.Close()
		rows, err := parseEvacuationCSV(f)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "parse_failed", "message": err.Error()})
			return
		}
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "tx_begin_failed"})
			return
		}
		stmt, err := tx.PrepareContext(c.Request.Context(), `
INSERT INTO evacuation_locations
  (name, location_type, source_type, latitude, longitude, address, capacity,
   phone, person_in_charge, facilities, operating_hours, created_by)
VALUES ($1,$2,'manual',$3,$4,$5,$6,$7,$8,$9::text[],$10,$11)`)
		if err != nil {
			_ = tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "prepare_failed"})
			return
		}
		defer stmt.Close()
		for i, in := range rows {
			if _, err := stmt.ExecContext(c.Request.Context(),
				in.Name, in.LocationType, in.Latitude, in.Longitude, in.Address,
				in.Capacity, in.Phone, in.PersonInCharge, toPGTextArray(in.Facilities),
				in.OperatingHours, AuthUserID(c)); err != nil {
				_ = tx.Rollback()
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "import_failed", "inserted": 0,
					"message": "transaksi dibatalkan; tidak ada baris masuk",
					"errors":  []gin.H{{"row": i + 2, "message": err.Error()}},
				})
				return
			}
		}
		if err := tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "commit_failed"})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": gin.H{"inserted": len(rows)}})
	}
}
