"""Unit tests untuk importer ESA WorldCover (Sprint 5 S3).

Membangun COG sintetis kecil (full-res + overview) meniru struktur tile ESA
lalu memverifikasi sampling ~1km: koordinat pusat sel, kelas nodata (0)
dilewati, pemilihan overview, enumerasi tile 3°, dan penanganan bbox.
"""

from __future__ import annotations

import numpy as np
import pytest
import tifffile

from importers.worldcover_landcover import (
    SAMPLE_STRIDE,
    LandcoverSample,
    _pick_overview,
    _tile_name,
    enumerate_tiles,
    parse_worldcover_tile,
)

SCALE = (8.333333333333333e-05, 8.333333333333333e-05, 0.0)


def _write_cog(path: str, raster: np.ndarray, origin_lon: float, origin_lat: float) -> None:
    """Tulis GeoTIFF dua halaman: full-res + overview 1/2 (meniru COG ESA)."""
    overview = raster[::2, ::2].copy()
    extratags = [
        (33550, 12, 3, SCALE, False),  # ModelPixelScaleTag
        (33922, 12, 6, (0.0, 0.0, 0.0, origin_lon, origin_lat, 0.0), False),
        (42113, 2, 1, "0", True),  # GDAL_NODATA
    ]
    with tifffile.TiffWriter(path) as writer:
        writer.write(raster, photometric="minisblack", extratags=extratags)
        writer.write(overview, photometric="minisblack", subfiletype=1)


def test_enumerate_tiles_covers_bbox_with_3_degree_grid():
    tiles = enumerate_tiles((94.0, -11.5, 141.5, 7.0))
    assert len(tiles) == 119
    # Konvensi nama tile = sudut UTARA-barat; S09 memuat lat -9..-6, N09
    # memuat 6..9 (menutup bbox hingga 7.0).
    assert (6, 93) in tiles and (-9, 93) in tiles and (9, 141) in tiles
    # Nama tile: sudut utara-barat; S06E108 memuat lat -6..-3 (tiepoint -3).
    assert _tile_name(-6, 108) == "ESA_WorldCover_10m_2020_v100_S06E108_Map"


def test_parse_worldcover_tile_samples_centers_and_skips_nodata(tmp_path):
    # Grid 140x140 dengan kelas berpola: 10 utara, 0 (nodata) tengah, 50 selatan.
    # Stride adaptif (>=7) menjamin baris utara & selatan tersampel.
    size = 140
    raster = np.zeros((size, size), dtype=np.uint8)
    raster[0:20, :] = 10
    raster[100:140, :] = 50
    path = str(tmp_path / "tile.tif")
    _write_cog(path, raster, origin_lon=100.0, origin_lat=0.0)

    samples = parse_worldcover_tile(path)
    classes = {s.class_code for s in samples}
    assert classes == {10, 50}  # nodata 0 tidak disimpan
    # Koordinat dalam batas tile dengan toleransi setengah stride.
    for sample in samples:
        assert 100.0 <= sample.longitude <= 100.0 + size * SCALE[0]
        assert 0.0 - size * SCALE[1] <= sample.latitude <= 0.0
        assert sample.latitude <= 0.0  # baris bertambah ke selatan


def test_parse_worldcover_tile_bbox_filter(tmp_path):
    size = 140
    raster = np.full((size, size), 80, dtype=np.uint8)
    raster[0:70, 0:70] = 50  # seperempat kiri-atas
    path = str(tmp_path / "tile.tif")
    _write_cog(path, raster, origin_lon=100.0, origin_lat=0.0)

    # bbox hanya seperempat kiri-atas tile (lat 0..-tertentu, lon awal).
    half = size * SCALE[0] / 2
    samples = parse_worldcover_tile(path, (100.0, -half, 100.0 + half, 0.0))
    assert len(samples) > 0
    assert all(s.class_code == 50 for s in samples)


def test_pick_overview_prefers_coarsest_above_target():
    class FakePage:
        shape = (36000, 36000)

    class FakeTif:
        pages = [FakePage(), FakePage(), FakePage(), FakePage()]

    class FakeSub(FakePage):
        def __init__(self, width: int):
            self.shape = (width, width)

    FakeTif.pages = [FakePage(), FakeSub(18000), FakeSub(9000), FakeSub(1125)]
    # Full 36000 @ ~9.25 m; overview 9000 ~37 m; 1125 ~296 m. Target 150 m
    # dengan toleransi 75% -> 296 m lolos syarat (>=112.5) dan terrinci yang
    # dipilih adalah 9000? 37m < target*0.75 -> tidak; maka 1125 terpilih.
    index = _pick_overview(FakeTif(), SCALE[0])
    assert index == 3


def test_sample_stride_is_documented():
    # Sampling ~1km = overview ~148 m x stride 7 ≈ 1030 m.
    assert SAMPLE_STRIDE == 7


def test_landcover_sample_is_plain_data():
    sample = LandcoverSample(longitude=106.8, latitude=-6.2, class_code=50)
    assert (sample.longitude, sample.latitude, sample.class_code) == (106.8, -6.2, 50)
