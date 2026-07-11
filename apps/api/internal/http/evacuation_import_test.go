package http

import (
	"strings"
	"testing"
)

const evacCSVHeaderLine = "name,location_type,latitude,longitude,address,capacity,phone,person_in_charge,facilities,operating_hours"

func TestParseEvacuationCSV(t *testing.T) {
	csvData := evacCSVHeaderLine + "\n" +
		"Titik Kumpul Alun-Alun,titik_kumpul,-6.9147,107.6098,Jl. Asia Afrika Bandung,500,0227654321,Pak Budi,toilet;air bersih,24 jam\n"
	rows, err := parseEvacuationCSV(strings.NewReader(csvData))
	if err != nil {
		t.Fatalf("CSV valid ditolak: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("got %d rows", len(rows))
	}
	r := rows[0]
	if r.Name != "Titik Kumpul Alun-Alun" || r.LocationType != "titik_kumpul" ||
		r.Latitude != -6.9147 || r.Capacity == nil || *r.Capacity != 500 ||
		len(r.Facilities) != 2 || r.Facilities[1] != "air bersih" {
		t.Fatalf("row salah parse: %+v", r)
	}
}

func TestParseEvacuationCSVRejects(t *testing.T) {
	cases := []string{
		"kolom,salah\nx,y\n", // header salah
		evacCSVHeaderLine + "\nTanpa Tipe,warung,-6.9,107.6,,,,,,\n",     // tipe tidak dikenal
		evacCSVHeaderLine + "\nKoordinat Rusak,tes,abc,107.6,,,,,,\n",    // lat bukan angka
		evacCSVHeaderLine + "\nKapasitas Rusak,tes,-6.9,107.6,,xx,,,,\n", // capacity bukan angka
	}
	for i, data := range cases {
		if _, err := parseEvacuationCSV(strings.NewReader(data)); err == nil {
			t.Fatalf("case %d: CSV invalid diterima", i)
		}
	}
}
