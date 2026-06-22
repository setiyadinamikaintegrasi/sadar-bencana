import unittest

import httpx

from connectors.rss_news import (
    RSSNewsConnector,
    RSS_USER_AGENT,
    _infer_perils,
    _make_item_id,
    _parse_rss,
)


RSS_XML = """<?xml version='1.0' encoding='UTF-8'?>
<rss version='2.0'>
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Gempa kuat guncang Maluku</title>
      <link>https://example.test/gempa-maluku</link>
      <description><![CDATA[BMKG melaporkan gempa dan banjir susulan kecil.]]></description>
      <pubDate>Mon, 22 Jun 2026 10:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Karhutla meluas di Sumatra</title>
      <guid>https://example.test/karhutla</guid>
      <description><![CDATA[Hotspot baru terdeteksi di beberapa area.]]></description>
      <pubDate>2026-06-22T11:00:00Z</pubDate>
    </item>
  </channel>
</rss>
"""

ATOM_XML = """<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom'>
  <entry>
    <title>Erupsi gunung api meningkat</title>
    <link href='https://example.test/erupsi'/>
    <summary>Aktivitas magma naik signifikan.</summary>
    <updated>2026-06-22T12:00:00Z</updated>
  </entry>
</feed>
"""


class RSSNewsParserTests(unittest.TestCase):
    def test_parse_rss_extracts_items_and_infers_perils(self) -> None:
        items = _parse_rss("antara", RSS_XML)

        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].item_id, _make_item_id("antara", "https://example.test/gempa-maluku"))
        self.assertEqual(items[0].perils, ["earthquake", "flood"])
        self.assertTrue(items[0].published_at.startswith("2026-06-22T10:30:00+00:00"))
        self.assertEqual(items[1].perils, ["wildfire"])

    def test_parse_atom_handles_namespaced_entries(self) -> None:
        items = _parse_rss("tempo", ATOM_XML)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].url, "https://example.test/erupsi")
        self.assertEqual(items[0].perils, ["volcano"])

    def test_parse_error_returns_empty_list(self) -> None:
        self.assertEqual(_parse_rss("cnn", "<rss><broken>"), [])

    def test_infer_perils_returns_multiple_matches(self) -> None:
        perils = _infer_perils("Gempa picu banjir", "Karhutla tak terkait")
        self.assertEqual(perils, ["earthquake", "flood", "wildfire"])


class RSSNewsConnectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_all_skips_failed_feeds_and_keeps_successes(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers.get("User-Agent"), RSS_USER_AGENT)
            if "antaranews" in str(request.url):
                return httpx.Response(200, text=RSS_XML)
            if "cnnindonesia" in str(request.url):
                return httpx.Response(200, text=ATOM_XML)
            return httpx.Response(503, text="upstream down")

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = RSSNewsConnector(http_client=client)
        try:
            items = await connector.fetch_all()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(len(items), 3)
        self.assertEqual({item.source for item in items}, {"antara", "cnn"})
