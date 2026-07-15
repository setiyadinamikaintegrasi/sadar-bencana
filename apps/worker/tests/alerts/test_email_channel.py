"""Tests for safe multipart EWS email rendering."""

from __future__ import annotations

import asyncio
import socket
import smtplib
import threading
import unittest
from email import message_from_string
from email.policy import default
from unittest.mock import patch

from alerts.channels.email import EmailChannel
from alerts.channels.email_template import (
    DEFAULT_PUBLIC_BASE_URL,
    render_html_email,
    safe_public_base_url,
)


class EmailTemplateTests(unittest.TestCase):
    def test_dynamic_content_is_escaped_and_unsafe_url_falls_back(self):
        html = render_html_email(
            subject='Alert <img src=x onerror="bad()">',
            message="<script>alert('x')</script>\nTetap waspada",
            public_base_url="javascript:alert(1)",
            severity="Critical",
            alert_type="earthquake",
            source="<b>untrusted</b>",
        )

        self.assertNotIn("<script>", html)
        self.assertNotIn("<img src=x", html)
        self.assertNotIn("<b>untrusted</b>", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("&lt;b&gt;untrusted&lt;/b&gt;", html)
        self.assertIn(f'href="{DEFAULT_PUBLIC_BASE_URL}/"', html)
        self.assertNotIn("javascript:", html)

    def test_only_absolute_https_public_url_is_accepted(self):
        self.assertEqual(
            safe_public_base_url("https://sadarbencana.id/app/"),
            "https://sadarbencana.id/app",
        )
        self.assertEqual(
            safe_public_base_url("http://sadarbencana.id"),
            DEFAULT_PUBLIC_BASE_URL,
        )
        self.assertEqual(
            safe_public_base_url("https://user:pass@sadarbencana.id"),
            DEFAULT_PUBLIC_BASE_URL,
        )


class EmailChannelTests(unittest.IsolatedAsyncioTestCase):
    async def _wait_for_thread_event(self, event: threading.Event) -> None:
        for _ in range(100):
            if event.is_set():
                return
            await asyncio.sleep(0.01)
        self.fail("SMTP thread did not start")

    async def test_missing_smtp_configuration_is_definite_and_not_retryable(self):
        channel = EmailChannel()

        with patch.dict("os.environ", {}, clear=True):
            result = await channel.send("recipient@example.com", "Test")

        self.assertEqual(
            result,
            {
                "success": False,
                "provider_id": None,
                "error": "SMTP not configured",
                "ambiguous": False,
                "retryable": False,
            },
        )

    async def test_invalid_smtp_port_is_definite_and_not_retryable(self):
        channel = EmailChannel()
        environment = {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "not-a-number",
            "SMTP_USER": "resend",
            "SMTP_PASSWORD": "secret",
            "SMTP_FROM": "noreply@sadarbencana.id",
        }

        with patch.dict("os.environ", environment, clear=True):
            result = await channel.send("recipient@example.com", "Test")

        self.assertEqual(
            result,
            {
                "success": False,
                "provider_id": None,
                "error": "SMTP port is invalid",
                "ambiguous": False,
                "retryable": False,
            },
        )

    async def test_send_builds_plain_and_html_alternatives(self):
        channel = EmailChannel()
        environment = {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USER": "resend",
            "SMTP_PASSWORD": "secret",
            "SMTP_FROM": "noreply@sadarbencana.id",
            "EWS_PUBLIC_BASE_URL": "https://sadarbencana.id",
        }

        with (
            patch.dict("os.environ", environment, clear=True),
            patch.object(channel, "_smtp_send") as smtp_send,
        ):
            result = await channel.send(
                "recipient@example.com",
                "Gempa terdeteksi di wilayah pantauan.",
                subject="[SadarBencana][Critical] Gempa",
                idempotency_key="3ad5dc52-3b61-4852-a504-c54f9f643ab2",
                notification_kind="alert",
                severity="Critical",
                alert_type="earthquake",
                headline="Gempa M6.1 dekat Jakarta",
                source="BMKG",
            )

        self.assertTrue(result["success"])
        smtp_send.assert_called_once()
        serialized = smtp_send.call_args.args[-1]
        email = message_from_string(serialized, policy=default)

        self.assertEqual(email.get_content_type(), "multipart/alternative")
        self.assertEqual(
            email.get_body(preferencelist=("plain",)).get_content_type(),
            "text/plain",
        )
        self.assertEqual(
            email.get_body(preferencelist=("html",)).get_content_type(),
            "text/html",
        )
        self.assertIn(
            "Gempa terdeteksi",
            email.get_body(preferencelist=("plain",)).get_content(),
        )
        self.assertIn(
            "Buka Dashboard SadarBencana",
            email.get_body(preferencelist=("html",)).get_content(),
        )
        self.assertEqual(
            email["Message-ID"],
            "<ews-d2108927afbc4637049dcb659a10c88acdf4f4c762b5a6a36bb7986b09b5fae0@sadarbencana.id>",
        )
        self.assertEqual(
            email["X-SadarBencana-Idempotency-Key"],
            "3ad5dc52-3b61-4852-a504-c54f9f643ab2",
        )

    async def test_header_injection_is_removed_from_subject(self):
        channel = EmailChannel()
        environment = {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USER": "resend",
            "SMTP_PASSWORD": "secret",
            "SMTP_FROM": "noreply@sadarbencana.id",
        }

        with (
            patch.dict("os.environ", environment, clear=True),
            patch.object(channel, "_smtp_send") as smtp_send,
        ):
            result = await channel.send(
                "recipient@example.com",
                "Test",
                subject="Valid\r\nBcc: attacker@example.com",
            )

        self.assertTrue(result["success"])
        serialized = smtp_send.call_args.args[-1]
        email = message_from_string(serialized, policy=default)
        self.assertNotIn("Bcc", email)
        self.assertEqual(email["Subject"], "Valid  Bcc: attacker@example.com")

    async def test_smtp_timeout_is_ambiguous_and_not_retryable(self):
        channel = EmailChannel()
        environment = {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USER": "resend",
            "SMTP_PASSWORD": "secret",
            "SMTP_FROM": "noreply@sadarbencana.id",
        }

        with (
            patch.dict("os.environ", environment, clear=True),
            patch.object(channel, "_smtp_send", side_effect=socket.timeout),
        ):
            result = await channel.send(
                "recipient@example.com",
                "Test",
                idempotency_key="delivery-timeout",
            )

        self.assertEqual(
            result,
            {
                "success": False,
                "provider_id": None,
                "error": "email_delivery_ambiguous",
                "ambiguous": True,
                "retryable": False,
            },
        )

    async def test_smtp_disconnect_or_socket_failure_is_ambiguous_and_not_retryable(self):
        channel = EmailChannel()
        environment = {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USER": "resend",
            "SMTP_PASSWORD": "secret",
            "SMTP_FROM": "noreply@sadarbencana.id",
        }

        for error in (
            smtplib.SMTPServerDisconnected("connection lost after DATA"),
            ConnectionResetError("connection reset after DATA"),
            BrokenPipeError("connection closed while finishing DATA"),
            OSError("socket state unknown after DATA"),
        ):
            with self.subTest(error_type=type(error).__name__):
                with (
                    patch.dict("os.environ", environment, clear=True),
                    patch.object(channel, "_smtp_send", side_effect=error),
                ):
                    result = await channel.send(
                        "recipient@example.com",
                        "Test",
                        idempotency_key="delivery-disconnected",
                    )

                self.assertEqual(
                    result,
                    {
                        "success": False,
                        "provider_id": None,
                        "error": "email_delivery_ambiguous",
                        "ambiguous": True,
                        "retryable": False,
                    },
                )

    async def test_cancellation_waits_for_smtp_completion_and_returns_success(self):
        channel = EmailChannel()
        started = threading.Event()
        release = threading.Event()
        finished = threading.Event()
        environment = {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USER": "resend",
            "SMTP_PASSWORD": "secret",
            "SMTP_FROM": "noreply@sadarbencana.id",
        }

        def smtp_send(*_args):
            started.set()
            release.wait(timeout=2)
            finished.set()

        with (
            patch.dict("os.environ", environment, clear=True),
            patch.object(channel, "_smtp_send", side_effect=smtp_send),
        ):
            task = asyncio.create_task(
                channel.send(
                    "recipient@example.com",
                    "Test",
                    idempotency_key="delivery-cancel-success",
                )
            )
            await self._wait_for_thread_event(started)
            task.cancel()
            await asyncio.sleep(0.02)

            self.assertFalse(task.done())
            self.assertFalse(finished.is_set())
            release.set()
            result = await asyncio.wait_for(task, timeout=1)

        self.assertTrue(finished.is_set())
        self.assertEqual(result, {"success": True, "provider_id": None})

    async def test_cancellation_waits_for_smtp_timeout_and_returns_ambiguous(self):
        channel = EmailChannel()
        started = threading.Event()
        release = threading.Event()
        finished = threading.Event()
        environment = {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USER": "resend",
            "SMTP_PASSWORD": "secret",
            "SMTP_FROM": "noreply@sadarbencana.id",
        }

        def smtp_send(*_args):
            started.set()
            release.wait(timeout=2)
            finished.set()
            raise socket.timeout

        with (
            patch.dict("os.environ", environment, clear=True),
            patch.object(channel, "_smtp_send", side_effect=smtp_send),
        ):
            task = asyncio.create_task(
                channel.send(
                    "recipient@example.com",
                    "Test",
                    idempotency_key="delivery-cancel-timeout",
                )
            )
            await self._wait_for_thread_event(started)
            task.cancel()
            await asyncio.sleep(0.02)

            self.assertFalse(task.done())
            release.set()
            result = await asyncio.wait_for(task, timeout=1)

        self.assertTrue(finished.is_set())
        self.assertEqual(
            result,
            {
                "success": False,
                "provider_id": None,
                "error": "email_delivery_ambiguous",
                "ambiguous": True,
                "retryable": False,
            },
        )
