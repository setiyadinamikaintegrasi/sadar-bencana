"""Email channel adapter via SMTP."""

from __future__ import annotations

import asyncio
import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from alerts.channels.base import BaseChannel

logger = logging.getLogger(__name__)


class EmailChannel(BaseChannel):
    """Sends email notifications via SMTP."""

    @property
    def name(self) -> str:
        return "email"

    async def send(
        self, recipient: str, message: str, **kwargs: Any
    ) -> dict[str, Any]:
        host = os.getenv("SMTP_HOST")
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER")
        password = os.getenv("SMTP_PASSWORD")
        from_addr = os.getenv("SMTP_FROM", "ews@example.com")

        if not host or not user:
            return {"success": False, "provider_id": None,
                    "error": "SMTP not configured"}

        subject = kwargs.get("subject", "[Sadar Bencana EWS] Alert Notification")

        msg = MIMEMultipart("alternative")
        msg["From"] = from_addr
        msg["To"] = recipient
        msg["Subject"] = subject
        msg.attach(MIMEText(message, "plain"))

        try:
            # Run blocking SMTP in thread executor for async compatibility.
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, self._smtp_send, host, port, user, password,
                from_addr, recipient, msg.as_string(),
            )
            return {"success": True, "provider_id": None}
        except Exception as exc:
            logger.warning("Email send failed for %s: %s", recipient, exc)
            return {"success": False, "provider_id": None, "error": str(exc)}

    @staticmethod
    def _smtp_send(
        host: str, port: int, user: str, password: str,
        from_addr: str, to_addr: str, body: str,
    ) -> None:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.starttls()
            server.login(user, password)
            server.sendmail(from_addr, to_addr, body)
