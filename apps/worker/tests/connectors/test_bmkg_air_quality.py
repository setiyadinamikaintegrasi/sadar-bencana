from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

import main as worker_main
from connectors.bmkg_air_quality import (
    BMKGAirQualityConnector,
    parse_air_quality_payload,
)
from connectors.official_feeds import ADAPTER_CONTRACTS, ALLOWED_HOSTS


PAYLOAD = {
    "warnings": [{
        "source_alert_id": "aq-jabar-20260715",
        "message_type": "alert",
        "status": "active",
        "sent_at": "2026-07-15T08:00:00+07:00",
        "effective_at": "2026-07-16T00:00:00+07:00",
        "expires_at": "2026-07-17T00:00:00+07:00",
        "category": "Tidak Sehat",
        "area_name": "Jawa Barat",
        "area_geojson": {
            "type": "Polygon",
            "coordinates": [[[106, -7], [108, -7], [108, -6], [106, -7]]],
        },
        "headline": "Peringatan Dini Kualitas Udara Jawa Barat",
        "description": "Potensi kualitas udara tidak sehat.",
        "source_url": "https://iklim.bmkg.go.id/kualitas-udara-indonesia/",
    }],
    "observations": [{
        "station_id": "kmy3",
        "station_name": "Kemayoran",
        "latitude": -6.155,
        "longitude": 106.84,
        "value": 66.2,
        "unit": "ug/m3",
        "category": "Tidak Sehat",
        "observed_at": "2026-07-15T04:00:00+07:00",
        "source_url": "https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
    }],
}


def test_air_quality_source_is_registered_as_versioned_official_bmkg_feed():
    assert ALLOWED_HOSTS["bmkg_air_quality"] == ("bmkg.go.id",)
    assert ADAPTER_CONTRACTS["bmkg_air_quality"] == {
        "v1": ("__warnings", "__observations"),
    }


def _setting(**overrides):
    values = {
        "enabled": True,
        "api_url": "https://iklim.bmkg.go.id/api/air-quality",
        "run_mode": "active",
        "field_mapping": {},
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class _PayloadConnector:
    def __init__(self, payload=None, error=None):
        self.payload = payload
        self.error = error
        self.closed = False

    async def fetch_payload(self):
        if self.error is not None:
            raise self.error
        return self.payload

    async def close(self):
        self.closed = True


def _patch_cycle_dependencies(monkeypatch, *, setting, connector):
    dependencies = {
        "resolve_source_setting": AsyncMock(return_value=setting),
        "BMKGAirQualityConnector": MagicMock(return_value=connector),
        "create_source_record": AsyncMock(return_value=({"id": "source-1"}, True)),
        "upsert_official_alert": AsyncMock(return_value=({"id": "alert-1", "revision": 1}, True)),
        "upsert_air_quality_observation": AsyncMock(return_value=({"id": "observation-1"}, True)),
        "delete_old_air_quality_observations": AsyncMock(return_value="DELETE 0"),
        "upsert_connector_health": AsyncMock(),
        "enqueue_official_alert_revision": AsyncMock(),
    }
    for name, value in dependencies.items():
        monkeypatch.setattr(worker_main, name, value, raising=False)
    return dependencies


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "setting",
    [None, _setting(enabled=False), _setting(api_url=None)],
    ids=["missing", "disabled", "endpoint-missing"],
)
async def test_cycle_is_default_disabled_without_an_active_approved_endpoint(
    monkeypatch,
    setting,
):
    connector = _PayloadConnector(PAYLOAD)
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=setting,
        connector=connector,
    )
    pool = object()

    result = await worker_main._bmkg_air_quality_cycle(pool)

    assert result == {"warnings": 0, "observations": 0}
    dependencies["BMKGAirQualityConnector"].assert_not_called()
    dependencies["upsert_connector_health"].assert_not_awaited()


@pytest.mark.asyncio
async def test_active_cycle_persists_both_collections_but_only_enqueues_warning(
    monkeypatch,
):
    monkeypatch.setenv("EWS_LIFECYCLE_DELIVERY_ENABLED", "true")
    connector = _PayloadConnector(deepcopy(PAYLOAD))
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=_setting(),
        connector=connector,
    )
    pool = object()

    result = await worker_main._bmkg_air_quality_cycle(pool)

    assert result == {"warnings": 1, "observations": 1}
    dependencies["BMKGAirQualityConnector"].assert_called_once_with(
        "https://iklim.bmkg.go.id/api/air-quality",
    )
    source_record = dependencies["create_source_record"].await_args.args[1]
    assert source_record.source_name == "bmkg_air_quality"
    assert source_record.source_record_id == "aq-jabar-20260715"
    assert source_record.attribution == (
        "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)"
    )
    dependencies["upsert_official_alert"].assert_awaited_once()
    observation = dependencies["upsert_air_quality_observation"].await_args.args[1]
    assert observation.station_id == "kmy3"
    dependencies["enqueue_official_alert_revision"].assert_awaited_once_with(
        pool,
        {"id": "alert-1", "revision": 1},
    )
    dependencies["delete_old_air_quality_observations"].assert_awaited_once()
    dependencies["upsert_connector_health"].assert_awaited_once_with(
        pool,
        "bmkg_air_quality",
        2,
        None,
    )
    assert connector.closed


@pytest.mark.asyncio
async def test_existing_warning_does_not_enqueue_a_duplicate_revision(monkeypatch):
    monkeypatch.setenv("EWS_LIFECYCLE_DELIVERY_ENABLED", "true")
    connector = _PayloadConnector(deepcopy(PAYLOAD))
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=_setting(),
        connector=connector,
    )
    dependencies["upsert_official_alert"].return_value = (
        {"id": "alert-1", "revision": 1},
        False,
    )
    pool = object()

    result = await worker_main._bmkg_air_quality_cycle(pool)

    assert result == {"warnings": 0, "observations": 1}
    dependencies["enqueue_official_alert_revision"].assert_not_awaited()


@pytest.mark.asyncio
async def test_dry_run_updates_health_without_persisting_or_retaining(monkeypatch):
    connector = _PayloadConnector(deepcopy(PAYLOAD))
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=_setting(run_mode="dry_run"),
        connector=connector,
    )
    pool = object()

    result = await worker_main._bmkg_air_quality_cycle(pool)

    assert result == {"warnings": 0, "observations": 0}
    dependencies["upsert_connector_health"].assert_awaited_once_with(
        pool,
        "bmkg_air_quality",
        2,
        None,
    )
    for name in (
        "create_source_record",
        "upsert_official_alert",
        "upsert_air_quality_observation",
        "delete_old_air_quality_observations",
        "enqueue_official_alert_revision",
    ):
        dependencies[name].assert_not_awaited()
    assert connector.closed


@pytest.mark.asyncio
async def test_cycle_health_reports_at_most_three_record_errors(monkeypatch):
    payload = deepcopy(PAYLOAD)
    payload["warnings"].extend([
        {
            **deepcopy(payload["warnings"][0]),
            "source_alert_id": f"bad-{index}",
            "category": "Baik",
        }
        for index in range(1, 5)
    ])
    connector = _PayloadConnector(payload)
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=_setting(),
        connector=connector,
    )
    pool = object()

    result = await worker_main._bmkg_air_quality_cycle(pool)

    assert result == {"warnings": 1, "observations": 1}
    health_error = dependencies["upsert_connector_health"].await_args.args[3]
    assert "warning bad-1" in health_error
    assert "warning bad-2" in health_error
    assert "warning bad-3" in health_error
    assert "warning bad-4" not in health_error


@pytest.mark.asyncio
async def test_cycle_fetch_failure_updates_health_and_closes_connector(monkeypatch):
    connector = _PayloadConnector(error=RuntimeError("upstream unavailable"))
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=_setting(),
        connector=connector,
    )
    pool = object()

    result = await worker_main._bmkg_air_quality_cycle(pool)

    assert result == {"warnings": 0, "observations": 0}
    dependencies["upsert_connector_health"].assert_awaited_once_with(
        pool,
        "bmkg_air_quality",
        0,
        "upstream unavailable",
    )
    dependencies["upsert_official_alert"].assert_not_awaited()
    dependencies["upsert_air_quality_observation"].assert_not_awaited()
    assert connector.closed


def test_parser_separates_official_warning_and_observation():
    warnings, observations, errors = parse_air_quality_payload(PAYLOAD, {})

    assert errors == []
    assert warnings[0].peril_type == "air_quality"
    assert warnings[0].severity == "Moderate"
    assert observations[0].station_id == "kmy3"


def test_baik_is_observation_but_not_warning():
    payload = deepcopy(PAYLOAD)
    payload["warnings"][0]["category"] = "Baik"

    warnings, observations, errors = parse_air_quality_payload(payload, {})

    assert warnings == []
    assert len(observations) == 1
    assert errors == ["warning aq-jabar-20260715: category is not extreme"]


@pytest.mark.parametrize(
    ("category", "severity"),
    [
        ("Tidak Sehat", "Moderate"),
        ("Sangat Tidak Sehat", "High"),
        ("Berbahaya", "Critical"),
    ],
)
def test_warning_category_maps_to_severity(category, severity):
    payload = deepcopy(PAYLOAD)
    payload["warnings"][0]["category"] = category

    warnings, _, errors = parse_air_quality_payload(payload, {})

    assert errors == []
    assert warnings[0].severity == severity


def test_warning_update_preserves_lifecycle_identity():
    payload = deepcopy(PAYLOAD)
    payload["warnings"][0]["message_type"] = "update"
    payload["warnings"][0]["sent_at"] = "2026-07-15T09:00:00+07:00"

    warnings, _, errors = parse_air_quality_payload(payload, {})

    assert errors == []
    assert warnings[0].source_alert_id == "aq-jabar-20260715"
    assert warnings[0].message_type == "update"


def test_observation_without_coordinates_remains_displayable():
    payload = deepcopy(PAYLOAD)
    payload["observations"][0]["latitude"] = None
    payload["observations"][0]["longitude"] = None

    _, observations, errors = parse_air_quality_payload(payload, {})

    assert errors == []
    assert observations[0].latitude is None
    assert observations[0].longitude is None


def test_schema_drift_is_rejected_before_record_processing():
    with pytest.raises(ValueError, match="warnings and observations must be arrays"):
        parse_air_quality_payload({"warnings": {}, "observations": []}, {})


def test_field_mapping_supports_nested_warning_and_observation_collections():
    payload = {
        "result": {
            "alerts": [deepcopy(PAYLOAD["warnings"][0])],
            "stations": [{
                "identity": {"id": "kmy3", "name": "Kemayoran"},
                **{
                    key: value
                    for key, value in PAYLOAD["observations"][0].items()
                    if key not in {"station_id", "station_name"}
                },
            }],
        },
    }
    mapping = {
        "__warnings": "result.alerts",
        "__observations": "result.stations",
        "observation.station_id": "identity.id",
        "observation.station_name": "identity.name",
    }

    warnings, observations, errors = parse_air_quality_payload(payload, mapping)

    assert errors == []
    assert warnings[0].source_alert_id == "aq-jabar-20260715"
    assert observations[0].station_name == "Kemayoran"


@pytest.mark.parametrize("category", ["Baik", "Sedang"])
def test_non_extreme_observation_never_becomes_warning(category):
    payload = deepcopy(PAYLOAD)
    payload["warnings"] = []
    payload["observations"][0]["category"] = category

    warnings, observations, errors = parse_air_quality_payload(payload, {})

    assert errors == []
    assert warnings == []
    assert observations[0].category == category


@pytest.mark.parametrize(
    ("field", "value", "expected_fragment"),
    [
        ("observed_at", "2026-07-15T04:00:00", "timezone"),
        ("source_url", "https://evil.example/data", "official BMKG HTTPS host"),
        ("longitude", 181, "longitude"),
    ],
)
def test_invalid_record_preserves_valid_sibling(field, value, expected_fragment):
    payload = deepcopy(PAYLOAD)
    invalid = deepcopy(payload["observations"][0])
    invalid["station_id"] = "bad"
    invalid[field] = value
    payload["observations"].append(invalid)

    _, observations, errors = parse_air_quality_payload(payload, {})

    assert [item.station_id for item in observations] == ["kmy3"]
    assert len(errors) == 1
    assert errors[0].startswith("observation bad:")
    assert expected_fragment in errors[0]


@pytest.mark.parametrize(
    "url",
    [
        "http://iklim.bmkg.go.id/api/air-quality",
        "https://evil.example/air-quality",
        "https://attacker@iklim.bmkg.go.id/api/air-quality",
        "https://iklim.bmkg.go.id:8443/api/air-quality",
    ],
)
def test_connector_rejects_unapproved_endpoint(url):
    with pytest.raises(ValueError, match="official BMKG"):
        BMKGAirQualityConnector(url)


@pytest.mark.asyncio
async def test_connector_pins_public_ip_and_preserves_host_and_sni(monkeypatch):
    monkeypatch.setattr(
        "connectors.bmkg_air_quality.resolve_public_ips",
        lambda _: ("8.8.8.8",),
    )
    captured = None

    def handler(request):
        nonlocal captured
        captured = request
        return httpx.Response(200, json=PAYLOAD)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    connector = BMKGAirQualityConnector(
        "https://iklim.bmkg.go.id/api/air-quality", client=client,
    )
    try:
        payload = await connector.fetch_payload()
    finally:
        await connector.close()
        await client.aclose()

    assert payload == PAYLOAD
    assert captured is not None
    assert captured.url.host == "8.8.8.8"
    assert captured.headers["host"] == "iklim.bmkg.go.id"
    assert captured.extensions["sni_hostname"] == "iklim.bmkg.go.id"


@pytest.mark.asyncio
async def test_connector_rejects_private_resolved_ip(monkeypatch):
    def reject(_):
        raise ValueError("Hostname iklim.bmkg.go.id resolves to blocked IP 127.0.0.1")

    monkeypatch.setattr("connectors.bmkg_air_quality.resolve_public_ips", reject)
    connector = BMKGAirQualityConnector(
        "https://iklim.bmkg.go.id/api/air-quality",
        client=httpx.AsyncClient(transport=httpx.MockTransport(lambda _: None)),
    )
    try:
        with pytest.raises(ValueError, match="blocked IP"):
            await connector.fetch_payload()
    finally:
        await connector.client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [302, 429, 503])
async def test_redirect_rate_limit_and_upstream_errors_are_rejected(monkeypatch, status):
    monkeypatch.setattr(
        "connectors.bmkg_air_quality.resolve_public_ips",
        lambda _: ("8.8.8.8",),
    )
    client = httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(
            status,
            headers={"Location": "https://evil.example/data"},
            request=request,
        )
    ))
    connector = BMKGAirQualityConnector(
        "https://iklim.bmkg.go.id/api/air-quality", client=client,
    )
    try:
        with pytest.raises(httpx.HTTPStatusError):
            await connector.fetch_payload()
    finally:
        await connector.close()
        await client.aclose()


@pytest.mark.asyncio
async def test_timeout_is_reported(monkeypatch):
    monkeypatch.setattr(
        "connectors.bmkg_air_quality.resolve_public_ips",
        lambda _: ("8.8.8.8",),
    )

    def timeout(request):
        raise httpx.ReadTimeout("timed out", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(timeout))
    connector = BMKGAirQualityConnector(
        "https://iklim.bmkg.go.id/api/air-quality", client=client,
    )
    try:
        with pytest.raises(httpx.ReadTimeout):
            await connector.fetch_payload()
    finally:
        await connector.close()
        await client.aclose()
