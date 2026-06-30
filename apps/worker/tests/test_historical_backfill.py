import json

import pytest

from historical_backfill import map_historical_record, parse_resource, validate_dataset_url

MANIFEST = {
    "records_path": "data",
    "field_map": {
        "source_record_id": "id",
        "occurred_at": "date",
        "administrative_code": "admin_code",
        "peril_type": "peril",
        "title": "title",
    },
}


def test_json_and_csv_resources_map_to_same_contract():
    record = {"id": "1", "date": "2025-01-02", "admin_code": "31.71", "peril": "flood", "title": "Banjir"}
    json_rows = parse_resource(json.dumps({"data": [record]}).encode(), "json", "data")
    csv_rows = parse_resource(b"id,date,admin_code,peril,title\n1,2025-01-02,31.71,flood,Banjir\n", "csv")
    assert map_historical_record(json_rows[0], MANIFEST).administrative_code == "31.71"
    assert map_historical_record(csv_rows[0], MANIFEST).source_record_id == "1"


def test_dataset_url_allowlist_blocks_ssrf():
    validate_dataset_url("https://data.bnpb.go.id/dataset.json")
    validate_dataset_url("https://earthquake.usgs.gov/events.json")
    with pytest.raises(ValueError):
        validate_dataset_url("https://evil.example/steal")
    with pytest.raises(ValueError):
        validate_dataset_url("http://data.bnpb.go.id/insecure")
