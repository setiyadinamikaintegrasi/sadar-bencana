import unittest

import httpx

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
    <headline>Peringatan Dini Cuaca Jawa Barat</headline>
    <description>Hujan lebat disertai angin kencang.</description>
    <area>
      <areaDesc>Jawa Barat</areaDesc>
      <polygon>-6.9,107.5 -6.7,107.8 -7.1,107.9</polygon>
    </area>
  </info>
</alert>
"""


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


class BMKGCAPConnectorTests(unittest.IsolatedAsyncioTestCase):
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
