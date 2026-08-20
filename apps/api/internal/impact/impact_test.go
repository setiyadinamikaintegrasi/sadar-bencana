package impact

import "testing"

func TestHazardIntensityPerPeril(t *testing.T) {
	cases := []struct {
		name  string
		event EventInput
		want  float64
	}{
		// (M-3)/5 = 0.8; kedalaman 100 km: max(0.35, 1-100/700)=0.857 -> 0.686.
		{"gempa M7 dalam 100km", EventInput{PerilType: "earthquake", Magnitude: 7.0, DepthKm: 100}, 0.6857},
		{"gempa M7 dangkal", EventInput{PerilType: "earthquake", Magnitude: 7.0}, 0.8},
		{"gempa M3 tepat batas", EventInput{PerilType: "earthquake", Magnitude: 3.0}, 0.0},
		{"banjir penuh", EventInput{PerilType: "flood", Magnitude: 4.0}, 1.0},
		{"volcano 2/4", EventInput{PerilType: "volcano", Magnitude: 2.0}, 0.5},
		{"karhutla 10", EventInput{PerilType: "wildfire", Magnitude: 10.0}, 1.0},
		{"tipe tak dikenal dibatasi 1", EventInput{PerilType: "meteor", Magnitude: 99}, 1.0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := round4(tc.event.HazardIntensity())
			if diff := got - tc.want; diff > 0.0001 || diff < -0.0001 {
				t.Fatalf("hazard = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestExposureLogScale(t *testing.T) {
	// Port worker: log1p(1jt)/log1p(1jt) = 1.
	full := SpatialContext{Population: 1_000_000, PopulationKnown: true}
	if full.Exposure() != 1.0 {
		t.Fatalf("exposure 1jt = %v, want 1.0", full.Exposure())
	}
	// 250rb jiwa: log1p(250k)/log1p(1jt) ≈ 0.8997.
	jakarta := SpatialContext{Population: 250_000, PopulationKnown: true}
	if v := jakarta.Exposure(); v < 0.899 || v > 0.900 {
		t.Fatalf("exposure 250k = %v, want ~0.8997", v)
	}
	// Tidak diketahui -> 0 (fallback aman, bukan asumsi besar).
	unknown := SpatialContext{}
	if unknown.Exposure() != 0 {
		t.Fatalf("exposure unknown = %v, want 0", unknown.Exposure())
	}
}

func TestVulnerabilityCombinesTerrainLandcoverWater(t *testing.T) {
	// Banjir penuh komponen: terrain 0.25 + land 0.35*0.6+0.15*0.4 + water 0.3.
	flood := SpatialContext{
		SteepPercent: 50, BuiltUpFraction: 0.6, CropFraction: 0.4,
		WaterPercent: 100, LandcoverKnown: true,
	}
	v := flood.Vulnerability(1.0)
	// terrain 0.5*0.5=0.25 + built 0.35*0.6=0.21 + crop 0.15*0.4=0.06
	// + water 1.0*(100%)*0.3 = 0.3 -> total 0.82.
	if diff(v, 0.82) > 1e-9 {
		t.Fatalf("vulnerability = %v, want 0.82", v)
	}
	// Gempa (waterBoost 0.5) di area laut 100%: water 0.15 saja.
	quake := SpatialContext{
		SteepPercent: 0, BuiltUpFraction: 0, CropFraction: 0,
		WaterPercent: 100, LandcoverKnown: true,
	}
	if v := quake.Vulnerability(0.5); diff(v, 0.15) > 1e-9 {
		t.Fatalf("vulnerability gempa-laut = %v, want 0.15", v)
	}
	// Tanpa landcover: fallback medan saja.
	mountainOnly := SpatialContext{SteepPercent: 80}
	if v := mountainOnly.Vulnerability(1.0); diff(v, 0.48) > 1e-9 {
		t.Fatalf("vulnerability medan-saja = %v, want 0.48", v)
	}
}

func TestFreshnessDecay(t *testing.T) {
	if (EventInput{AgeHours: 0}).Freshness() != 1.0 {
		t.Fatal("event baru harus 1.0")
	}
	if v := (EventInput{AgeHours: 24}).Freshness(); v != 0.5 {
		t.Fatalf("freshness 24 jam = %v, want 0.5", v)
	}
	if v := (EventInput{AgeHours: 96}).Freshness(); v != 0.0 {
		t.Fatalf("freshness 96 jam = %v, want 0 (clamp)", v)
	}
}

func TestScoreExplainableAndBounded(t *testing.T) {
	event := EventInput{PerilType: "earthquake", Magnitude: 6.5, AgeHours: 2}
	ctx := SpatialContext{
		Population: 500_000, PopulationKnown: true,
		SteepPercent: 70, WaterPercent: 10, BuiltUpFraction: 0.3, CropFraction: 0.1,
		LandcoverKnown: true, FacilitiesTotal: 12, FacilitiesKnown: true,
	}
	score, components, fallbacks := Score(event, ctx)
	if score < 0 || score > 100 {
		t.Fatalf("score di luar [0,100]: %v", score)
	}
	for _, name := range []string{"hazard_intensity", "exposure", "vulnerability", "confidence", "freshness"} {
		if _, ok := components[name]; !ok {
			t.Fatalf("komponen %s hilang", name)
		}
	}
	if fallbacks["exposure_unavailable"] {
		t.Fatal("exposure tersedia, fallback harus false")
	}
	// Verifikasi manual (dihitung independen): hazard 0.7; exposure
	// log1p(500k)/log1p(1jt)=0.9498; vuln 0.485; conf 0.7; fresh 0.9583.
	expected := 100 * (0.7*0.55 + 0.9498*0.2 + 0.485*0.15 + 0.7*0.05 + 0.9583*0.05)
	if d := score - round2(expected); d > 0.05 || d < -0.05 {
		t.Fatalf("score = %v, want ~%v", score, round2(expected))
	}
}

func TestScoreAllUnknownSafeFloor(t *testing.T) {
	// Tanpa data spasial sama sekali: skor murni hazard-based — tidak error.
	event := EventInput{PerilType: "earthquake", Magnitude: 5.0}
	score, _, fallbacks := Score(event, event.ContextZero())
	if score <= 0 {
		t.Fatalf("gempa M5 minimal > 0, dapat %v", score)
	}
	if !fallbacks["exposure_unavailable"] || !fallbacks["landcover_unavailable"] {
		t.Fatal("fallback harus merefleksikan data kosong")
	}
}

func diff(a, b float64) float64 {
	if a > b {
		return a - b
	}
	return b - a
}

// ContextZero helper untuk test.
func (e EventInput) ContextZero() SpatialContext { return SpatialContext{} }
