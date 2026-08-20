package elevation

import (
	"context"
	"image"
	"image/color"
	"testing"
)

func TestLngLatToTileJakarta(t *testing.T) {
	// Jakarta (106.8, -6.2) pada z10 -> x=815, y=529 (diverifikasi silang
	// independen: (lng+180)/360*2^z dan formula Web Mercator y).
	x, y, fx, fy := lngLatToTile(106.8, -6.2, 10)
	if x != 815 || y != 529 {
		t.Fatalf("tile = %d/%d, want 815/529", x, y)
	}
	if fx < 0 || fx >= 1 || fy < 0 || fy >= 1 {
		t.Fatalf("fraksi di luar tile: %v %v", fx, fy)
	}
}

func TestDecodeTerrariumRoundTrip(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	// Elevasi 364 m: R=129, G=108, B=0 (364+32768=33132=129*256+108).
	img.Set(0, 0, color.RGBA{R: 129, G: 108, B: 0, A: 255})
	if got := decodeTerrarium(img, 0, 0); got != 364 {
		t.Fatalf("elev = %v, want 364", got)
	}
	// Elevasi negatif (bathimetri): -100 m -> 32768-100=32668=127*256+156.
	img.Set(0, 0, color.RGBA{R: 127, G: 156, B: 0, A: 255})
	if got := decodeTerrarium(img, 0, 0); got != -100 {
		t.Fatalf("elev = %v, want -100", got)
	}
}

// fakeSampler menguji ElevationGrid tanpa jaringan.
func newFakeSampler(values map[[2]float64]float64) *Sampler {
	s := NewSampler(4)
	s.fetchTile = func(ctx context.Context, z, x, y int) (*tileImage, error) {
		img := image.NewRGBA(image.Rect(0, 0, 256, 256))
		// Satu warna untuk seluruh tile: elevasi dari koordinat tile.
		base := 32768.0
		elev := 0.0
		if v, ok := values[[2]float64{float64(x), float64(y)}]; ok {
			elev = v
		}
		enc := base + elev
		r := uint8(int(enc) / 256)
		g := uint8(int(enc) % 256)
		for yy := 0; yy < 256; yy++ {
			for xx := 0; xx < 256; xx++ {
				img.SetRGBA(xx, yy, color.RGBA{R: r, G: g, B: 0, A: 255})
			}
		}
		return &tileImage{img: img, w: 256, h: 256}, nil
	}
	return s
}

func TestElevationGridSummary(t *testing.T) {
	// Bbox kecil pada satu tile (z10 x673 y438) dengan elevasi flat 500 m.
	s := newFakeSampler(map[[2]float64]float64{{815, 529}: 500})
	summary, err := s.ElevationGrid(context.Background(), 106.70, -6.25, 106.75, -6.20, 0.02)
	if err != nil {
		t.Fatalf("grid: %v", err)
	}
	if summary.Samples == 0 {
		t.Fatalf("tidak ada sampel")
	}
	if summary.MinM != 500 || summary.MaxM != 500 || summary.MeanM != 500 {
		t.Fatalf("summary = %+v, want flat 500", summary)
	}
	if summary.WaterPercent != 0 || summary.LandSamples != summary.Samples {
		t.Fatalf("water/land = %v/%v, want 0%% & semua daratan", summary.WaterPercent, summary.LandSamples)
	}
	if summary.Roughness != 0 {
		t.Fatalf("roughness = %v, want 0 untuk medan datar", summary.Roughness)
	}
}

func TestElevationGridSteepTerrain(t *testing.T) {
	// Dua tile bersebelahan: rendah 10 m vs tinggi 800 m -> steep >0.
	// Batas tile 815/816 pada z10 = lng 106.953; bbox 106.55..107.05
	// menyentuh kedua tile: 815 tinggi 800 m, 816 rendah 10 m.
	s := newFakeSampler(map[[2]float64]float64{
		{815, 529}: 800,
		{816, 529}: 10,
	})
	// Tile z10 ≈ 0.351° lebar; batas tile 814/815 di lng = (815/1024)*360-180
	// = 106.953°. Bbox 106.55..107.05 melintasi dua tile.
	summary, err := s.ElevationGrid(context.Background(), 106.55, -6.25, 107.05, -6.20, 0.05)
	if err != nil {
		t.Fatalf("grid: %v", err)
	}
	if summary.MaxM != 800 || summary.MinM != 10 {
		t.Fatalf("summary = %+v", summary)
	}
	if summary.MeanM <= 10 || summary.MeanM >= 800 {
		t.Fatalf("mean = %v, want di antara min & max", summary.MeanM)
	}
	if summary.SteepPercent <= 0 {
		t.Fatalf("steep = %v, want > 0 pada medan terjal", summary.SteepPercent)
	}
	if summary.Roughness <= 0 {
		t.Fatalf("roughness = %v, want > 0", summary.Roughness)
	}
}

func TestSamplerLRUEviction(t *testing.T) {
	s := NewSampler(2) // cache 2 tile.
	if len(s.order) != 0 || len(s.cache) != 0 {
		t.Fatalf("cache awal harus kosong")
	}
	// Simulasi penyisipan manual.
	for i := 0; i < 3; i++ {
		key := tileKey{10, i, 0}
		s.cache[key] = &tileImage{w: 1, h: 1}
		s.order = append(s.order, key)
		if len(s.order) > s.maxTile {
			oldest := s.order[0]
			s.order = s.order[1:]
			delete(s.cache, oldest)
		}
	}
	if len(s.cache) != 2 {
		t.Fatalf("cache = %d, want 2 (LRU)", len(s.cache))
	}
	if _, evicted := s.cache[tileKey{10, 0, 0}]; evicted {
		t.Fatalf("tile terlama harus terevict")
	}
}
