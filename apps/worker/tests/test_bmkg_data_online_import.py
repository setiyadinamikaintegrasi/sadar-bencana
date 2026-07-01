import io
import zipfile
from xml.sax.saxutils import escape

import pytest

from importers.bmkg_data_online import parse_bmkg_data_online_xlsx


def _xlsx(rows: list[list[str]]) -> bytes:
    strings = [value for row in rows for value in row]
    shared = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + "".join(f"<si><t>{escape(value)}</t></si>" for value in strings)
        + "</sst>"
    )
    offset = 0
    xml_rows = []
    for row_number, row in enumerate(rows, start=1):
        cells = []
        for column, _ in enumerate(row):
            reference = f"{chr(ord('A') + column)}{row_number}"
            cells.append(f'<c r="{reference}" t="s"><v>{offset}</v></c>')
            offset += 1
        xml_rows.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    sheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        + "".join(xml_rows)
        + "</sheetData></worksheet>"
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("xl/sharedStrings.xml", shared)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return output.getvalue()


def test_parse_bmkg_workbook_finds_header_after_report_title():
    content = _xlsx([
        ["Laporan Data Gempabumi BMKG"],
        ["Timestamp", "Latitude", "Longitude", "Kedalaman", "Magnitudo"],
        ["2026-06-21 12:30:00", "-6.2", "106.8", "10 km", "5.1"],
    ])
    result = parse_bmkg_data_online_xlsx(content)
    assert result["header_row"] == 2
    assert result["record_count"] == 1
    assert result["error_count"] == 0
    assert result["records"][0]["occurred_at"] == "2026-06-21T12:30:00Z"
    assert result["records"][0]["depth_km"] == 10
    assert result["records"][0]["administrative_code"] is None


def test_parse_bmkg_portal_header_with_units():
    content = _xlsx([
        ["DATE (GMT)", "LINTANG (°)", "BUJUR (°)", "KEDALAMAN (KM)", "MAGNITUDO (M)"],
        ["2026-06-21 12:30:00", "-6.2", "106.8", "10", "5.1"],
    ])
    result = parse_bmkg_data_online_xlsx(content)
    assert result["record_count"] == 1
    assert result["field_mapping"]["occurred_at"] == 0
    assert result["field_mapping"]["depth_km"] == 3


def test_parse_bmkg_workbook_reports_invalid_rows_without_aborting():
    content = _xlsx([
        ["Timestamp", "Latitude", "Longitude", "Kedalaman", "Magnitudo"],
        ["not-a-date", "-6.2", "106.8", "10", "5.1"],
        ["2026-06-21 12:30:00", "-6.3", "106.9", "11", "4.8"],
    ])
    result = parse_bmkg_data_online_xlsx(content)
    assert result["record_count"] == 1
    assert result["error_count"] == 1


def test_rejects_non_xlsx_payload():
    with pytest.raises(ValueError, match="invalid XLSX"):
        parse_bmkg_data_online_xlsx(b"not a workbook")
