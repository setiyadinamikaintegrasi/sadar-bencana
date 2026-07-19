"""Tests for Telegram delivery outcome classification."""

from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from alerts.channels.telegram import TelegramChannel


class _FakeAsyncClient:
    def __init__(self, *, response=None, error=None, **_kwargs):
        self.response = response
        self.error = error
        self.request_json = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, *, json):
        self.request_json = json
        if self.error is not None:
            raise self.error
        return self.response


class TelegramChannelTests(unittest.IsolatedAsyncioTestCase):
    async def test_accepted_then_read_timeout_is_ambiguous_and_not_retryable(self):
        channel = TelegramChannel()
        request = httpx.Request(
            "POST", "https://api.telegram.org/botsecret/sendMessage"
        )
        client = _FakeAsyncClient(error=httpx.ReadTimeout("timed out", request=request))

        with (
            patch.dict("os.environ", {"TELEGRAM_BOT_TOKEN": "secret"}, clear=True),
            patch("alerts.channels.telegram.httpx.AsyncClient", return_value=client),
            self.assertLogs("alerts.channels.telegram", level="WARNING") as logs,
        ):
            result = await channel.send(
                "12345",
                "Peringatan",
                idempotency_key="delivery-telegram-timeout",
            )

        self.assertEqual(
            result,
            {
                "success": False,
                "provider_id": None,
                "error": "telegram_delivery_ambiguous",
                "ambiguous": True,
                "retryable": False,
                "correlation_id": "delivery-telegram-timeout",
            },
        )
        self.assertIn("delivery-telegram-timeout", "\n".join(logs.output))

    async def test_http_rejection_is_definite_and_preserves_status_policy(self):
        channel = TelegramChannel()
        request = httpx.Request(
            "POST", "https://api.telegram.org/botsecret/sendMessage"
        )
        response = httpx.Response(400, request=request, json={"ok": False})
        client = _FakeAsyncClient(response=response)

        with (
            patch.dict("os.environ", {"TELEGRAM_BOT_TOKEN": "secret"}, clear=True),
            patch("alerts.channels.telegram.httpx.AsyncClient", return_value=client),
        ):
            result = await channel.send(
                "12345",
                "Peringatan",
                idempotency_key="delivery-http-rejected",
            )

        self.assertEqual(result["error"], "telegram_delivery_rejected")
        self.assertFalse(result["ambiguous"])
        self.assertFalse(result["retryable"])
        self.assertEqual(result["correlation_id"], "delivery-http-rejected")

    async def test_delivery_id_is_correlation_only_not_provider_idempotency(self):
        channel = TelegramChannel()
        request = httpx.Request(
            "POST", "https://api.telegram.org/botsecret/sendMessage"
        )
        response = httpx.Response(
            200,
            request=request,
            json={"ok": True, "result": {"message_id": 998}},
        )
        client = _FakeAsyncClient(response=response)

        with (
            patch.dict("os.environ", {"TELEGRAM_BOT_TOKEN": "secret"}, clear=True),
            patch("alerts.channels.telegram.httpx.AsyncClient", return_value=client),
        ):
            result = await channel.send(
                "12345",
                "Peringatan",
                idempotency_key="delivery-correlation-only",
            )

        self.assertEqual(result["provider_id"], "998")
        self.assertEqual(result["correlation_id"], "delivery-correlation-only")
        self.assertEqual(
            client.request_json,
            {"chat_id": 12345, "text": "Peringatan"},
        )


if __name__ == "__main__":
    unittest.main()
