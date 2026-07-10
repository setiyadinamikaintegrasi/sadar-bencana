package http

import (
	"errors"
	"strings"
)

// EvacuationLocation adalah representasi API satu lokasi evakuasi.
type EvacuationLocation struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	LocationType   string   `json:"location_type"`
	SourceType     string   `json:"source_type"`
	Latitude       float64  `json:"latitude"`
	Longitude      float64  `json:"longitude"`
	Address        string   `json:"address"`
	PhotoURL       string   `json:"photo_url"`
	Capacity       *int     `json:"capacity"`
	IsOpen         *bool    `json:"is_open"`
	IsFull         *bool    `json:"is_full"`
	Phone          string   `json:"phone"`
	PersonInCharge string   `json:"person_in_charge"`
	Facilities     []string `json:"facilities"`
	OperatingHours string   `json:"operating_hours"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
}

const evacuationLocationColumns = `id, name, location_type, source_type,
	latitude, longitude, address, COALESCE(photo_url,''),
	capacity, is_open, is_full, phone, person_in_charge,
	array_to_string(facilities, ','), operating_hours,
	to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF'),
	to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SSOF')`

func scanEvacuationLocation(scanner interface{ Scan(...any) error }) (EvacuationLocation, error) {
	var loc EvacuationLocation
	var facilities string
	err := scanner.Scan(&loc.ID, &loc.Name, &loc.LocationType, &loc.SourceType,
		&loc.Latitude, &loc.Longitude, &loc.Address, &loc.PhotoURL,
		&loc.Capacity, &loc.IsOpen, &loc.IsFull, &loc.Phone, &loc.PersonInCharge,
		&facilities, &loc.OperatingHours, &loc.CreatedAt, &loc.UpdatedAt)
	loc.Facilities = parsePGTextArray(facilities)
	return loc, err
}

var validEvacuationLocationTypes = map[string]bool{
	"shelter": true, "tes": true, "tea": true, "posko_bnpb_bpbd": true,
	"rumah_sakit": true, "puskesmas": true, "kantor_polisi": true,
	"damkar": true, "titik_kumpul": true, "pos_sar": true,
	"gudang_logistik": true,
}

// evacuationLocationInput adalah body create/update dari admin.
type evacuationLocationInput struct {
	Name           string   `json:"name"`
	LocationType   string   `json:"location_type"`
	Latitude       float64  `json:"latitude"`
	Longitude      float64  `json:"longitude"`
	Address        string   `json:"address"`
	PhotoURL       string   `json:"photo_url"`
	Capacity       *int     `json:"capacity"`
	IsOpen         *bool    `json:"is_open"`
	IsFull         *bool    `json:"is_full"`
	Phone          string   `json:"phone"`
	PersonInCharge string   `json:"person_in_charge"`
	Facilities     []string `json:"facilities"`
	OperatingHours string   `json:"operating_hours"`
	IsActive       *bool    `json:"is_active"`
}

func validateEvacuationLocationInput(in *evacuationLocationInput) error {
	if strings.TrimSpace(in.Name) == "" {
		return errors.New("nama lokasi wajib diisi")
	}
	if !validEvacuationLocationTypes[in.LocationType] {
		return errors.New("location_type tidak dikenal")
	}
	if in.Latitude < -90 || in.Latitude > 90 {
		return errors.New("latitude di luar rentang -90..90")
	}
	if in.Longitude < -180 || in.Longitude > 180 {
		return errors.New("longitude di luar rentang -180..180")
	}
	if in.Capacity != nil && *in.Capacity < 0 {
		return errors.New("capacity tidak boleh negatif")
	}
	return nil
}
