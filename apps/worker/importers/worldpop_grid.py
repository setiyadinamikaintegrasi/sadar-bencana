"""WorldPop 1km UNadj population grid importer (Sprint 5 S1).

Downloads the WorldPop GeoTIFF for Indonesia (1km, UN-adjusted), converts
raster cells with population > 0 into point rows in ``worldpop_population_grid``
(cell center, lon/lat WGS84), and records dataset metadata in
``spatial_datasets`` for vintage attribution.

Design notes:
- Pure tifffile + numpy decoding (LZW needs ``imagecodecs``) so the worker does
  not require a GDAL runtime.
- Ingest is idempotent: the grid table is rebuilt inside one transaction
  (TRUNCATE + COPY-like executemany), metadata upserted at the end.
- Population year/vintage is pinned per file path; refresh cadence is yearly
  at most, so this runs as an operator CLI, not on a scheduler.

Usage (from apps/worker with the venv active):
    python -m importers.worldpop_grid --db "$DATABASE_URL"
    python -m importers.worldpop_grid --tif /path/to/idn_ppp_2020_1km_Aggregated_UNadj.tif --db "$DATABASE_URL"
"""

from __future__ import annotations

import argparse
import asyncio
import io
import logging
import os
import tempfile
import urllib.request
from dataclasses import dataclass
from typing import Iterator

import numpy as np
import tifffile

logger = logging.getLogger("importers.worldpop_grid")

DATASET = "worldpop_population"
DEFAULT_TIF_URL = (
    "https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/"
    "2020/IDN/idn_ppp_2020_1km_Aggregated_UNadj.tif"
)
ATTRIBUTION = "WorldPop (CC BY 4.0)"
RESOLUTION_M = 1000
MAX_TIF_BYTES = 64 * 1024 * 1024  # dataset aktual ±10 MB; batas longgar utk tahun lain
BATCH_ROWS = 20_000


@dataclass(frozen=True)
class GridCell:
    longitude: float
    latitude: float
    population: float


@dataclass(frozen=True)
class ParsedGrid:
    vintage: str
    cells: int
    total_population: float
    rows: Iterator[tuple[float, float, float]]


def _vintage_from_path(path: str) -> str:
    """Ambil tahun (vintage) dari nama file WorldPop, mis. idn_ppp_2020_... -> 2020."""
    name = os.path.basename(path)
    for part in name.replace("-", "_").split("_"):
        if len(part) == 4 and part.isdigit() and part.startswith("20"):
            return part
    raise ValueError(f"cannot infer WorldPop vintage from file name: {name}")


def parse_worldpop_tif(source: io.IOBase | str) -> tuple[str, list[GridCell], float]:
    """Baca GeoTIFF WorldPop -> (vintage, sel berpopulasi > 0, total populasi).

    ``source`` berupa path file atau objek file-like (mis. hasil unduhan).
    """
    vintage = _vintage_from_path(getattr(source, "name", "") or str(source))

    with tifffile.TiffFile(source) as tif:
        page = tif.pages[0]
        tags = {tag.name: tag.value for tag in page.tags}
        scale = tags.get("ModelPixelScaleTag")
        tiepoint = tags.get("ModelTiepointTag")
        nodata_raw = tags.get("GDAL_NODATA", "-99999")
        if not scale or not tiepoint:
            raise ValueError("GeoTIFF lacks ModelPixelScale/ModelTiepoint tags")
        pixel_lon, pixel_lat = float(scale[0]), float(scale[1])
        origin_lon, origin_lat = float(tiepoint[3]), float(tiepoint[4])
        # Tiepoint (0,0) -> koordinat pusat sudut kiri-atas grid.
        raster = page.asarray()

    try:
        nodata = float(str(nodata_raw).strip().strip("'\""))
    except (TypeError, ValueError):
        nodata = -99999.0

    mask = (raster != nodata) & (raster > 0)
    lats, lons = np.nonzero(mask)  # lats = baris (dari atas), lons = kolom
    populations = raster[mask].astype(np.float64)

    cells: list[GridCell] = []
    total = 0.0
    # Pusat sel: origin + (indeks + 0.5) * ukuran piksel; baris bertambah ke selatan.
    for row, col, population in zip(lats.tolist(), lons.tolist(), populations.tolist()):
        cells.append(GridCell(
            longitude=origin_lon + (col + 0.5) * pixel_lon,
            latitude=origin_lat - (row + 0.5) * pixel_lat,
            population=population,
        ))
        total += population
    return vintage, cells, total


def _download(url: str) -> str:
    """Unduh GeoTIFF ke file sementara; ukuran dibatasi MAX_TIF_BYTES."""
    logger.info("downloading %s", url)
    with urllib.request.urlopen(url, timeout=120) as response:
        headers = response.headers
        declared = int(headers.get("Content-Length") or 0)
        if declared > MAX_TIF_BYTES:
            raise ValueError(f"WorldPop tif too large: {declared} bytes")
        tmp = tempfile.NamedTemporaryFile(prefix="worldpop_", suffix=".tif", delete=False)
        try:
            downloaded = 0
            while chunk := response.read(1024 * 1024):
                downloaded += len(chunk)
                if downloaded > MAX_TIF_BYTES:
                    raise ValueError("WorldPop tif exceeded size limit while streaming")
                tmp.write(chunk)
        finally:
            tmp.close()
    return tmp.name


async def run_ingest(database_url: str, tif_path: str | None, url: str) -> None:
    import asyncpg

    path = tif_path
    cleanup = None
    if not path:
        cleanup = path = _download(url)

    vintage, cells, total = parse_worldpop_tif(path)
    logger.info("parsed %s: %d cells, total population %.0f", vintage, len(cells), total)

    conn = await asyncpg.connect(database_url)
    try:
        async with conn.transaction():
            await conn.execute("TRUNCATE worldpop_population_grid")
            rows = [(c.latitude, c.longitude, c.population) for c in cells]
            for start in range(0, len(rows), BATCH_ROWS):
                await conn.executemany(
                    "INSERT INTO worldpop_population_grid (geom, population) "
                    "VALUES (ST_SetSRID(ST_MakePoint($2, $1), 4326), $3)",
                    rows[start:start + BATCH_ROWS],
                )
            await conn.execute(
                """
                INSERT INTO spatial_datasets
                    (dataset, vintage, resolution_m, attribution, source_url, feature_count)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (dataset) DO UPDATE SET
                    vintage = EXCLUDED.vintage,
                    resolution_m = EXCLUDED.resolution_m,
                    attribution = EXCLUDED.attribution,
                    source_url = EXCLUDED.source_url,
                    ingested_at = now(),
                    feature_count = EXCLUDED.feature_count
                """,
                DATASET, vintage, RESOLUTION_M, ATTRIBUTION, url, len(cells),
            )
    finally:
        await conn.close()
        if cleanup:
            os.unlink(cleanup)

    logger.info("ingest complete: %d cells for vintage %s", len(cells), vintage)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.environ.get("DATABASE_URL", ""), help="PostgreSQL URL")
    parser.add_argument("--tif", default=None, help="Path GeoTIFF lokal (lewati unduhan)")
    parser.add_argument("--url", default=DEFAULT_TIF_URL, help="URL GeoTIFF WorldPop")
    args = parser.parse_args()
    if not args.db:
        parser.error("--db atau DATABASE_URL wajib diisi")
    asyncio.run(run_ingest(args.db, args.tif, args.url))


if __name__ == "__main__":
    main()
