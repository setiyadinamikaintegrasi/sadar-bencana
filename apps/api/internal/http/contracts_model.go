package http

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// Contract mirrors a row of acceptance_contracts.
type Contract struct {
	ID             string  `json:"id"`
	ContractNo     string  `json:"contract_no"`
	CedantName     string  `json:"cedant_name"`
	ObjectName     string  `json:"object_name"`
	ObjectAddress  string  `json:"object_address"`
	Peril          string  `json:"peril"`
	TreatyType     string  `json:"treaty_type"`
	Occupancy      string  `json:"occupancy"`
	Latitude       float64 `json:"latitude"`
	Longitude      float64 `json:"longitude"`
	Currency       string  `json:"currency"`
	SumInsured     float64 `json:"sum_insured"`
	SharePct       float64 `json:"share_pct"`
	ShareAmount    float64 `json:"share_amount"`
	Premium        float64 `json:"premium"`
	ClaimAmount    float64 `json:"claim_amount"`
	InceptionDate  string  `json:"inception_date"` // YYYY-MM-DD or ""
	ExpiryDate     string  `json:"expiry_date"`    // YYYY-MM-DD or ""
	CreatedAt      string  `json:"created_at,omitempty"`
	UpdatedAt      string  `json:"updated_at,omitempty"`
	DistanceKm     float64 `json:"distance_km,omitempty"`
}

var validPerils = map[string]bool{
	"earthquake": true, "flood": true, "volcano": true,
	"fire": true, "windstorm": true, "other": true,
}
var validTreatyTypes = map[string]bool{"facultative": true, "treaty": true}

// contractCSVHeader is the canonical import column order.
var contractCSVHeader = []string{
	"contract_no", "cedant_name", "object_name", "object_address", "peril", "treaty_type",
	"occupancy", "latitude", "longitude", "currency", "sum_insured", "share_pct",
	"share_amount", "premium", "claim_amount", "inception_date", "expiry_date",
}

// normalizeAndValidate fills defaults, derives ShareAmount when zero, and validates.
func (c *Contract) normalizeAndValidate() error {
	c.ContractNo = strings.TrimSpace(c.ContractNo)
	c.Peril = strings.ToLower(strings.TrimSpace(c.Peril))
	c.TreatyType = strings.ToLower(strings.TrimSpace(c.TreatyType))
	if c.Currency == "" {
		c.Currency = "IDR"
	}
	if c.Peril == "" {
		c.Peril = "other"
	}
	if c.TreatyType == "" {
		c.TreatyType = "facultative"
	}
	if c.ContractNo == "" {
		return fmt.Errorf("contract_no is required")
	}
	if !validPerils[c.Peril] {
		return fmt.Errorf("invalid peril %q", c.Peril)
	}
	if !validTreatyTypes[c.TreatyType] {
		return fmt.Errorf("invalid treaty_type %q", c.TreatyType)
	}
	if c.Latitude < -90 || c.Latitude > 90 {
		return fmt.Errorf("latitude out of range: %v", c.Latitude)
	}
	if c.Longitude < -180 || c.Longitude > 180 {
		return fmt.Errorf("longitude out of range: %v", c.Longitude)
	}
	if c.SharePct < 0 || c.SharePct > 100 {
		return fmt.Errorf("share_pct must be 0..100, got %v", c.SharePct)
	}
	for name, v := range map[string]float64{
		"sum_insured": c.SumInsured, "premium": c.Premium, "claim_amount": c.ClaimAmount,
	} {
		if v < 0 {
			return fmt.Errorf("%s must be >= 0", name)
		}
	}
	if c.InceptionDate != "" {
		if _, err := time.Parse("2006-01-02", c.InceptionDate); err != nil {
			return fmt.Errorf("invalid inception_date (want YYYY-MM-DD): %v", err)
		}
	}
	if c.ExpiryDate != "" {
		if _, err := time.Parse("2006-01-02", c.ExpiryDate); err != nil {
			return fmt.Errorf("invalid expiry_date (want YYYY-MM-DD): %v", err)
		}
	}
	if c.ShareAmount == 0 && c.SumInsured > 0 && c.SharePct > 0 {
		c.ShareAmount = c.SumInsured * c.SharePct / 100
	}
	if c.ShareAmount < 0 {
		return fmt.Errorf("share_amount must be >= 0")
	}
	return nil
}

// csvRowError reports the 1-based data row (excluding header) that failed.
type csvRowError struct {
	Row     int
	Message string
}

func (e *csvRowError) Error() string {
	return fmt.Sprintf("row %d: %s", e.Row, e.Message)
}

// parseContractsCSV reads a strict-header CSV and returns validated contracts.
func parseContractsCSV(r io.Reader) ([]Contract, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = len(contractCSVHeader)
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("cannot read header: %w", err)
	}
	for i, h := range contractCSVHeader {
		if i >= len(header) || strings.TrimSpace(strings.ToLower(header[i])) != h {
			return nil, fmt.Errorf("unexpected header: column %d must be %q", i+1, h)
		}
	}

	var out []Contract
	row := 0
	for {
		rec, err := reader.Read()
		if err == io.EOF {
			break
		}
		row++
		if err != nil {
			return nil, &csvRowError{Row: row, Message: err.Error()}
		}
		c := Contract{
			ContractNo: rec[0], CedantName: rec[1], ObjectName: rec[2], ObjectAddress: rec[3],
			Peril: rec[4], TreatyType: rec[5], Occupancy: rec[6], Currency: rec[9],
			InceptionDate: strings.TrimSpace(rec[15]), ExpiryDate: strings.TrimSpace(rec[16]),
		}
		floats := []struct {
			idx int
			dst *float64
		}{
			{7, &c.Latitude}, {8, &c.Longitude}, {10, &c.SumInsured}, {11, &c.SharePct},
			{12, &c.ShareAmount}, {13, &c.Premium}, {14, &c.ClaimAmount},
		}
		for _, f := range floats {
			s := strings.TrimSpace(rec[f.idx])
			if s == "" {
				continue
			}
			v, perr := strconv.ParseFloat(s, 64)
			if perr != nil {
				return nil, &csvRowError{Row: row, Message: fmt.Sprintf("column %q is not a number: %q", contractCSVHeader[f.idx], rec[f.idx])}
			}
			*f.dst = v
		}
		if verr := c.normalizeAndValidate(); verr != nil {
			return nil, &csvRowError{Row: row, Message: verr.Error()}
		}
		out = append(out, c)
	}
	return out, nil
}
