import unittest

import httpx

from connectors.nasa_firms import NASAFIRMSConnector
from normalizers.firms import confidence_score, normalize_firms_row


CSV_TEXT = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
-6.2000,106.8000,340.0,0.5,0.4,2026-06-22,0130,N20,nominal,2.0NRT,300.0,150.0,D
24.7000,141.3000,330.0,0.5,0.4,2026-06-22,0135,N20,high,2.0NRT,301.0,200.0,D
-7.5000,110.4000,320.0,0.5,0.4,2026-06-22,0140,N20,low,2.0NRT,299.0,90.0,D
-8.6000,116.1000,350.0,0.5,0.4,2026-06-22,0145,N20,85,2.0NRT,302.0,250.0,D
"""


class NASAFIRMSConnectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_recent_filters_bbox_and_confidence(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(
                request.headers.get("User-Agent"),
                "Mozilla/5.0 (compatible; sadar-bencana/1.0)",
            )
            return httpx.Response(200, text=CSV_TEXT)

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = NASAFIRMSConnector(http_client=client)
        try:
            events = await connector.fetch_recent()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(len(events), 2)
        # sorted by FRP desc
        self.assertEqual(events[0].event_id, "firms_2026-06-22_0145_-8.600_116.100")
        self.assertEqual(events[0].magnitude, 5.0)
        self.assertEqual(events[1].event_id, "firms_2026-06-22_0130_-6.200_106.800")
        self.assertEqual(events[1].event_type, "wildfire")
        self.assertEqual(events[1].source, "nasa_firms")


class FIRMSNormalizerTests(unittest.TestCase):
    def test_normalize_row_maps_frp_to_proxy_magnitude(self) -> None:
        event = normalize_firms_row(
            {
                "latitude": "-6.2",
                "longitude": "106.8",
                "acq_date": "2026-06-22",
                "acq_time": "130",
                "frp": "150.0",
            }
        )

        self.assertEqual(event.event_id, "firms_2026-06-22_0130_-6.200_106.800")
        self.assertEqual(event.source, "nasa_firms")
        self.assertEqual(event.event_type, "wildfire")
        self.assertEqual(event.magnitude, 3.0)
        self.assertEqual(event.place, "Hotspot 6.20°S 106.80°E")
        self.assertTrue(event.time.startswith("2026-06-22T01:30:00"))

    def test_confidence_score_supports_text_and_numeric_values(self) -> None:
        self.assertEqual(confidence_score("low"), 30)
        self.assertEqual(confidence_score("nominal"), 70)
        self.assertEqual(confidence_score("high"), 90)
        self.assertEqual(confidence_score("85"), 85)
