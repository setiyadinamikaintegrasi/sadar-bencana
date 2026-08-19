"""Unit tests untuk importer WorldPop (Sprint 5 S1).

Membangun GeoTIFF sintetis kecil via tifffile (termasuk tag GeoTIFF +
kompresi LZW seperti file asli) lalu memverifikasi parsing grid: koordinat
pusat sel, penanganan nodata, dan inferensi vintage dari nama file.
"""

from __future__ import annotations

import numpy as np
import pytest
import tifffile

from importers.worldpop_grid import (
    MAX_TIF_BYTES,
    GridCell,
    _vintage_from_path,
    parse_worldpop_tif,
)

SCALE = (0.0083333333, 0.0083333333, 0.0)
TIEPOINT = (0.0, 0.0, 0.0, 100.0, 0.0, 0.0)


def _write_tif(path: str, raster: np.ndarray, nodata: str = "-99999") -> None:
    tifffile.imwrite(
        path,
        raster,
        compression="lzw",
        photometric="minisblack",
        extratags=[
            (33550, 12, 3, SCALE, False),          # ModelPixelScaleTag
            (33922, 12, 6, TIEPOINT, False),       # ModelTiepointTag
            (42113, 2, len(nodata), nodata, True),  # GDAL_NODATA
        ],
    )


def test_parse_worldpop_tif_converts_cells_to_points(tmp_path):
    raster = np.array(
        [
            [10.0, 0.0],     # baris 0: sel valid + nol (dilewati)
            [-99999.0, 2.5],  # baris 1: nodata + valid kecil
        ],
        dtype=np.float32,
    )
    path = str(tmp_path / "idn_ppp_2020_1km_Aggregated_UNadj.tif")
    _write_tif(path, raster)

    vintage, cells, total = parse_worldpop_tif(path)

    assert vintage == "2020"
    assert [c.population for c in cells] == [10.0, 2.5]
    assert total == pytest.approx(12.5)
    # Pusat sel: origin (100, 0) - baris ke selatan, kolom ke timur.
    first, second = cells
    assert first.longitude == pytest.approx(100 + 0.5 * SCALE[0])
    assert first.latitude == pytest.approx(0 - 0.5 * SCALE[1])
    assert second.longitude == pytest.approx(100 + 1.5 * SCALE[0])
    assert second.latitude == pytest.approx(0 - 1.5 * SCALE[1])


def test_parse_worldpop_tif_all_nodata(tmp_path):
    raster = np.full((4, 4), -99999.0, dtype=np.float32)
    path = str(tmp_path / "idn_ppp_2021_1km_Aggregated_UNadj.tif")
    _write_tif(path, raster)

    vintage, cells, total = parse_worldpop_tif(path)
    assert vintage == "2021"
    assert cells == []
    assert total == 0.0


def test_vintage_inference_rejects_unrelated_names():
    with pytest.raises(ValueError):
        _vintage_from_path("/tmp/unknown_file.tif")


def test_grid_cell_is_plain_data():
    cell = GridCell(longitude=106.8, latitude=-6.2, population=12.5)
    assert (cell.longitude, cell.latitude, cell.population) == (106.8, -6.2, 12.5)


def test_size_limit_is_sane():
    # File aktual ±10 MB; batas 64 MB memberi ruang untuk tahun/dataset lain
    # tanpa membuka pintu unduhan tanpa batas.
    assert MAX_TIF_BYTES == 64 * 1024 * 1024
