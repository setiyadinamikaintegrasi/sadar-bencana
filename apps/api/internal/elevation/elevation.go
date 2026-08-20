// Package elevation menyediakan sampling elevasi dari AWS Terrain Tiles
// (terrarium PNG, turunan SRTM ~30-90m) untuk Sprint 5 S4: ringkasan medan
// area dampak — terrain roughness mempengaruhi estimasi aksesibilitas
// penyelamatan (longsor, evakuasi darat) pada impact engine.
package elevation

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/png"
	"math"
	"net/http"
	"sync"
)

// TileURLTemplate adalah sumber tile terrarium (sama dengan layer terrain 3D).
const TileURLTemplate = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/%d/%d/%d.png"

// MaxTileZoom terrarium tersedia hingga z15; z10 (~100m/px) cukup untuk
// ringkasan medan area dampak dan menjaga volume unduhan kecil.
const MaxTileZoom = 10

// Sampler mengunduh dan mendekode tile terrarium dengan cache LRU sederhana
// berbasis peta + batas jumlah tile (thread-safe).
type Sampler struct {
	client  *http.Client
	mu      sync.Mutex
	cache   map[tileKey]*tileImage
	order   []tileKey // LRU: paling tua di depan.
	maxTile int
	// FetchTile adalah field agar test dapat menyuntik sumber palsu.
	FetchTile func(ctx context.Context, z, x, y int) (*TileImage, error)
}

type tileKey struct {
	z, x, y int
}

// TileImage diekspor agar test handler dapat menyuntik sumber palsu.
type TileImage = tileImage

type tileImage struct {
	pix []uint8 // RGB planar? tidak — pakai image.RGBA via decode.
	w, h int
	img *image.RGBA
}

// NewSampler membuat sampler elevasi; maxCachedTile membatasi memori cache
// (tile 256x256 RGBA ≈ 256 KB; 128 tile ≈ 32 MB).
func NewSampler(maxCachedTile int) *Sampler {
	if maxCachedTile <= 0 {
		maxCachedTile = 128
	}
	sampler := &Sampler{
		client:  &http.Client{},
		cache:   make(map[tileKey]*tileImage),
		maxTile: maxCachedTile,
	}
	sampler.FetchTile = sampler.httpFetchTile
	return sampler
}

// lngLatToTile mengonversi koordinat ke koordinat tile-piksel pada zoom.
// Mengembalikan z,x,y tile dan posisi piksel fraksional di dalamnya.
func lngLatToTile(lng, lat float64, zoom int) (x, y int, fx, fy float64) {
	n := math.Exp2(float64(zoom))
	xFloat := (lng + 180.0) / 360.0 * n
	latRad := lat * math.Pi / 180.0
	yFloat := (1.0 - math.Log(math.Tan(latRad)+1.0/math.Cos(latRad))/math.Pi) / 2.0 * n
	x = int(math.Floor(xFloat))
	y = int(math.Floor(yFloat))
	return x, y, xFloat - float64(x), yFloat - float64(y)
}

// httpFetchTile mengunduh + mendekode satu tile terrarium dari AWS.
func (s *Sampler) httpFetchTile(ctx context.Context, z, x, y int) (*tileImage, error) {
	key := tileKey{z, x, y}
	s.mu.Lock()
	if cached, ok := s.cache[key]; ok {
		s.mu.Unlock()
		return cached, nil
	}
	s.mu.Unlock()

	url := fmt.Sprintf(TileURLTemplate, z, x, y)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tile %d/%d/%d: status %d", z, x, y, resp.StatusCode)
	}
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(resp.Body); err != nil {
		return nil, err
	}
	img, err := png.Decode(bytes.NewReader(buf.Bytes()))
	if err != nil {
		return nil, err
	}
	rgba, ok := img.(*image.RGBA)
	if !ok {
		converted := image.NewRGBA(img.Bounds())
		for yy := img.Bounds().Min.Y; yy < img.Bounds().Max.Y; yy++ {
			for xx := img.Bounds().Min.X; xx < img.Bounds().Max.X; xx++ {
				converted.Set(xx, yy, img.At(xx, yy))
			}
		}
		rgba = converted
	}
	tile := &tileImage{img: rgba, w: rgba.Bounds().Dx(), h: rgba.Bounds().Dy()}

	s.mu.Lock()
	s.cache[key] = tile
	s.order = append(s.order, key)
	for len(s.order) > s.maxTile {
		oldest := s.order[0]
		s.order = s.order[1:]
		delete(s.cache, oldest)
	}
	s.mu.Unlock()
	return tile, nil
}

// ElevationAt mengembalikan elevasi (meter) untuk satu koordinat.
// Nilai negatif sah (bathimetri); error hanya untuk kegagalan jaringan.
func (s *Sampler) ElevationAt(ctx context.Context, lng, lat float64) (float64, error) {
	z := MaxTileZoom
	x, y, fx, fy := lngLatToTile(lng, lat, z)
	tile, err := s.FetchTile(ctx, z, x, y)
	if err != nil {
		return 0, err
	}
	px := int(math.Round(fx * float64(tile.w)))
	py := int(math.Round(fy * float64(tile.h)))
	if px < 0 {
		px = 0
	}
	if py < 0 {
		py = 0
	}
	if px >= tile.w {
		px = tile.w - 1
	}
	if py >= tile.h {
		py = tile.h - 1
	}
	return decodeTerrarium(tile.img, px, py), nil
}

func decodeTerrarium(img *image.RGBA, x, y int) float64 {
	r, g, b, _ := img.At(x, y).RGBA()
	// image.RGBA memampatkan ke 16-bit; kembalikan ke 8-bit terrarium.
	r8, g8, b8 := r>>8, g>>8, b>>8
	return float64(int(r8)*256+int(g8)) + float64(b8)/256.0 - 32768.0
}

// Summary adalah ringkasan medan sekumpulan sampel elevasi.
type Summary struct {
	MinM         float64
	MaxM         float64
	MeanM        float64
	Samples      int
	LandSamples  int
	WaterPercent float64  // % sampel di bawah muka laut (bathimetri).
	Roughness    float64  // simpangan baku sampel daratan (meter).
	SteepPercent float64  // % sampel daratan dgn |Δelev| > 200m terhadap min daratan.
}

// ElevationGrid menebar titik grid reguler dalam bbox dan menghitung
// ringkasan medan. stepDegrees mengatur kerapatan (mis. 0.01° ≈ 1.1 km).
func (s *Sampler) ElevationGrid(ctx context.Context, minLng, minLat, maxLng, maxLat, stepDegrees float64) (*Summary, error) {
	if stepDegrees <= 0 {
		stepDegrees = 0.01
	}
	var values []float64
	for lat := minLat; lat <= maxLat+1e-9; lat += stepDegrees {
		for lng := minLng; lng <= maxLng+1e-9; lng += stepDegrees {
			elev, err := s.ElevationAt(ctx, lng, lat)
			if err != nil {
				return nil, err
			}
			values = append(values, elev)
		}
	}
	if len(values) == 0 {
		return nil, fmt.Errorf("no samples")
	}
	// Daratan = elevasi >= 0 (muka laut). Bathimetri dilaporkan terpisah
	// sebagai water_percent; statistik medan hanya atas daratan agar
	// "min medan evakuasi" tidak menjadi dasar laut (Kasus Ruteng: bbox
	// pegunungan pesisir memuat Selat Flores -3.8 km).
	land := make([]float64, 0, len(values))
	water := 0
	for _, v := range values {
		if v >= 0 {
			land = append(land, v)
			continue
		}
		water++
	}
	waterPercent := 100 * float64(water) / float64(len(values))
	if len(land) == 0 {
		return &Summary{
			MinM:         0,
			MaxM:         0,
			MeanM:        0,
			Samples:      len(values),
			LandSamples:  0,
			WaterPercent: waterPercent,
		}, nil
	}
	minV, maxV := math.Inf(1), math.Inf(-1)
	sum := 0.0
	for _, v := range land {
		minV = math.Min(minV, v)
		maxV = math.Max(maxV, v)
		sum += v
	}
	mean := sum / float64(len(land))
	variance := 0.0
	steep := 0
	for _, v := range land {
		d := v - mean
		variance += d * d
		if v-minV > 200 {
			steep++
		}
	}
	return &Summary{
		MinM:         minV,
		MaxM:         maxV,
		MeanM:        mean,
		Samples:      len(values),
		LandSamples:  len(land),
		WaterPercent: waterPercent,
		Roughness:    math.Sqrt(variance / float64(len(land))),
		SteepPercent: 100 * float64(steep) / float64(len(land)),
	}, nil
}

var _ = binary.LittleEndian // pertahankan import bila refactor.
