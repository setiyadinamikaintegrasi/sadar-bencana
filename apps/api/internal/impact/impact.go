// Package impact menyediakan skor dampak event (Sprint 6 S5) — port formula
// risk-v2 dari apps/worker/scoring/risk.py dengan koneksi live ke data
// spasial Sprint 5 (populasi WorldPop, medan SRTM, tutupan lahan WorldCover,
// fasilitas kritis OSM). Skor dihitung on-demand per event dan seluruh
// faktor dijelaskan dalam respons (explainable).
package impact

import "math"

// FormulaVersion mengikuti worker (risk-v2) agar konsisten silang layanan.
const FormulaVersion = "risk-v2"

// Weights sama dengan worker: hazard dominan, exposure dari WorldPop.
var Weights = map[string]float64{
	"hazard_intensity": 0.55,
	"exposure":         0.20,
	"vulnerability":    0.15,
	"confidence":       0.05,
	"freshness":        0.05,
}

// EventInput adalah karakteristik event yang diskor.
type EventInput struct {
	PerilType string  // earthquake | flood | volcano | wildfire | ...
	Magnitude float64 // skala asli per jenis
	DepthKm   float64 // opsional (gempa); <=0 dianggap tak diketahui
	AgeHours  float64 // usia event untuk freshness; <=0 dianggap baru.
}

// SpatialContext adalah hasil S1-S4 untuk area dampak.
type SpatialContext struct {
	Population       float64 // S1: total populasi radius dampak.
	PopulationKnown  bool
	SteepPercent     float64 // S4: % sampel daratan terjal.
	WaterPercent     float64 // S4: % perairan (banjir/tsunami memperbesar).
	BuiltUpFraction  float64 // S3: fraksi kelas 50.
	CropFraction     float64 // S3: fraksi kelas 40 (pertanian rentan banjir).
	LandcoverKnown   bool
	FacilitiesTotal  int // S2: jumlah fasilitas kritis radius.
	FacilitiesKnown  bool
}

// HazardIntensity menormalkan magnitude per peril ke [0,1] (port _hazard_intensity).
func (e EventInput) HazardIntensity() float64 {
	magnitude := math.Max(0, e.Magnitude)
	switch e.PerilType {
	case "earthquake":
		component := clamp01((magnitude - 3.0) / 5.0)
		depthFactor := 1.0
		if e.DepthKm > 0 {
			depthFactor = math.Max(0.35, 1.0-e.DepthKm/700.0)
		}
		return component * depthFactor
	case "flood", "volcano":
		return clamp01(magnitude / 4.0)
	case "wildfire":
		return clamp01(magnitude / 10.0)
	default:
		return clamp01(magnitude / 10.0)
	}
}

// Exposure memakai skala logaritmik identik worker (log1p ke 1 juta jiwa).
func (c SpatialContext) Exposure() float64 {
	if !c.PopulationKnown {
		return 0
	}
	return clamp01(math.Log1p(c.Population) / math.Log1p(1_000_000))
}

// Vulnerability menggabungkan S3+S4 menjadi indeks [0,1]:
// lereng terjal menyulitkan evakuasi, kawasan terbangun & lahan pertanian
// memperbesar kerentanan, air memperbesar untuk banjir/tsunami (di-bobot
// per peril oleh pemanggil melalui WaterBoost).
func (c SpatialContext) Vulnerability(waterBoost float64) float64 {
	if !c.LandcoverKnown {
		// Tanpa landcover: fallback medan saja bila ada.
		if c.SteepPercent > 0 {
			return clamp01(c.SteepPercent / 100 * 0.6)
		}
		return 0
	}
	terrain := c.SteepPercent / 100 * 0.5
	land := c.BuiltUpFraction*0.35 + c.CropFraction*0.15
	water := clamp01(waterBoost) * (c.WaterPercent / 100) * 0.3
	return clamp01(terrain + land + water)
}

// Freshness menurun seiring usia event (24 jam penuh -> 0.5 bawah).
func (e EventInput) Freshness() float64 {
	if e.AgeHours <= 0 {
		return 1.0
	}
	return clamp01(1.0 - e.AgeHours/48.0)
}

// Confidence event satu-sumber resmi (BMKG/USGS) tanpa korelasi — pakai
// konstanta 0.7 yang konservatif (worker memakai 0.5 default; sumber resmi
// tunggal di API ini sedikit lebih tinggi).
const SingleOfficialSourceConfidence = 0.7

// Components mengembalikan seluruh komponen ternormalisasi.
func Components(event EventInput, ctx SpatialContext, waterBoost float64) map[string]float64 {
	return map[string]float64{
		"hazard_intensity": round4(event.HazardIntensity()),
		"exposure":         round4(ctx.Exposure()),
		"vulnerability":    round4(ctx.Vulnerability(waterBoost)),
		"confidence":       SingleOfficialSourceConfidence,
		"freshness":        round4(event.Freshness()),
	}
}

// Score menghitung skor akhir [0,100] + komponen untuk explainability.
func Score(event EventInput, ctx SpatialContext) (float64, map[string]float64, map[string]bool) {
	// Air memperbesar kerentanan untuk perils berbasis air.
	waterBoost := 0.0
	switch event.PerilType {
	case "flood", "tsunami":
		waterBoost = 1.0
	case "earthquake", "volcano":
		waterBoost = 0.5
	}
	components := Components(event, ctx, waterBoost)
	score := 0.0
	for name, weight := range Weights {
		score += components[name] * weight
	}
	fallbacks := map[string]bool{
		"exposure_unavailable":     !ctx.PopulationKnown,
		"landcover_unavailable":    !ctx.LandcoverKnown,
		"facilities_unavailable":   !ctx.FacilitiesKnown,
		"confidence_single_source": true,
	}
	return round2(100 * score), components, fallbacks
}

func clamp01(v float64) float64 {
	if math.IsNaN(v) {
		return 0
	}
	return math.Min(1, math.Max(0, v))
}

func round4(v float64) float64 { return math.Round(v*1e4) / 1e4 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }
