import unittest

import httpx

from connectors.gvp_volcano import GVPVolcanoConnector
from normalizers.gvp import normalize_gvp_item


# A trimmed Smithsonian GVP Weekly Volcanic Activity Report feed: one
# Indonesian volcano (Dukono) and one outside the Indonesia bbox (Kilauea).
_SAMPLE_RSS = """<?xml version="1.0" encoding="ISO-8859-1"?>
<rss version="2.0" xmlns:georss="http://www.georss.org/georss">
  <channel>
    <title>Smithsonian / USGS Weekly Volcanic Activity Report</title>
    <item>
      <title>Dukono (Indonesia) - Report for 4 June-10 June 2026 - Continuing Eruptive Activity</title>
      <description>&lt;p&gt;PVMBG reported eruptive activity at Dukono. The Alert Level remained at Level 2 (on a scale of 1-4).&lt;/p&gt;</description>
      <link>https://volcano.si.edu/reports_weekly.cfm</link>
      <guid isPermaLink="true">https://volcano.si.edu/reports_weekly.cfm#vn_268010</guid>
      <pubDate>Thu, 11 Jun 2026 03:42:26 -0400</pubDate>
      <georss:point>1.6992 127.8783</georss:point>
    </item>
    <item>
      <title>Kilauea (United States) - Report for 4 June-10 June 2026 - Summit Eruption</title>
      <description>&lt;p&gt;HVO reported activity at Kilauea. The Aviation Color Code remained at Orange.&lt;/p&gt;</description>
      <link>https://volcano.si.edu/reports_weekly.cfm</link>
      <guid isPermaLink="true">https://volcano.si.edu/reports_weekly.cfm#vn_332010</guid>
      <pubDate>Thu, 11 Jun 2026 03:42:26 -0400</pubDate>
      <georss:point>19.421 -155.287</georss:point>
    </item>
  </channel>
</rss>"""


class GVPVolcanoNormalizerTests(unittest.TestCase):
    def test_normalize_parses_alert_level_coords_and_id(self) -> None:
        item = {
            "title": "Dukono (Indonesia) - Report for 4 June-10 June 2026 - Continuing Eruptive Activity",
            "description": "PVMBG reported activity. The Alert Level remained at Level 2 (on a scale of 1-4).",
            "guid": "https://volcano.si.edu/reports_weekly.cfm#vn_268010",
            "link": "https://volcano.si.edu/reports_weekly.cfm",
            "pubDate": "Thu, 11 Jun 2026 03:42:26 -0400",
            "point": "1.6992 127.8783",
        }

        event = normalize_gvp_item(item)

        self.assertEqual(event.event_id, "gvp_268010")
        self.assertEqual(event.source, "gvp")
        self.assertEqual(event.event_type, "volcano")
        self.assertEqual(event.place, "Dukono")
        self.assertEqual(event.latitude, 1.6992)
        self.assertEqual(event.longitude, 127.8783)
        self.assertEqual(event.magnitude, 2.0)
        self.assertTrue(event.time.startswith("2026-06-11T"))

    def test_normalize_defaults_magnitude_when_no_alert_level(self) -> None:
        item = {
            "title": "Semeru (Indonesia) - Report for 4 June-10 June 2026",
            "description": "Activity continued at Semeru.",
            "guid": "https://volcano.si.edu/reports_weekly.cfm#vn_263300",
            "link": "https://volcano.si.edu/reports_weekly.cfm",
            "pubDate": "Thu, 11 Jun 2026 03:42:26 -0400",
            "point": "-8.108 112.922",
        }

        event = normalize_gvp_item(item)

        self.assertEqual(event.event_id, "gvp_263300")
        self.assertEqual(event.magnitude, 2.0)


class GVPVolcanoConnectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_recent_filters_to_indonesia_bbox(self) -> None:
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, text=_SAMPLE_RSS)
            )
        )
        connector = GVPVolcanoConnector(http_client=client)
        try:
            events = await connector.fetch_recent()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.event_id, "gvp_268010")
        self.assertEqual(event.source, "gvp")
        self.assertEqual(event.event_type, "volcano")
        self.assertEqual(event.place, "Dukono")

    async def test_fetch_recent_handles_empty_feed(self) -> None:
        empty_rss = (
            '<?xml version="1.0"?><rss version="2.0">'
            "<channel><title>empty</title></channel></rss>"
        )
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, text=empty_rss)
            )
        )
        connector = GVPVolcanoConnector(http_client=client)
        try:
            events = await connector.fetch_recent()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(events, [])
