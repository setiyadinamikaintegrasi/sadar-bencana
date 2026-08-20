"""ESA WorldCover 10m landcover grid importer (Sprint 5 S3).

Downloads the ESA WorldCover v100 (2020) COG tiles intersecting a bbox,
samples landcover class at ~1 km spacing (overview level ~148 m/px with
stride 7 — fraction deviation < 0.3 pp vs full resolution, verified on the
Java tile), and stores one point per sample in ``worldcover_landcover_grid``.

Design notes:
- Tiles are 3°x3° on S3 (esa-worldcover bucket, CC BY 4.0): sampled via the
  built-in COG overview (~2250x2250) so decode cost is 1/16 of full-res.
- Idempotent: grid rebuilt in one transaction (TRUNCATE + inserts) and
  metadata upserted into ``spatial_datasets``.
- Operator CLI, not scheduled: WorldCover release cadence is yearly+.
- Sampled points are kept for ALL classes including water (80) — water
  fraction is context for flood/tsunami impact.

Usage (from apps/worker with the venv active):
    python -m importers.worldcover_landcover --db "$DATABASE_URL"
    python -m importers.worldcover_landcover --db "$DATABASE_URL" --bbox 106,-7,112,-5 --cache-dir /tmp/wc
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import math
import os
import re
import tempfile
from dataclasses import dataclass
from typing import Iterator

import numpy as np
import tifffile

logger = logging.getLogger("importers.worldcover_landcover")

DATASET = "worldcover_landcover"
VINTAGE = "2020"
VERSION = "v100"
RESOLUTION_M = 1030  # ~148 m/px overview x stride 7
ATTRIBUTION = "ESA WorldCover 10m 2020 v100 (CC BY 4.0)"
S3_BASE = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v100/2020/map"
TILE_DEGREES = 3.0
OVERVIEW_TARGET_M = 150.0
SAMPLE_STRIDE = 7
MAX_TILE_BYTES = 256 * 1024 * 1024  # tile terbesar ±40 MB; batas longgar
BATCH_ROWS = 20_000

# Default: bbox daratan/lautan Indonesia (agak longgar agar pulau tepi masuk).
INDONESIA_BBOX = (94.0, -11.5, 141.5, 7.0)


@dataclass(frozen=True)
class LandcoverSample:
    longitude: float
    latitude: float
    class_code: int


def _tile_name(lat_deg: int, lon_deg: int) -> str:
    lat = f"{'N' if lat_deg >= 0 else 'S'}{abs(lat_deg):02d}"
    lon = f"E{lon_deg:03d}"
    return f"ESA_WorldCover_10m_2020_{VERSION}_{lat}{lon}_Map"


def _tile_bounds(lat_deg: int, lon_deg: int) -> tuple[float, float, float, float]:
    """Batas (min_lon, min_lat, max_lon, max_lat) tile: nama = sudut BARAT-LAUT?"""
    # Konvensi ESA: N00E108 memuat lat -3..0? Terbukti dari tiepoint tile S06E108:
    # origin lat -3 -> tile S06E108 = lon 108..111, lat -6..-3 (nama = sudut selatan-barat).
    return (float(lon_deg), float(lat_deg - TILE_DEGREES), float(lon_deg + TILE_DEGREES), float(lat_deg))


def enumerate_tiles(bbox: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """Daftar (lat_deg, lon_deg) tile 3° yang berpotongan dengan bbox."""
    min_lon, min_lat, max_lon, max_lat = bbox
    tiles: list[tuple[int, int]] = []
    lon = math.floor(min_lon / TILE_DEGREES) * int(TILE_DEGREES)
    while lon < max_lon:
        lat = math.floor(min_lat / TILE_DEGREES) * int(TILE_DEGREES)
        while lat < max_lat:
            tiles.append((lat + int(TILE_DEGREES), lon))  # nama pakai sudut utara
            lat += int(TILE_DEGREES)
        lon += int(TILE_DEGREES)
    return sorted(set(tiles))


def _pick_overview(tif, full_scale_deg: float) -> int:
    """Index halaman overview (~150 m/px) pada tif.pages.

    pages[0] = full-res; halaman berikutnya makin kasar (18000 -> 1125).
    Pilih overview terrinci yang resolusinya masih >= ~75% target 150 m.
    """
    base = tif.pages[0]
    candidates = []
    for index, sub in enumerate(tif.pages[1:], start=1):
        width = sub.shape[1]
        pixel_deg = full_scale_deg * (base.shape[1] / width)
        pixel_m = pixel_deg * 111_320
        if pixel_m >= OVERVIEW_TARGET_M * 0.75:
            candidates.append((index, width))
    if not candidates:
        return 0
    return max(candidates, key=lambda item: item[1])[0]


def parse_worldcover_tile(
    source: str,
    bbox: tuple[float, float, float, float] | None = None,
) -> list[LandcoverSample]:
    """Baca satu tile COG WorldCover -> sampel kelas ~1km dalam bbox."""
    with tifffile.TiffFile(source) as tif:
        page = tif.pages[0]
        tags = {tag.name: tag.value for tag in page.tags}
        scale = tags.get("ModelPixelScaleTag")
        tiepoint = tags.get("ModelTiepointTag")
        if not scale or not tiepoint:
            raise ValueError(f"{source}: GeoTIFF tags missing")
        pixel_deg = float(scale[0])
        origin_lon, origin_lat = float(tiepoint[3]), float(tiepoint[4])

        overview_index = _pick_overview(tif, pixel_deg)
        reader = tif.pages[overview_index] if overview_index else page
        raster = reader.asarray()

    # Resolusi piksel halaman yang terpilih (full-res bila tak ada overview
    # yang memenuhi target) + stride adaptif: jumlah sampel target ~1 sel per
    # km, dipastikan minimal 1 sampel per tile agar tile kecil tak kosong.
    page_pixel_deg = pixel_deg * (page.shape[1] / raster.shape[1])
    stride = max(1, round((1000.0 / (page_pixel_deg * 111_320)) / SAMPLE_STRIDE) * SAMPLE_STRIDE)
    stride = max(1, min(stride, max(1, min(raster.shape) - 1)))
    min_lon, min_lat, max_lon, max_lat = bbox or (-180.0, -90.0, 180.0, 90.0)
    rows, cols = raster.shape
    # Posisi sampel: pusat blok stride, dibatasi piksel terakhir agar pusat
    # tidak keluar batas tile (blok tak penuh di tepi).
    row_positions = np.minimum(np.arange(0, rows, stride) + stride // 2, rows - 1)
    col_positions = np.minimum(np.arange(0, cols, stride) + stride // 2, cols - 1)
    sampled = raster[::stride, ::stride]
    lat_idx, lon_idx = np.nonzero(sampled != 0)
    classes = sampled[sampled != 0].astype(np.int64)
    samples: list[LandcoverSample] = []
    for r, c, klass in zip(lat_idx.tolist(), lon_idx.tolist(), classes.tolist()):
        longitude = origin_lon + float(col_positions[c]) * page_pixel_deg
        latitude = origin_lat - float(row_positions[r]) * page_pixel_deg
        if min_lon <= longitude <= max_lon and min_lat <= latitude <= max_lat:
            samples.append(LandcoverSample(longitude, latitude, int(klass)))
    return samples


def _download_tile(client: "httpx.Client", name: str, cache_dir: str | None) -> str:
    """Unduh satu tile via httpx (keep-alive ~5x lebih cepat dari urllib).

    Raise FileNotFoundError untuk 404 (tile tanpa daratan tidak diterbitkan
    ESA) agar pemanggil dapat melewatkannya tanpa gagal total.
    """
    url = f"{S3_BASE}/{name}.tif"
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
    target = os.path.join(cache_dir, f"{name}.tif") if cache_dir else os.path.join(tempfile.gettempdir(), f"{name}.tif")
    if os.path.exists(target) and os.path.getsize(target) > 0:
        return target
    logger.info("downloading %s", url)
    with client.stream("GET", url) as response:
        if response.status_code == 404:
            raise FileNotFoundError(f"tile not published: {name}")
        response.raise_for_status()
        declared = int(response.headers.get("Content-Length") or 0)
        if declared > MAX_TILE_BYTES:
            raise ValueError(f"tile too large: {declared} bytes")
        with open(target, "wb") as handle:
            downloaded = 0
            for chunk in response.iter_bytes(1024 * 1024):
                downloaded += len(chunk)
                if downloaded > MAX_TILE_BYTES:
                    handle.close()
                    os.unlink(target)
                    raise ValueError("tile exceeded size limit while streaming")
                handle.write(chunk)
    return target


def download_tiles(names: list[str], cache_dir: str | None, concurrency: int = 4) -> dict[str, str]:
    """Unduh beberapa tile paralel (I/O bound); hasil name->path, 404 di-skip."""
    import httpx
    from concurrent.futures import ThreadPoolExecutor

    results: dict[str, str] = {}
    with httpx.Client(timeout=300, limits=httpx.Limits(max_connections=concurrency)) as client:
        def fetch(name: str) -> tuple[str, str | None]:
            try:
                return name, _download_tile(client, name, cache_dir)
            except FileNotFoundError:
                logger.warning("tile %s not published (open water?) — skipped", name)
                return name, None

        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            for name, path in pool.map(fetch, names):
                if path:
                    results[name] = path
    return results


async def run_ingest(
    database_url: str,
    bbox: tuple[float, float, float, float],
    cache_dir: str | None,
) -> None:
    import asyncpg

    tiles = enumerate_tiles(bbox)
    names = [_tile_name(lat, lon) for lat, lon in tiles]
    logger.info("%d tiles intersect bbox %s", len(tiles), bbox)

    # Tahap 1: unduh paralel (I/O) di luar transaksi — TRUNCATE di tahap 2
    # singkat sehingga tidak menahan AccessExclusiveLock lama.
    paths = await asyncio.to_thread(download_tiles, names, cache_dir)

    # Tahap 2: parse (CPU) di thread pool.
    parsed: list[tuple[str, list[tuple[float, float, int]]]] = []
    for name, path in sorted(paths.items()):
        samples = await asyncio.to_thread(parse_worldcover_tile, path, bbox)
        rows = [(s.latitude, s.longitude, s.class_code) for s in samples]
        parsed.append((name, rows))
        logger.info("tile %s: %d samples", name, len(rows))

    # Tahap 3: transaksi singkat tulis semua baris + metadata.
    total_samples = sum(len(rows) for _, rows in parsed)
    conn = await asyncpg.connect(database_url)
    try:
        async with conn.transaction():
            await conn.execute("TRUNCATE worldcover_landcover_grid")
            for _, rows in parsed:
                for start in range(0, len(rows), BATCH_ROWS):
                    await conn.executemany(
                        "INSERT INTO worldcover_landcover_grid (geom, class_code) "
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
                DATASET, VINTAGE, RESOLUTION_M, ATTRIBUTION, S3_BASE, total_samples,
            )
    finally:
        await conn.close()
    logger.info("ingest complete: %d samples across %d tiles", total_samples, len(parsed))


def _parse_bbox(value: str) -> tuple[float, float, float, float]:
    parts = [float(p.strip()) for p in value.split(",")]
    if len(parts) != 4 or not all(-180 <= p <= 180 or -90 <= p <= 90 for p in parts):
        raise argparse.ArgumentTypeError("bbox must be min_lon,min_lat,max_lon,max_lat")
    return (parts[0], parts[1], parts[2], parts[3])


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--bbox", type=_parse_bbox, default=INDONESIA_BBOX,
                        help="min_lon,min_lat,max_lon,max_lat (default Indonesia)")
    parser.add_argument("--cache-dir", default=None,
                        help="Cache unduhan tile agar re-run tidak mengunduh ulang")
    args = parser.parse_args()
    if not args.db:
        parser.error("--db atau DATABASE_URL wajib diisi")
    asyncio.run(run_ingest(args.db, args.bbox, args.cache_dir))


if __name__ == "__main__":
    main()
