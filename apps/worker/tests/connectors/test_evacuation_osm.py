from connectors.evacuation_osm import (
    AMENITY_TO_LOCATION_TYPE,
    build_overpass_query,
    element_to_location,
)


def test_amenity_mapping_complete():
    assert AMENITY_TO_LOCATION_TYPE == {
        "hospital": "rumah_sakit",
        "clinic": "puskesmas",
        "police": "kantor_polisi",
        "fire_station": "damkar",
    }


def test_build_overpass_query_contains_bbox_and_amenity():
    q = build_overpass_query("hospital")
    assert '"amenity"="hospital"' in q
    assert "(-11.0,92.0,8.0,142.0)" in q
    assert "out center" in q


def test_element_to_location_node():
    element = {
        "type": "node", "id": 123, "lat": -6.2, "lon": 106.8,
        "tags": {"name": "RSUD Contoh", "phone": "021555", "opening_hours": "24/7"},
    }
    row = element_to_location(element, "hospital")
    assert row["source_ref"] == "osm:node/123"
    assert row["name"] == "RSUD Contoh"
    assert row["location_type"] == "rumah_sakit"
    assert row["latitude"] == -6.2 and row["longitude"] == 106.8
    assert row["phone"] == "021555" and row["operating_hours"] == "24/7"


def test_element_to_location_way_uses_center_and_fallback_name():
    element = {"type": "way", "id": 9, "center": {"lat": -7.0, "lon": 110.0}, "tags": {}}
    row = element_to_location(element, "fire_station")
    assert row["source_ref"] == "osm:way/9"
    assert row["latitude"] == -7.0
    assert "Damkar" in row["name"]  # nama fallback


def test_element_without_coordinates_returns_none():
    assert element_to_location({"type": "way", "id": 1, "tags": {}}, "police") is None
