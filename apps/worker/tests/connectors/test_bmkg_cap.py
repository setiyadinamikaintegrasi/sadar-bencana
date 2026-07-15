import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock, patch

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
    status: str = "Actual",
    scope: str = "Public",
    include_info: bool = True,
) -> str:
    reference_element = (
        f"<references>{references}</references>" if references else ""
    )
    info_blocks = """\
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
  </info>""" if include_info else ""
    return f"""\
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>{identifier}</identifier>
  <sender>nowcast@bmkg.go.id</sender>
  <sent>2026-06-30T10:00:00+07:00</sent>
  <status>{status}</status>
  <msgType>{message_type}</msgType>
  <scope>{scope}</scope>
  {reference_element}
  {info_blocks}
</alert>
"""


def _setting(**overrides):
    values = {
        "enabled": True,
        "api_url": BMKG_CAP_RSS_URL,
        "api_token": "cap-token",
        "run_mode": "active",
        "config_version": 7,
        "poll_interval_seconds": 600,
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


@asynccontextmanager
async def _poll_slot(*_args, allowed=True, **_kwargs):
    yield SimpleNamespace(source_name="bmkg_cap", connection=object()) if allowed else None


def _patch_cycle_dependencies(monkeypatch, *, setting, connector):
    zero_counts = {
        "official_alerts": 0,
        "air_quality_observations": 0,
        "ews_notification_log": 0,
        "source_records": 0,
        "disaster_observability_events": 0,
    }
    dependencies = {
        "resolve_source_setting": AsyncMock(return_value=setting),
        "acquire_source_poll_slot": MagicMock(side_effect=_poll_slot),
        "complete_source_poll": AsyncMock(),
        "BMKGCAPConnector": MagicMock(return_value=connector),
        "create_source_record": AsyncMock(return_value=({"id": "source-1"}, True)),
        "record_observation": AsyncMock(),
        "upsert_official_alert": AsyncMock(
            return_value=({"id": "alert-1", "revision": 1}, True),
        ),
        "enqueue_official_alert_revision": AsyncMock(),
        "persist_official_alert_revision": AsyncMock(
            return_value=({"id": "alert-1", "revision": 1}, True, True),
        ),
        "capture_worker_shadow_persistence_counts": AsyncMock(
            return_value=zero_counts,
        ),
        "record_worker_shadow_evidence": AsyncMock(),
        "_official_alert_topology_errors": AsyncMock(return_value=[]),
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
    dependencies["complete_source_poll"].assert_awaited_once_with(
        ANY,
        items_fetched=1,
        error_message="detail alert-2: upstream unavailable",
    )
    for name in (
        "create_source_record",
        "record_observation",
        "upsert_official_alert",
        "enqueue_official_alert_revision",
        "persist_official_alert_revision",
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
    dependencies["create_source_record"].assert_not_awaited()
    assert dependencies["record_observation"].await_count == 2
    dependencies["upsert_official_alert"].assert_not_awaited()
    dependencies["enqueue_official_alert_revision"].assert_not_awaited()
    persist = dependencies["persist_official_alert_revision"]
    persist.assert_awaited_once()
    assert persist.await_args.args == (pool, alert)
    assert persist.await_args.kwargs["source_name"] == "bmkg_cap"
    assert persist.await_args.kwargs["expected_config_version"] == 7
    dependencies["complete_source_poll"].assert_awaited_once_with(
        ANY,
        items_fetched=1,
        error_message=None,
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
    dependencies["complete_source_poll"].assert_awaited_once_with(
        ANY,
        items_fetched=0,
        error_message="upstream unavailable",
    )
    for name in (
        "create_source_record",
        "record_observation",
        "upsert_official_alert",
        "enqueue_official_alert_revision",
        "persist_official_alert_revision",
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

    def test_chain_preserves_each_message_identity_and_immediate_reference(self) -> None:
        chain = [
            parse_bmkg_cap(cap_xml(identifier="A")),
            parse_bmkg_cap(
                cap_xml(
                    identifier="B",
                    message_type="Update",
                    references="nowcast@bmkg.go.id,A,2026-06-30T10:00:00+07:00",
                )
            ),
            parse_bmkg_cap(
                cap_xml(
                    identifier="C",
                    message_type="Update",
                    references="nowcast@bmkg.go.id,B,2026-06-30T10:00:00+07:00",
                )
            ),
            parse_bmkg_cap(
                cap_xml(
                    identifier="D",
                    message_type="Cancel",
                    references="nowcast@bmkg.go.id,C,2026-06-30T10:00:00+07:00",
                )
            ),
        ]

        self.assertEqual([alert.source_alert_id for alert in chain], ["A", "B", "C", "D"])
        self.assertEqual(
            [alert.raw_payload["referenced_message_identifiers"] for alert in chain],
            [[], ["A"], ["B"], ["C"]],
        )
        self.assertEqual(
            chain[-1].raw_payload["references"],
            [
                {
                    "sender": "nowcast@bmkg.go.id",
                    "identifier": "C",
                    "sent": "2026-06-30T10:00:00+07:00",
                }
            ],
        )

    def test_accepts_cancel_without_info_using_referenced_identity(self) -> None:
        alert = parse_bmkg_cap(
            cap_xml(
                identifier="BMKG-CANCEL-1",
                message_type="Cancel",
                references=(
                    "nowcast@bmkg.go.id,BMKG-UPDATE-1,"
                    "2026-06-30T10:00:00+07:00"
                ),
                include_info=False,
            )
        )

        self.assertEqual(alert.source_alert_id, "BMKG-CANCEL-1")
        self.assertEqual(alert.message_type, "cancel")
        self.assertEqual(alert.status, "cancelled")
        self.assertEqual(
            alert.raw_payload["referenced_message_identifiers"],
            ["BMKG-UPDATE-1"],
        )
        self.assertIsNone(alert.headline)
        self.assertIsNone(alert.description)
        self.assertIsNone(alert.area_geojson)

    def test_rejects_cancel_without_a_valid_reference(self) -> None:
        invalid_references = (
            "",
            "not-a-cap-reference",
            "nowcast@bmkg.go.id,,2026-06-30T10:00:00+07:00",
            "nowcast@bmkg.go.id,BMKG-001,not-a-timestamp",
        )
        for references in invalid_references:
            with self.subTest(references=references):
                with self.assertRaisesRegex(ValueError, "valid CAP reference"):
                    parse_bmkg_cap(
                        cap_xml(
                            identifier="BMKG-CANCEL-INVALID",
                            message_type="Cancel",
                            references=references,
                            include_info=False,
                        )
                    )

    def test_rejects_non_production_cancel_without_info(self) -> None:
        reference = "nowcast@bmkg.go.id,BMKG-001,2026-06-30T10:00:00+07:00"
        for field, value, expected_error in (
            ("status", "Test", "status must be Actual"),
            ("status", "Exercise", "status must be Actual"),
            ("status", "Draft", "status must be Actual"),
            ("scope", "Restricted", "scope must be Public"),
            ("scope", "Private", "scope must be Public"),
        ):
            with self.subTest(field=field, value=value):
                arguments = {
                    "identifier": "BMKG-CANCEL-NONPROD",
                    "message_type": "Cancel",
                    "references": reference,
                    "include_info": False,
                    field: value,
                }
                with self.assertRaisesRegex(ValueError, expected_error):
                    parse_bmkg_cap(cap_xml(**arguments))

    def test_rejects_missing_required_fields_and_naive_timestamp(self) -> None:
        with self.assertRaisesRegex(ValueError, "identifier and sent"):
            parse_bmkg_cap("<alert><sent>2026-06-30T10:00:00Z</sent></alert>")
        with self.assertRaisesRegex(ValueError, "include a timezone"):
            parse_bmkg_cap(cap_xml().replace("+07:00</sent>", "</sent>"))

    def test_rejects_non_production_status_and_scope(self) -> None:
        for status in ("Test", "Exercise", "Draft"):
            with self.subTest(status=status):
                with self.assertRaisesRegex(ValueError, "status must be Actual"):
                    parse_bmkg_cap(cap_xml(status=status))

        for scope in ("Restricted", "Private"):
            with self.subTest(scope=scope):
                with self.assertRaisesRegex(ValueError, "scope must be Public"):
                    parse_bmkg_cap(cap_xml(scope=scope))

    def test_rejects_missing_status_or_scope(self) -> None:
        with self.assertRaisesRegex(ValueError, "status must be Actual"):
            parse_bmkg_cap(cap_xml().replace("<status>Actual</status>", ""))
        with self.assertRaisesRegex(ValueError, "scope must be Public"):
            parse_bmkg_cap(cap_xml().replace("<scope>Public</scope>", ""))

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
            host = request.headers["Host"]
            if host == "www.bmkg.go.id" and request.url.path == "/alerts/nowcast/id":
                return httpx.Response(302, headers={"location": final_rss_url})
            if host == "alerts.bmkg.go.id" and request.url.path == "/alerts/nowcast/id":
                return httpx.Response(200, text=RSS_XML)
            if request.url.path.endswith("alert-1.xml"):
                if host == "alerts.bmkg.go.id":
                    return httpx.Response(200, text=cap_xml())
                return httpx.Response(302, headers={"location": final_detail_url})
            return httpx.Response(
                302,
                headers={"location": "https://evil.example/cap/stolen.xml"},
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = BMKGCAPConnector(http_client=client)
        try:
            with patch(
                "connectors.bmkg_cap.resolve_public_ips",
                return_value=("8.8.8.8",),
            ):
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
            if request.headers["Host"] == "www.bmkg.go.id":
                return httpx.Response(302, headers={"location": external_rss_url})
            return httpx.Response(200, text=RSS_XML)

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = BMKGCAPConnector(http_client=client)
        try:
            with patch(
                "connectors.bmkg_cap.resolve_public_ips",
                return_value=("8.8.8.8",),
            ) as resolver:
                with self.assertRaisesRegex(ValueError, "BMKG HTTPS"):
                    await connector.fetch_active()
            resolver.assert_called_once_with("www.bmkg.go.id")
        finally:
            await connector.close()
            await client.aclose()

    async def test_partial_detail_failure_keeps_successful_alerts(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/alerts/nowcast/id":
                return httpx.Response(200, text=RSS_XML)
            if request.url.path.endswith("alert-1.xml"):
                return httpx.Response(200, text=cap_xml())
            return httpx.Response(503, text="upstream unavailable")

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = BMKGCAPConnector(http_client=client)
        try:
            with patch(
                "connectors.bmkg_cap.resolve_public_ips",
                return_value=("8.8.8.8",),
            ):
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


@pytest.mark.asyncio
async def test_connector_rejects_unsafe_initial_dns_before_request(monkeypatch):
    requests = []

    def reject(_hostname):
        raise ValueError("Hostname www.bmkg.go.id resolves to blocked IP 127.0.0.1")

    monkeypatch.setattr("connectors.bmkg_cap.resolve_public_ips", reject)
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: requests.append(request))
    )
    connector = BMKGCAPConnector(http_client=client)
    try:
        with pytest.raises(ValueError, match="blocked IP"):
            await connector.fetch_active()
    finally:
        await client.aclose()

    assert requests == []


@pytest.mark.asyncio
async def test_connector_validates_unapproved_redirect_before_dns_or_request(monkeypatch):
    resolved_hosts = []
    requests = []

    def resolve(hostname):
        resolved_hosts.append(hostname)
        return ("8.8.8.8",)

    def handler(request):
        requests.append(request)
        return httpx.Response(
            302,
            headers={"Location": "https://evil.example/cap.xml"},
            request=request,
        )

    monkeypatch.setattr("connectors.bmkg_cap.resolve_public_ips", resolve)
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    connector = BMKGCAPConnector(http_client=client)
    try:
        with pytest.raises(ValueError, match="BMKG HTTPS"):
            await connector.fetch_active()
    finally:
        await client.aclose()

    assert resolved_hosts == ["www.bmkg.go.id"]
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_connector_rejects_private_redirect_dns_before_second_request(monkeypatch):
    requests = []

    def resolve(hostname):
        if hostname == "private.bmkg.go.id":
            raise ValueError(
                "Hostname private.bmkg.go.id resolves to blocked IP 10.0.0.7"
            )
        return ("8.8.8.8",)

    def handler(request):
        requests.append(request)
        return httpx.Response(
            302,
            headers={"Location": "https://private.bmkg.go.id/nowcast"},
            request=request,
        )

    monkeypatch.setattr("connectors.bmkg_cap.resolve_public_ips", resolve)
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    connector = BMKGCAPConnector(http_client=client)
    try:
        with pytest.raises(ValueError, match="blocked IP"):
            await connector.fetch_active()
    finally:
        await client.aclose()

    assert len(requests) == 1


@pytest.mark.asyncio
async def test_connector_pins_each_approved_redirect_hop(monkeypatch):
    requests = []
    resolved = {
        "www.bmkg.go.id": ("8.8.8.8",),
        "alerts.bmkg.go.id": ("1.1.1.1",),
    }

    def handler(request):
        requests.append(request)
        if request.headers["Host"] == "www.bmkg.go.id":
            return httpx.Response(
                302,
                headers={"Location": "https://alerts.bmkg.go.id/nowcast"},
                request=request,
            )
        return httpx.Response(200, text="<rss><channel /></rss>", request=request)

    monkeypatch.setattr(
        "connectors.bmkg_cap.resolve_public_ips", lambda host: resolved[host]
    )
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    connector = BMKGCAPConnector(http_client=client)
    try:
        alerts, errors = await connector.fetch_active()
    finally:
        await client.aclose()

    assert alerts == []
    assert errors == []
    assert [request.url.host for request in requests] == ["8.8.8.8", "1.1.1.1"]
    assert [request.headers["Host"] for request in requests] == [
        "www.bmkg.go.id",
        "alerts.bmkg.go.id",
    ]
    assert [request.extensions["sni_hostname"] for request in requests] == [
        "www.bmkg.go.id",
        "alerts.bmkg.go.id",
    ]
