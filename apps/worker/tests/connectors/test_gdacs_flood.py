import unittest

import httpx

from connectors.gdacs_flood import GDACSFloodConnector
from normalizers.gdacs import normalize_gdacs_feature


class GDACSFloodConnectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_recent_filters_to_indonesia_bbox(self) -> None:
        payload = {
            "features": [
                {
                    "properties": {
                        "eventid": 123,
                        "name": "Jakarta Flood",
                        "alertscore": 2.7,
                        "todate": "2026-06-22T10:00:00.000Z",
                        "url": "https://gdacs.org/events/123",
                    },
                    "geometry": {"coordinates": [106.8, -6.2]},
                },
                {
                    "properties": {
                        "eventid": 999,
                        "name": "Bangkok Flood",
                        "alertscore": 3.2,
                        "todate": "2026-06-22T10:00:00.000Z",
                    },
                    "geometry": {"coordinates": [100.5, 13.7]},
                },
            ]
        }

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers.get("User-Agent"), "Mozilla/5.0 (compatible; sadar-bencana/1.0)")
            return httpx.Response(200, json=payload)

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        connector = GDACSFloodConnector(http_client=client)
        try:
            events = await connector.fetch_recent()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.event_id, "gdacs_fl_123")
        self.assertEqual(event.source, "gdacs_fl")
        self.assertEqual(event.event_type, "flood")
        self.assertEqual(event.place, "Jakarta Flood")
        self.assertEqual(event.magnitude, 3.0)
        self.assertEqual(event.url, "https://gdacs.org/events/123")

    async def test_fetch_recent_handles_empty_204(self) -> None:
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(204))
        )
        connector = GDACSFloodConnector(http_client=client)
        try:
            events = await connector.fetch_recent()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(events, [])


class GDACSFloodNormalizerTests(unittest.TestCase):
    def test_normalize_maps_alertscore_to_proxy_magnitude(self) -> None:
        feature = {
            "properties": {
                "eventid": 321,
                "name": "Palu Flood",
                "alertscore": 1.6,
                "todate": "22/06/2026",
                "url": "https://gdacs.org/events/321",
            },
            "geometry": {"coordinates": [119.85, -0.89]},
        }

        event = normalize_gdacs_feature(feature, "flood")

        self.assertEqual(event.event_id, "gdacs_fl_321")
        self.assertEqual(event.magnitude, 2.0)
        self.assertEqual(event.latitude, -0.89)
        self.assertEqual(event.longitude, 119.85)
        self.assertTrue(event.time.startswith("2026-06-22T00:00:00"))
