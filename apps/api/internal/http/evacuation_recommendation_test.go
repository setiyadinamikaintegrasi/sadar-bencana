package http

import "testing"

func TestRecommendedLocationTypes(t *testing.T) {
	cases := []struct {
		disaster string
		want     []string
	}{
		{"earthquake", []string{"titik_kumpul", "posko_bnpb_bpbd"}},
		{"tsunami", []string{"tea", "posko_bnpb_bpbd"}},
		{"flood", []string{"shelter", "tes"}},
		{"landslide", []string{"tea", "posko_bnpb_bpbd"}},
		{"volcano", []string{"tea", "posko_bnpb_bpbd"}},
		{"fire", []string{"titik_kumpul"}},
		{"wildfire", []string{"titik_kumpul"}},
	}
	for _, tc := range cases {
		got := recommendedLocationTypes(tc.disaster)
		if len(got) != len(tc.want) {
			t.Fatalf("%s: got %v want %v", tc.disaster, got, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("%s: got %v want %v", tc.disaster, got, tc.want)
			}
		}
	}
}

func TestRecommendedLocationTypesUnknownReturnsNil(t *testing.T) {
	if got := recommendedLocationTypes("meteor"); got != nil {
		t.Fatalf("unknown disaster should return nil, got %v", got)
	}
	if got := recommendedLocationTypes(""); got != nil {
		t.Fatalf("empty disaster should return nil, got %v", got)
	}
}

func TestTravelEstimates(t *testing.T) {
	walk, drive := travelEstimates(5.0) // 5 km
	if walk != 60 {                     // 5 km / 5 km/h = 60 menit
		t.Fatalf("walk: got %d want 60", walk)
	}
	if drive != 8 { // 5/40*60 = 7.5 -> ceil 8
		t.Fatalf("drive: got %d want 8", drive)
	}
	walk, drive = travelEstimates(0.05) // 50 m: minimum 1 menit
	if walk < 1 || drive < 1 {
		t.Fatalf("minimum 1 menit, got walk=%d drive=%d", walk, drive)
	}
}
