import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

import main as worker_main
from connectors.bmkg_cap import (
    BMKG_CAP_RSS_URL,
    BMKGCAPConnector,
    parse_bmkg_cap,
    parse_bmkg_cap_rss,
)


RSS_XML = """\
<rss version="2.0">
  <channel>
    <item><link>https://www.bmkg.go.id/cap/alert-1.xml</link></item>
    <item><link>https://www.bmkg.go.id/cap/alert-1.xml</link></item>
    <item><link>https://alerts.bmkg.go.id/cap/alert-2.xml</link></item>
    <item><link>https://evil.example/cap/stolen.xml</link></item>
    <item><link>http://www.bmkg.go.id/cap/insecure.xml</link></item>
  </channel>
</rss>
"""


def cap_xml(
    *,
    identifier: str = "BMKG-001",
    message_type: str = "Alert",
    references: str = "",
) -> str:
    reference_element = (
        f"<references>{references}</references>" if references else ""
    )
    return f"""\
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>{identifier}</identifier>
  <sender>nowcast@bmkg.go.id</sender>
  <sent>2026-06-30T10:00:00+07:00</sent>
  <status>Actual</status>
  <msgType>{message_type}</msgType>
  {reference_element}
  <info>
    <language>en-US</language>
    <event>Heavy rain</event>
    <headline>English headline</headline>
  </info>
  <info>
    <language>id-ID</language>
    <event>Hujan Lebat</event>
    <effective>2026-06-30T10:00:00+07:00</effective>
    <expires>2026-06-30T13:00:00+07:00</expires>
    <severity>Severe</severity>
    <headline>Peringatan Dini Cuaca Jawa Barat</headline>
    <description>Hujan lebat disertai angin kencang.</description>
    <area>
      <areaDesc>Jawa Barat</areaDesc>
      <polygon>-6.9,107.5 -6.7,107.8 -7.1,107.9</polygon>
    </area>
  </info>
</alert>
"""


def _setting(**overrides):
    values = {
        "enabled": True,
        "api_url": BMKG_CAP_RSS_URL,
        "api_token": "cap-token",
        "run_mode": "active",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class _CycleConnector:
    def __init__(self, alerts=None, errors=None, fetch_error=None):
        self.alerts = alerts or []
        self.errors = errors or []
        self.fetch_error = fetch_error
        self.closed = False

    async def fetch_active(self):
        if self.fetch_error is not None:
            raise self.fetch_error
        return self.alerts, self.errors

    async def close(self):
        self.closed = True


def _patch_cycle_dependencies(monkeypatch, *, setting, connector):
    dependencies = {
        "resolve_source_setting": AsyncMock(return_value=setting),
        "BMKGCAPConnector": MagicMock(return_value=connector),
        "create_source_record": AsyncMock(return_value=({"id": "source-1"}, True)),
        "record_observation": AsyncMock(),
        "upsert_official_alert": AsyncMock(
            return_value=({"id": "alert-1", "revision": 1}, True),
        ),
        "enqueue_official_alert_revision": AsyncMock(),
        "upsert_connector_health": AsyncMock(),
    }
    for name, value in dependencies.items():
        monkeypatch.setattr(worker_main, name, value)
    return dependencies


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "setting",
    [_setting(enabled=False), _setting(api_url=None)],
    ids=["disabled", "endpoint-missing"],
)
async def test_cycle_does_nothing_without_an_enabled_configured_source(
    monkeypatch,
    setting,
):
    connector = _CycleConnector()
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=setting,
        connector=connector,
    )

    result = await worker_main._bmkg_cap_cycle(object())

    assert result == 0
    dependencies["BMKGCAPConnector"].assert_not_called()
    dependencies["upsert_connector_health"].assert_not_awaited()


@pytest.mark.asyncio
async def test_dry_run_updates_health_without_persistence_or_delivery(monkeypatch):
    monkeypatch.setenv("EWS_LIFECYCLE_DELIVERY_ENABLED", "true")
    alert = parse_bmkg_cap(cap_xml())
    connector = _CycleConnector(
        alerts=[alert],
        errors=["detail alert-2: upstream unavailable"],
    )
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=_setting(run_mode="dry_run"),
        connector=connector,
    )
    pool = object()

    result = await worker_main._bmkg_cap_cycle(pool)

    assert result == 0
    dependencies["upsert_connector_health"].assert_awaited_once_with(
        pool,
        "bmkg_cap",
        1,
        "detail alert-2: upstream unavailable",
    )
    for name in (
        "create_source_record",
        "record_observation",
        "upsert_official_alert",
        "enqueue_official_alert_revision",
    ):
        dependencies[name].assert_not_awaited()
    assert connector.closed


@pytest.mark.asyncio
async def test_active_cycle_persists_observations_and_enqueues_new_alert(monkeypatch):
    monkeypatch.setenv("EWS_LIFECYCLE_DELIVERY_ENABLED", "true")
    alert = parse_bmkg_cap(cap_xml())
    connector = _CycleConnector(alerts=[alert])
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=_setting(),
        connector=connector,
    )
    pool = object()

    result = await worker_main._bmkg_cap_cycle(pool)

    assert result == 1
    dependencies["create_source_record"].assert_awaited_once()
    assert dependencies["record_observation"].await_count == 2
    dependencies["upsert_official_alert"].assert_awaited_once_with(pool, alert)
    dependencies["enqueue_official_alert_revision"].assert_awaited_once_with(
        pool,
        {"id": "alert-1", "revision": 1},
    )
    dependencies["upsert_connector_health"].assert_awaited_once_with(
        pool,
        "bmkg_cap",
        1,
        None,
    )
    assert connector.closed


@pytest.mark.asyncio
async def test_environment_fallback_remains_active_compatible(monkeypatch):
    monkeypatch.setenv("CONNECTOR_BMKG_CAP_ENABLED", "true")
    alert = parse_bmkg_cap(cap_xml())
    connector = _CycleConnector(alerts=[alert])
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=None,
        connector=connector,
    )

    result = await worker_main._bmkg_cap_cycle(object())

    assert result == 1
    dependencies["BMKGCAPConnector"].assert_called_once_with(
        rss_url="https://www.bmkg.go.id/alerts/nowcast/id",
        api_token=None,
    )
    dependencies["create_source_record"].assert_awaited_once()
    dependencies["upsert_official_alert"].assert_awaited_once()
    assert connector.closed


@pytest.mark.asyncio
async def test_cycle_fetch_failure_updates_health_without_persistence(monkeypatch):
    connector = _CycleConnector(fetch_error=RuntimeError("upstream unavailable"))
    dependencies = _patch_cycle_dependencies(
        monkeypatch,
        setting=_setting(),
        connector=connector,
    )
    pool = object()

    result = await worker_main._bmkg_cap_cycle(pool)

    assert result == 0
    dependencies["upsert_connector_health"].assert_awaited_once_with(
        pool,
        "bmkg_cap",
        0,
        "upstream unavailable",
    )
    for name in (
        "create_source_record",
        "record_observation",
        "upsert_official_alert",
        "enqueue_official_alert_revision",
    ):
        dependencies[name].assert_not_awaited()
    assert connector.closed


class BMKGCAPParserTests(unittest.TestCase):
    def test_rss_deduplicates_and_rejects_non_bmkg_urls(self) -> None:
        self.assertEqual(
            parse_bmkg_cap_rss(RSS_XML),
            [
                "https://www.bmkg.go.id/cap/alert-1.xml",
                "https://alerts.bmkg.go.id/cap/alert-2.xml",
            ],
        )

    def test_parse_prefers_indonesian_info_and_normalizes_polygon(self) -> None:
        alert = parse_bmkg_cap(cap_xml())

        self.assertEqual(alert.source_alert_id, "BMKG-001")
        self.assertEqual(alert.message_type, "alert")
        self.assertEqual(alert.status, "active")
        self.assertEqual(alert.headline, "Peringatan Dini Cuaca Jawa Barat")
        self.assertEqual(alert.peril_type, "weather")
        self.assertEqual(alert.severity, "High")
        self.assertEqual(alert.area_name, "Jawa Barat")
        self.assertIsNone(alert.source_url)
        self.assertEqual(alert.sent_at.utcoffset().total_seconds(), 7 * 3600)
        self.assertEqual(
            alert.area_geojson,
            {
                "type": "Polygon",
                "coordinates": [
                    [
                        [107.5, -6.9],
                        [107.8, -6.7],
                        [107.9, -7.1],
                        [107.5, -6.9],
                    ]
                ],
            },
        )

    def test_cancel_uses_original_referenced_identifier(self) -> None:
        alert = parse_bmkg_cap(
            cap_xml(
                identifier="BMKG-003",
                message_type="Cancel",
                references=(
                    "nowcast@bmkg.go.id,BMKG-001,"
                    "2026-06-30T10:00:00+07:00"
                ),
            )
        )

        self.assertEqual(alert.source_alert_id, "BMKG-001")
        self.assertEqual(alert.message_type, "cancel")
        self.assertEqual(alert.status, "cancelled")
        self.assertEqual(alert.raw_payload["message_identifier"], "BMKG-003")

    def test_rejects_missing_required_fields_and_naive_timestamp(self) -> None:
        with self.assertRaisesRegex(ValueError, "identifier and sent"):
            parse_bmkg_cap("<alert><sent>2026-06-30T10:00:00Z</sent></alert>")
        with self.assertRaisesRegex(ValueError, "include a timezone"):
            parse_bmkg_cap(cap_xml().replace("+07:00</sent>", "</sent>"))

    def test_area_name_deduplicates_in_first_seen_order(self) -> None:
        alert = parse_bmkg_cap(
            cap_xml().replace(
                """    <area>
      <areaDesc>Jawa Barat</areaDesc>
      <polygon>-6.9,107.5 -6.7,107.8 -7.1,107.9</polygon>
    </area>""",
                """    <area><areaDesc>Jawa Barat</areaDesc></area>
    <area><areaDesc>Banten</areaDesc></area>
    <area><areaDesc>Jawa Barat</areaDesc></area>
    <area><areaDesc>DKI Jakarta</areaDesc></area>""",
            )
        )

        self.assertEqual(alert.area_name, "Jawa Barat; Banten; DKI Jakarta")


@pytest.mark.parametrize(
    ("cap_value", "expected"),
    [
        ("Minor", "Moderate"),
        ("Moderate", "Moderate"),
        ("Severe", "High"),
        ("Extreme", "Critical"),
    ],
)
def test_cap_severity_mapping(cap_value, expected):
    alert = parse_bmkg_cap(
        cap_xml().replace(
            "<severity>Severe</severity>",
            "<severity>" + cap_value + "</severity>",
        )
    )
    assert alert.severity == expected


def test_cap_missing_severity_is_not_deliverable():
    alert = parse_bmkg_cap(cap_xml().replace("<severity>Severe</severity>", ""))
    assert alert.severity is None


class BMKGCAPConnectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_follows_bmkg_redirects_and_uses_final_detail_url(self) -> None:
        final_rss_url = "https://alerts.bmkg.go.id/alerts/nowcast/id"
        final_detail_url = "https://alerts.bmkg.go.id/cap/alert-1.xml"

        def handler(request: httpx.Request) -> httpx.Response:
            if str(request.url) == BMKG_CAP_RSS_URL:
                return httpx.Response(302, headers={"location": final_rss_url})
            if str(request.url) == final_rss_url:
                return httpx.Response(200, text=RSS_XML)
            if request.url.path.endswith("alert-1.xml"):
                if str(request.url) == final_detail_url:
                    return httpx.Response(200, text=cap_xml())
                return httpx.Response(302, headers={"location": final_detail_url})
            if request.url.host == "evil.example":
                return httpx.Response(200, text="<not-alert />")
            return httpx.Response(
                302,
                headers={"location": "https://evil.example/cap/stolen.xml"},
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = BMKGCAPConnector(http_client=client)
        try:
            alerts, errors = await connector.fetch_active()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(len(alerts), 1)
        self.assertEqual(len(errors), 1)
        self.assertIn("BMKG HTTPS", errors[0])
        self.assertEqual(alerts[0].source_url, final_detail_url)
        self.assertEqual(alerts[0].raw_payload["source_url"], final_detail_url)

    async def test_rejects_rss_redirect_to_non_bmkg_url(self) -> None:
        external_rss_url = "https://evil.example/alerts/nowcast/id"

        def handler(request: httpx.Request) -> httpx.Response:
            if str(request.url) == BMKG_CAP_RSS_URL:
                return httpx.Response(302, headers={"location": external_rss_url})
            return httpx.Response(200, text=RSS_XML)

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = BMKGCAPConnector(http_client=client)
        try:
            with self.assertRaisesRegex(ValueError, "BMKG HTTPS"):
                await connector.fetch_active()
        finally:
            await connector.close()
            await client.aclose()

    async def test_partial_detail_failure_keeps_successful_alerts(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if str(request.url) == BMKG_CAP_RSS_URL:
                return httpx.Response(200, text=RSS_XML)
            if request.url.path.endswith("alert-1.xml"):
                return httpx.Response(200, text=cap_xml())
            return httpx.Response(503, text="upstream unavailable")

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = BMKGCAPConnector(http_client=client)
        try:
            alerts, errors = await connector.fetch_active()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(len(alerts), 1)
        self.assertEqual(len(errors), 1)
        self.assertEqual(
            alerts[0].raw_payload["source_url"],
            "https://www.bmkg.go.id/cap/alert-1.xml",
        )
        self.assertEqual(
            alerts[0].source_url,
            "https://www.bmkg.go.id/cap/alert-1.xml",
        )
