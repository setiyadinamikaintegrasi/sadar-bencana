import pytest

from geo.administrative_boundaries import (
    parse_boundary_geojson,
    point_in_geometry,
    resolve_boundary,
)

SQUARE = {
    "type": "Polygon",
    "coordinates": [[[106.0, -7.0], [108.0, -7.0], [108.0, -5.0], [106.0, -5.0], [106.0, -7.0]]],
}


def test_point_in_polygon_and_outside():
    assert point_in_geometry(107.0, -6.0, SQUARE)
    assert not point_in_geometry(110.0, -6.0, SQUARE)


def test_parse_boundary_geojson_requires_unique_codes_and_provenance():
    payload = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"code": "32", "name": "Jawa Barat"}, "geometry": SQUARE},
        ],
    }
    rows = parse_boundary_geojson(
        payload,
        code_field="code",
        name_field="name",
        level="province",
        parent_field=None,
        source_name="BIG",
        dataset_version="2025-01",
    )
    assert rows[0]["code"] == "32"
    assert rows[0]["min_longitude"] == 106.0
    assert len(rows[0]["geometry_checksum"]) == 64

    payload["features"].append(payload["features"][0])
    with pytest.raises(ValueError, match="duplicate"):
        parse_boundary_geojson(
            payload,
            code_field="code",
            name_field="name",
            level="province",
            parent_field=None,
            source_name="BIG",
            dataset_version="2025-01",
        )


def test_resolve_boundary_prefers_most_specific_match():
    province = {
        "code": "32", "level": "province", "geometry": SQUARE,
        "min_longitude": 106.0, "min_latitude": -7.0,
        "max_longitude": 108.0, "max_latitude": -5.0,
    }
    regency = {**province, "code": "32.01", "level": "regency"}
    assert resolve_boundary(107.0, -6.0, [province, regency])["code"] == "32.01"
