import unittest

from connectors.hazard import HazardConnector
from models.event import EarthquakeEvent


class _StubConnector:
    def __init__(self, events=None, error=None):
        self._events = events or []
        self._error = error
        self.closed = False

    async def fetch_recent(self):
        if self._error:
            raise self._error
        return self._events

    async def close(self):
        self.closed = True


def _event(event_id: str, event_type: str) -> EarthquakeEvent:
    return EarthquakeEvent(
        event_id=event_id,
        source=f"src_{event_type}",
        event_type=event_type,
        magnitude=2.0,
        latitude=-6.2,
        longitude=106.8,
        place="Jakarta",
        time="2026-06-22T00:00:00+00:00",
        url="https://example.test",
    )


class HazardConnectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_recent_merges_all_three_sources(self) -> None:
        connector = HazardConnector(
            flood=_StubConnector([_event("f1", "flood")]),
            volcano=_StubConnector([_event("v1", "volcano")]),
            wildfire=_StubConnector([_event("w1", "wildfire"), _event("w2", "wildfire")]),
        )

        events = await connector.fetch_recent()

        self.assertEqual([e.event_id for e in events], ["f1", "v1", "w1", "w2"])

    async def test_fetch_recent_tolerates_partial_failure(self) -> None:
        connector = HazardConnector(
            flood=_StubConnector(error=RuntimeError("flood down")),
            volcano=_StubConnector([_event("v1", "volcano")]),
            wildfire=_StubConnector([]),
        )

        events = await connector.fetch_recent()

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_type, "volcano")

    async def test_fetch_recent_raises_when_all_sources_fail(self) -> None:
        connector = HazardConnector(
            flood=_StubConnector(error=RuntimeError("flood down")),
            volcano=_StubConnector(error=RuntimeError("volcano down")),
            wildfire=_StubConnector(error=RuntimeError("wildfire down")),
        )

        with self.assertRaises(RuntimeError) as ctx:
            await connector.fetch_recent()

        self.assertIn("All hazard sources failed", str(ctx.exception))

    async def test_close_closes_all_children(self) -> None:
        flood = _StubConnector()
        volcano = _StubConnector()
        wildfire = _StubConnector()
        connector = HazardConnector(flood=flood, volcano=volcano, wildfire=wildfire)

        await connector.close()

        self.assertTrue(flood.closed)
        self.assertTrue(volcano.closed)
        self.assertTrue(wildfire.closed)
