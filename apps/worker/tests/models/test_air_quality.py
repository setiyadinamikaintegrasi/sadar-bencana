from datetime import datetime, timezone

import pytest

from models.air_quality import AirQualityObservationInput


def observation(**overrides) -> AirQualityObservationInput:
    values = {
        "source": "bmkg",
        "station_id": "kmy3",
        "station_name": "Kemayoran",
        "pollutant": "pm25",
        "value": 66.2,
        "unit": "µg/m³",
        "category": "Tidak Sehat",
        "observed_at": datetime(2026, 7, 15, tzinfo=timezone.utc),
        "source_url": "https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
        "raw_payload": {"station": "kmy3"},
    }
    values.update(overrides)
    return AirQualityObservationInput(**values)


@pytest.mark.parametrize("unit", ["ug/m3", "µg/m³", "μg/m³"])
def test_pm25_unit_is_normalized(unit: str):
    assert observation(unit=unit).unit == "ug/m3"


def test_invalid_pm25_unit_is_rejected():
    with pytest.raises(ValueError, match="PM2.5 unit"):
        observation(unit="ppm")


def test_unknown_category_is_rejected():
    with pytest.raises(ValueError):
        observation(category="Unknown")


@pytest.mark.parametrize(
    "category",
    ["Baik", "Sedang", "Tidak Sehat", "Sangat Tidak Sehat", "Berbahaya"],
)
def test_database_categories_are_accepted(category: str):
    assert observation(category=category).category == category


def test_naive_observed_at_is_rejected():
    with pytest.raises(ValueError, match="observed_at must include a timezone"):
        observation(observed_at=datetime(2026, 7, 15))


@pytest.mark.parametrize(
    "source_url",
    [
        "http://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
        "https://example.com/kualitas-udara/pm25/pm25_kmy3",
    ],
)
def test_source_url_must_be_official_bmkg_https(source_url: str):
    with pytest.raises(ValueError, match="official BMKG HTTPS host"):
        observation(source_url=source_url)


def test_bmkg_subdomain_https_source_url_is_accepted():
    source_url = "https://iklim.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3"

    assert observation(source_url=source_url).source_url == source_url


def test_bmkg_root_https_source_url_is_accepted():
    source_url = "https://bmkg.go.id/kualitas-udara/pm25/pm25_kmy3"

    assert observation(source_url=source_url).source_url == source_url


def test_bmkg_explicit_https_port_source_url_is_accepted():
    source_url = "https://bmkg.go.id:443/kualitas-udara/pm25/pm25_kmy3"

    assert observation(source_url=source_url).source_url == source_url


@pytest.mark.parametrize(
    "source_url",
    [
        "https://bmkg.go.id.example.com/kualitas-udara/pm25/pm25_kmy3",
        "https://notbmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
        "https://bmkg.go.id@evil.example/kualitas-udara/pm25/pm25_kmy3",
        "https://reader:secret@bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
        "https://iklim.bmkg.go.id:8443/kualitas-udara/pm25/pm25_kmy3",
    ],
)
def test_look_alike_bmkg_hosts_are_rejected(source_url: str):
    with pytest.raises(ValueError, match="official BMKG HTTPS host"):
        observation(source_url=source_url)


@pytest.mark.parametrize(
    "coordinates",
    [{"latitude": -6.2}, {"longitude": 106.8}],
)
def test_partial_coordinates_are_rejected_to_match_database_constraint(
    coordinates: dict[str, float],
):
    with pytest.raises(ValueError, match="latitude and longitude"):
        observation(**coordinates)


def test_coordinate_pair_is_accepted():
    result = observation(latitude=-6.2, longitude=106.8)

    assert (result.latitude, result.longitude) == (-6.2, 106.8)


@pytest.mark.parametrize(
    "coordinates",
    [
        {"latitude": -90.1, "longitude": 0},
        {"latitude": 0, "longitude": 180.1},
    ],
)
def test_out_of_range_coordinates_are_rejected(coordinates: dict[str, float]):
    with pytest.raises(ValueError):
        observation(**coordinates)


@pytest.mark.parametrize(
    "raw_payload",
    [
        {"reading": float("nan")},
        {"reading": float("inf")},
        {"observed_at": datetime(2026, 7, 15, tzinfo=timezone.utc)},
    ],
)
def test_raw_payload_must_be_strictly_json_compatible(raw_payload: dict[str, object]):
    with pytest.raises(ValueError, match="raw_payload must be JSON-compatible"):
        observation(raw_payload=raw_payload)
