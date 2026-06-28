"""End-to-end-ish tests for the EWS dispatch pipeline.

These exercise ``dispatch_alert`` through its full decision tree — geo-matching,
global watchers, severity filtering, dedup and quiet hours — by patching the DB
helper functions and channel adapters it depends on. This keeps the test
deterministic and runnable inside the worker venv (which ships without pytest or
a live test database), while still covering the integration scenarios from the
EWS plan (Phase 5, Task 5.1).
"""

import unittest
from datetime import time
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import alerts.dispatcher as dispatcher

# A point well inside a 100km Jakarta zone, and one far away (Tokyo).
JAKARTA = {"latitude": -6.21, "longitude": 106.85}
TOKYO = {"latitude": 35.68, "longitude": 139.69}


def _event(severity_geo=JAKARTA, magnitude=6.0, event_type="earthquake"):
    return {
        "latitude": severity_geo["latitude"],
        "longitude": severity_geo["longitude"],
        "magnitude": magnitude,
        "event_type": event_type,
    }


def _alert(severity="Critical", alert_type="earthquake"):
    return {
        "id": uuid4(),
        "severity": severity,
        "alert_type": alert_type,
        "message": "Test alert",
    }


def _subscriber(name="Sub", telegram=12345):
    return {
        "id": uuid4(),
        "name": name,
        "email": None,
        "phone_whatsapp": None,
        "telegram_chat_id": telegram,
    }


def _zone(subscriber_id, lat=-6.21, lon=106.85, radius=100, perils=None, min_mag=5.0):
    return {
        "subscriber_id": subscriber_id,
        "latitude": lat,
        "longitude": lon,
        "radius_km": radius,
        "peril_types": perils or [],
        "min_magnitude": min_mag,
    }


def _pref(channel="telegram", min_severity="High", quiet_start=None, quiet_end=None):
    return {
        "channel": channel,
        "min_severity": min_severity,
        "alert_types": [],
        "quiet_hours_start": quiet_start,
        "quiet_hours_end": quiet_end,
        "is_enabled": True,
    }


class DispatchPipelineTests(unittest.IsolatedAsyncioTestCase):
    def _patch(
        self,
        subscribers,
        zones,
        prefs_by_sub,
        *,
        already_notified=False,
        send_success=True,
    ):
        """Install AsyncMock patches over dispatcher dependencies.

        Returns (log_mock, send_mock) so tests can assert on them.
        """
        self._patchers = []

        def start(name, **kw):
            p = patch.object(dispatcher, name, **kw)
            self._patchers.append(p)
            return p.start()

        start("fetch_active_subscribers", new=AsyncMock(return_value=subscribers))
        start("fetch_active_watch_zones", new=AsyncMock(return_value=zones))

        async def prefs_side_effect(_pool, sub_id):
            return prefs_by_sub.get(str(sub_id), [])

        start("fetch_subscriber_prefs", new=AsyncMock(side_effect=prefs_side_effect))
        start("is_already_notified", new=AsyncMock(return_value=already_notified))
        log_mock = start("log_notification", new=AsyncMock(return_value=uuid4()))

        send_mock = AsyncMock(
            return_value={"success": send_success, "provider_id": "x", "error": None}
        )
        fake_channels = {"telegram": _FakeAdapter(send_mock)}
        start("CHANNELS", new=fake_channels)

        return log_mock, send_mock

    def tearDown(self):
        for p in getattr(self, "_patchers", []):
            p.stop()

    async def test_event_inside_zone_is_sent(self):
        sub = _subscriber()
        log_mock, send_mock = self._patch(
            [sub], [_zone(sub["id"])], {str(sub["id"]): [_pref()]}
        )
        sent = await dispatcher.dispatch_alert(None, _alert(), _event(JAKARTA))
        self.assertEqual(sent, 1)
        send_mock.assert_awaited_once()
        # Final log call records "sent".
        self.assertEqual(log_mock.await_args.args[4], "sent")

    async def test_event_outside_zone_not_sent(self):
        sub = _subscriber()
        _, send_mock = self._patch(
            [sub], [_zone(sub["id"])], {str(sub["id"]): [_pref()]}
        )
        sent = await dispatcher.dispatch_alert(None, _alert(), _event(JAKARTA))
        # Event is in Jakarta but the watch zone is also Jakarta → matches.
        # Move the event to Tokyo to fall outside.
        send_mock.reset_mock()
        sent = await dispatcher.dispatch_alert(None, _alert(), _event(TOKYO))
        self.assertEqual(sent, 0)
        send_mock.assert_not_awaited()

    async def test_subscriber_without_zone_is_global(self):
        sub = _subscriber()  # no zones at all
        _, send_mock = self._patch([sub], [], {str(sub["id"]): [_pref()]})
        sent = await dispatcher.dispatch_alert(None, _alert(), _event(TOKYO))
        self.assertEqual(sent, 1)
        send_mock.assert_awaited_once()

    async def test_severity_below_minimum_skipped(self):
        sub = _subscriber()
        _, send_mock = self._patch(
            [sub], [_zone(sub["id"])],
            {str(sub["id"]): [_pref(min_severity="Critical")]},
        )
        sent = await dispatcher.dispatch_alert(
            None, _alert(severity="Moderate"), _event(JAKARTA)
        )
        self.assertEqual(sent, 0)
        send_mock.assert_not_awaited()

    async def test_dedup_skips_already_notified(self):
        sub = _subscriber()
        _, send_mock = self._patch(
            [sub], [_zone(sub["id"])], {str(sub["id"]): [_pref()]},
            already_notified=True,
        )
        sent = await dispatcher.dispatch_alert(None, _alert(), _event(JAKARTA))
        self.assertEqual(sent, 0)
        send_mock.assert_not_awaited()

    async def test_quiet_hours_skipped_and_logged(self):
        sub = _subscriber()
        # Quiet hours covering the entire day → always within quiet hours.
        pref = _pref(quiet_start=time(0, 0), quiet_end=time(23, 59))
        log_mock, send_mock = self._patch(
            [sub], [_zone(sub["id"])], {str(sub["id"]): [pref]}
        )
        sent = await dispatcher.dispatch_alert(None, _alert(), _event(JAKARTA))
        self.assertEqual(sent, 0)
        send_mock.assert_not_awaited()
        # A "skipped" log entry was written.
        statuses = [call.args[4] for call in log_mock.await_args_list]
        self.assertIn("skipped", statuses)

    async def test_multiple_subscribers_only_matching_notified(self):
        near = _subscriber(name="Near", telegram=111)
        far = _subscriber(name="Far", telegram=222)
        zones = [
            _zone(near["id"]),
            _zone(far["id"], lat=TOKYO["latitude"], lon=TOKYO["longitude"], radius=50),
        ]
        prefs = {str(near["id"]): [_pref()], str(far["id"]): [_pref()]}
        _, send_mock = self._patch([near, far], zones, prefs)
        sent = await dispatcher.dispatch_alert(None, _alert(), _event(JAKARTA))
        self.assertEqual(sent, 1)
        send_mock.assert_awaited_once()


class _FakeAdapter:
    def __init__(self, send_mock):
        self._send = send_mock

    @property
    def name(self):
        return "telegram"

    async def send(self, recipient, message, **kwargs):
        return await self._send(recipient, message, **kwargs)


if __name__ == "__main__":
    unittest.main()
