"""Resumable, idempotent backfill runner for approved official JSON/CSV resources."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

import asyncpg
import httpx

from db.official_alerts import payload_checksum
from models.historical import HistoricalEventInput

MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_DATA_HOSTS = ("bnpb.go.id", "bmkg.go.id", "esdm.go.id", "usgs.gov")


def validate_dataset_url(url: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not any(host == allowed or host.endswith(f".{allowed}") for allowed in ALLOWED_DATA_HOSTS):
        raise ValueError("historical dataset URL must use an approved official HTTPS host")


def parse_resource(content: bytes, resource_format: str, records_path: str | None = None) -> list[dict[str, Any]]:
    if resource_format == "csv":
        return [dict(row) for row in csv.DictReader(io.StringIO(content.decode("utf-8-sig")))]
    payload: Any = json.loads(content)
    for part in (records_path or "").split("."):
        if part:
            payload = payload[part]
    if not isinstance(payload, list):
        raise ValueError("dataset records path must resolve to a list")
    return [row for row in payload if isinstance(row, dict)]


def _field(record: dict[str, Any], path: str | None) -> Any:
    if not path:
        return None
    value: Any = record
    for part in (path or "").split("."):
        if part:
            value = value.get(part) if isinstance(value, dict) else None
    return value


def map_historical_record(record: dict[str, Any], manifest: dict[str, Any]) -> HistoricalEventInput:
    fields = manifest.get("field_map") or {}
    defaults = manifest.get("defaults") or {}
    occurred = _field(record, fields.get("occurred_at"))
    if isinstance(occurred, str) and len(occurred) == 10:
        occurred += "T00:00:00+00:00"
    return HistoricalEventInput(
        source_record_id=str(_field(record, fields.get("source_record_id"))),
        peril_type=str(_field(record, fields.get("peril_type")) or defaults.get("peril_type")),
        occurred_at=datetime.fromisoformat(str(occurred).replace("Z", "+00:00")),
        administrative_code=str(_field(record, fields.get("administrative_code"))),
        latitude=_field(record, fields.get("latitude")),
        longitude=_field(record, fields.get("longitude")),
        title=_field(record, fields.get("title")),
        raw_payload=record,
    )


async def _download(url: str) -> bytes:
    validate_dataset_url(url)
    async with httpx.AsyncClient(timeout=60, follow_redirects=False, headers={"User-Agent": "SadarBencana/0.4 historical-backfill"}) as client:
        response = await client.get(url)
        response.raise_for_status()
        if int(response.headers.get("content-length", "0")) > MAX_DOWNLOAD_BYTES:
            raise ValueError("historical dataset exceeds 50MB limit")
        content = response.content
    if len(content) > MAX_DOWNLOAD_BYTES:
        raise ValueError("historical dataset exceeds 50MB limit")
    return content


async def run_backfill_job(pool: asyncpg.Pool, job_id: UUID, batch_size: int = 500) -> dict[str, Any]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT j.id, j.dataset_id, j.checkpoint, j.processed_count,
                      d.source_url, d.resource_format, d.manifest
               FROM historical_backfill_jobs j
               JOIN historical_datasets d ON d.id=j.dataset_id
               WHERE j.id=$1""",
            job_id,
        )
    if row is None:
        raise ValueError("backfill job not found")
    content = await _download(row["source_url"])
    manifest = dict(row["manifest"])
    records = parse_resource(content, row["resource_format"], manifest.get("records_path"))
    offset = int(dict(row["checkpoint"]).get("offset", 0))
    batch = records[offset : offset + max(1, min(batch_size, 2000))]
    inserted = rejected = 0

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE historical_backfill_jobs SET status='running', started_at=COALESCE(started_at,now()), error_message=NULL WHERE id=$1",
                job_id,
            )
            for raw in batch:
                try:
                    event = map_historical_record(raw, manifest)
                    boundary_exists = await conn.fetchval(
                        "SELECT EXISTS(SELECT 1 FROM administrative_boundaries WHERE code=$1)",
                        event.administrative_code,
                    )
                    if not boundary_exists:
                        raise LookupError("administrative_boundary_missing")
                    result = await conn.execute(
                        """INSERT INTO historical_disaster_events
                           (dataset_id,source_record_id,peril_type,occurred_at,
                            administrative_code,latitude,longitude,title,raw_payload,payload_checksum)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
                           ON CONFLICT DO NOTHING""",
                        row["dataset_id"], event.source_record_id, event.peril_type,
                        event.occurred_at, event.administrative_code, event.latitude,
                        event.longitude, event.title,
                        json.dumps(event.raw_payload, ensure_ascii=False),
                        payload_checksum(event.raw_payload),
                    )
                    inserted += int(result.endswith("1"))
                except Exception as exc:
                    source_id = str(_field(raw, (manifest.get("field_map") or {}).get("source_record_id")) or "")
                    await conn.execute(
                        """INSERT INTO historical_backfill_rejections
                           (job_id,source_record_id,reason,raw_payload)
                           VALUES ($1,NULLIF($2,''),$3,$4::jsonb) ON CONFLICT DO NOTHING""",
                        job_id, source_id, str(exc)[:64],
                        json.dumps(raw, ensure_ascii=False),
                    )
                    rejected += 1
            new_offset = offset + len(batch)
            complete = new_offset >= len(records)
            await conn.execute(
                """UPDATE historical_backfill_jobs
                   SET status=$2, checkpoint=$3::jsonb,
                       processed_count=processed_count+$4,
                       completed_at=CASE WHEN $2='completed' THEN now() END,
                       updated_at=now() WHERE id=$1""",
                job_id, "completed" if complete else "running",
                json.dumps({"offset": new_offset, "total": len(records)}),
                len(batch),
            )
    return {"processed": len(batch), "inserted": inserted, "rejected": rejected, "complete": complete, "offset": new_offset}


__all__ = ["map_historical_record", "parse_resource", "run_backfill_job", "validate_dataset_url"]
