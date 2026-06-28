import unittest

import httpx

from connectors.gdacs_volcano import GDACSVolcanoConnector
from normalizers.gdacs import normalize_gdacs_feature


class GDACSVolcanoConnectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_recent_filters_to_indonesia_bbox(self) -> None:
        payload = {
            "features": [
                {
                    "properties": {
                        "eventid": 456,
                        "name": "Gunung Lewotobi",
                        "alertlevel": "Red",
                        "todate": "2026-06-22T10:00:00.000Z",
                        "url": "https://gdacs.org/events/456",
                    },
                    "geometry": {"coordinates": [122.78, -8.53]},
                },
                {
                    "properties": {
                        "eventid": 654,
                        "name": "Fuji",
                        "alertlevel": "Orange",
                        "todate": "2026-06-22T10:00:00.000Z",
                    },
                    "geometry": {"coordinates": [138.73, 35.36]},
                },
            ]
        }

        client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
        )
        connector = GDACSVolcanoConnector(http_client=client)
        try:
            events = await connector.fetch_recent()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.event_id, "gdacs_vo_456")
        self.assertEqual(event.source, "gdacs_vo")
        self.assertEqual(event.event_type, "volcano")
        self.assertEqual(event.place, "Gunung Lewotobi")
        self.assertEqual(event.magnitude, 4.0)

    async def test_fetch_recent_handles_empty_feature_set(self) -> None:
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"features": []}))
        )
        connector = GDACSVolcanoConnector(http_client=client)
        try:
            events = await connector.fetch_recent()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(events, [])


class GDACSVolcanoNormalizerTests(unittest.TestCase):
    def test_normalize_maps_alertlevel_to_proxy_magnitude(self) -> None:
        feature = {
            "properties": {
                "eventid": 777,
                "name": "Merapi",
                "alertlevel": "Orange",
                "todate": "2026-06-22T03:21:00.000Z",
            },
            "geometry": {"coordinates": [110.44, -7.54]},
        }

        event = normalize_gdacs_feature(feature, "volcano")

        self.assertEqual(event.event_id, "gdacs_vo_777")
        self.assertEqual(event.magnitude, 3.0)
        self.assertEqual(event.latitude, -7.54)
        self.assertEqual(event.longitude, 110.44)
        self.assertTrue(event.time.startswith("2026-06-22T03:21:00"))
