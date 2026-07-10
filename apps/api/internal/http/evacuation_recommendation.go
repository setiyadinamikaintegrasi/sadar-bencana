package http

import (
	"math"
	"strings"
)

// disasterLocationPriority memetakan jenis bencana ke tipe lokasi evakuasi
// prioritas. Rule-based sesuai spec — BUKAN keputusan AI (kebijakan produk
// menolak instruksi evakuasi spekulatif dari model).
var disasterLocationPriority = map[string][]string{
	"earthquake": {"titik_kumpul", "posko_bnpb_bpbd"},
	"tsunami":    {"tea", "posko_bnpb_bpbd"},
	"flood":      {"shelter", "tes"},
	"landslide":  {"tea", "posko_bnpb_bpbd"},
	"volcano":    {"tea", "posko_bnpb_bpbd"},
	"fire":       {"titik_kumpul"},
	"wildfire":   {"titik_kumpul"},
}

// recommendedLocationTypes mengembalikan tipe lokasi prioritas untuk suatu
// jenis bencana, atau nil bila tidak dikenal (fallback: semua tipe).
func recommendedLocationTypes(disasterType string) []string {
	return disasterLocationPriority[strings.ToLower(strings.TrimSpace(disasterType))]
}

// travelEstimates menghitung estimasi menit tempuh jalan kaki (5 km/jam)
// dan kendaraan (40 km/jam), ceil, minimum 1 menit.
func travelEstimates(distanceKm float64) (walkMinutes, driveMinutes int) {
	walkMinutes = int(math.Ceil(distanceKm / 5.0 * 60))
	driveMinutes = int(math.Ceil(distanceKm / 40.0 * 60))
	if walkMinutes < 1 {
		walkMinutes = 1
	}
	if driveMinutes < 1 {
		driveMinutes = 1
	}
	return walkMinutes, driveMinutes
}
