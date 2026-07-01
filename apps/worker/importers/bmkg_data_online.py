"""Parser for BMKG Data Online earthquake XLSX exports.

The portal currently exposes workbook downloads rather than an API token.  This
adapter intentionally uses only the XLSX Open Packaging/XML contract so the
worker does not need a large spreadsheet runtime in production.
"""

from __future__ import annotations

import hashlib
import io
import re
import zipfile
from datetime import UTC, datetime, timedelta
from typing import Any
from xml.etree import ElementTree as ET

MAX_XLSX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 50_000
_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_CELL_REF = re.compile(r"([A-Z]+)")

_ALIASES = {
    "occurred_at": {"timestamp", "waktu", "tanggalwaktu", "tanggaljam", "dategmt"},
    "latitude": {"latitude", "lintang", "lat"},
    "longitude": {"longitude", "bujur", "lon", "long"},
    "depth_km": {"kedalaman", "kedalamankm", "depth", "depthkm"},
    "magnitude": {"magnitudo", "magnitudom", "magnitude", "mag"},
}


def _normalized(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").strip().lower())


def _column_index(reference: str) -> int:
    match = _CELL_REF.match(reference)
    if not match:
        raise ValueError(f"invalid XLSX cell reference: {reference}")
    result = 0
    for char in match.group(1):
        result = result * 26 + ord(char) - ord("A") + 1
    return result - 1


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(node.text or "" for node in item.iter(f"{_NS}t")) for item in root.findall(f"{_NS}si")]


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{_NS}t"))
    value = cell.find(f"{_NS}v")
    raw = value.text if value is not None and value.text is not None else ""
    if kind == "s" and raw:
        return shared[int(raw)]
    return raw


def read_xlsx_rows(content: bytes) -> list[list[str]]:
    if len(content) > MAX_XLSX_BYTES:
        raise ValueError("BMKG XLSX exceeds 10MB limit")
    if not zipfile.is_zipfile(io.BytesIO(content)):
        raise ValueError("invalid XLSX archive")
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        shared = _shared_strings(archive)
        try:
            root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        except KeyError as exc:
            raise ValueError("XLSX first worksheet is missing") from exc
        rows: list[list[str]] = []
        for row in root.iter(f"{_NS}row"):
            values: dict[int, str] = {}
            for cell in row.findall(f"{_NS}c"):
                values[_column_index(cell.attrib.get("r", ""))] = _cell_value(cell, shared)
            if values:
                width = max(values) + 1
                rows.append([values.get(index, "") for index in range(width)])
            if len(rows) > MAX_ROWS:
                raise ValueError("BMKG XLSX exceeds row limit")
    return rows


def _header_mapping(row: list[str]) -> dict[str, int]:
    normalized = [_normalized(value) for value in row]
    result: dict[str, int] = {}
    for canonical, aliases in _ALIASES.items():
        for index, value in enumerate(normalized):
            if value in aliases:
                result[canonical] = index
                break
    return result


def _number(value: str, field: str) -> float:
    cleaned = re.sub(r"[^0-9,.\-+]", "", value.strip()).replace(",", ".")
    try:
        return float(cleaned)
    except ValueError as exc:
        raise ValueError(f"invalid {field}: {value!r}") from exc


def _timestamp(value: str) -> datetime:
    raw = value.strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", raw):
        # Excel 1900 date system, including the historical leap-year offset.
        return datetime(1899, 12, 30, tzinfo=UTC) + timedelta(days=float(raw))
    for pattern in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
    ):
        try:
            return datetime.strptime(raw, pattern).replace(tzinfo=UTC)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=parsed.tzinfo or UTC).astimezone(UTC)
    except ValueError as exc:
        raise ValueError(f"invalid timestamp: {value!r}") from exc


def parse_bmkg_data_online_xlsx(content: bytes) -> dict[str, Any]:
    rows = read_xlsx_rows(content)
    header_index = -1
    mapping: dict[str, int] = {}
    for index, row in enumerate(rows[:30]):
        candidate = _header_mapping(row)
        if {"occurred_at", "latitude", "longitude", "magnitude"}.issubset(candidate):
            header_index, mapping = index, candidate
            break
    if header_index < 0:
        raise ValueError("BMKG header row was not found")

    records: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for sheet_row, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
        if not any(str(value).strip() for value in row):
            continue
        try:
            get = lambda field: row[mapping[field]] if mapping[field] < len(row) else ""
            occurred_at = _timestamp(get("occurred_at"))
            latitude = _number(get("latitude"), "latitude")
            longitude = _number(get("longitude"), "longitude")
            magnitude = _number(get("magnitude"), "magnitude")
            depth = _number(get("depth_km"), "depth") if "depth_km" in mapping else None
            if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                raise ValueError("coordinates outside valid range")
            identity = f"{occurred_at.isoformat()}|{latitude:.5f}|{longitude:.5f}|{depth}|{magnitude:.2f}"
            records.append({
                "source_record_id": "bmkg-online-" + hashlib.sha256(identity.encode()).hexdigest()[:24],
                "peril_type": "earthquake",
                "occurred_at": occurred_at.isoformat().replace("+00:00", "Z"),
                "latitude": latitude,
                "longitude": longitude,
                "depth_km": depth,
                "magnitude": magnitude,
                "administrative_code": None,
                "raw_payload": {str(rows[header_index][i]): value for i, value in enumerate(row) if i < len(rows[header_index])},
                "sheet_row": sheet_row,
            })
        except (KeyError, ValueError) as exc:
            errors.append({"sheet_row": sheet_row, "error": str(exc)})
    return {
        "header_row": header_index + 1,
        "field_mapping": mapping,
        "record_count": len(records),
        "error_count": len(errors),
        "records": records,
        "errors": errors,
    }


__all__ = ["parse_bmkg_data_online_xlsx", "read_xlsx_rows"]
