import unittest

import httpx

from connectors.petabencana_flood import PetaBencanaFloodConnector
from normalizers.petabencana import normalize_petabencana_feature


def _flood_feature(pkey: int, lon: float, lat: float, depth: int | None, text: str = "") -> dict:
    report_data = {"report_type": "flood"}
    if depth is not None:
        report_data["flood_depth"] = depth
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "pkey": pkey,
            "created_at": "2026-01-03T09:43:43.989Z",
            "disaster_type": "flood",
            "status": "confirmed",
            "url": "d9f926d0-34e8-4044-9fa3-e97bab06ac2b",
            "title": None,
            "text": text,
            "report_data": report_data,
        },
    }


class PetaBencanaNormalizerTests(unittest.TestCase):
    def test_normalize_maps_depth_to_proxy_magnitude(self) -> None:
        feature = _flood_feature(398415, 109.4214028748, 1.5610821716, depth=101)

        event = normalize_petabencana_feature(feature)

        self.assertEqual(event.event_id, "petabencana_398415")
        self.assertEqual(event.source, "petabencana")
        self.assertEqual(event.event_type, "flood")
        self.assertEqual(event.latitude, 1.5610821716)
        self.assertEqual(event.longitude, 109.4214028748)
        self.assertEqual(event.magnitude, 2.0)  # 70-150cm -> 2
        self.assertTrue(event.time.startswith("2026-01-03T"))

    def test_normalize_depth_buckets(self) -> None:
        self.assertEqual(normalize_petabencana_feature(_flood_feature(1, 110, -6, 50)).magnitude, 1.0)
        self.assertEqual(normalize_petabencana_feature(_flood_feature(2, 110, -6, 200)).magnitude, 3.0)
        self.assertEqual(normalize_petabencana_feature(_flood_feature(3, 110, -6, 400)).magnitude, 4.0)

    def test_normalize_defaults_magnitude_without_depth(self) -> None:
        event = normalize_petabencana_feature(_flood_feature(9, 110, -6, depth=None))
        self.assertEqual(event.magnitude, 2.0)


class PetaBencanaFloodConnectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_recent_returns_flood_reports_in_indonesia(self) -> None:
        payload = {
            "statusCode": 200,
            "result": {
                "type": "FeatureCollection",
                "features": [
                    _flood_feature(398415, 109.42, 1.56, depth=101),
                    # Non-flood report in the same feed must be ignored.
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [112.0, -7.0]},
                        "properties": {
                            "pkey": 398411,
                            "created_at": "2026-01-03T09:00:00.000Z",
                            "disaster_type": "wind",
                            "report_data": {"report_type": "wind"},
                        },
                    },
                    # Flood report outside the Indonesia bbox must be ignored.
                    _flood_feature(500000, 2.35, 48.85, depth=120),
                ],
            },
        }
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
        )
        connector = PetaBencanaFloodConnector(http_client=client)
        try:
            events = await connector.fetch_recent()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_id, "petabencana_398415")
        self.assertEqual(events[0].event_type, "flood")

    async def test_fetch_recent_handles_empty_feed(self) -> None:
        payload = {"statusCode": 200, "result": {"type": "FeatureCollection", "features": []}}
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
        )
        connector = PetaBencanaFloodConnector(http_client=client)
        try:
            events = await connector.fetch_recent()
        finally:
            await connector.close()
            await client.aclose()

        self.assertEqual(events, [])
