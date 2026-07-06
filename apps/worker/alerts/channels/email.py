"""Email channel adapter via SMTP."""

from __future__ import annotations

import asyncio
import logging
import os
import smtplib
from email.message import EmailMessage
from typing import Any

from alerts.channels.base import BaseChannel
from alerts.channels.email_template import render_html_email

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

        if not host or not user or not password or not from_addr:
            return {"success": False, "provider_id": None,
                    "error": "SMTP not configured"}

        try:
            subject = str(
                kwargs.get("subject", "[Sadar Bencana EWS] Alert Notification")
            ).replace("\r", " ").replace("\n", " ")[:200]
            msg = EmailMessage()
            msg["From"] = from_addr
            msg["To"] = recipient
            msg["Subject"] = subject
            msg.set_content(message)
            msg.add_alternative(
                render_html_email(
                    subject=subject,
                    message=message,
                    public_base_url=os.getenv("EWS_PUBLIC_BASE_URL"),
                    **{
                        key: value
                        for key, value in kwargs.items()
                        if key not in {"subject", "public_base_url"}
                    },
                ),
                subtype="html",
            )

            # Run blocking SMTP in thread executor for async compatibility.
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, self._smtp_send, host, port, user, password,
                from_addr, recipient, msg.as_string(),
            )
            return {"success": True, "provider_id": None}
        except Exception as exc:
            logger.warning(
                "Email delivery failed (error_type=%s)",
                type(exc).__name__,
            )
            return {
                "success": False,
                "provider_id": None,
                "error": "email_delivery_failed",
            }

    @staticmethod
    def _smtp_send(
        host: str, port: int, user: str, password: str,
        from_addr: str, to_addr: str, body: str,
    ) -> None:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.starttls()
            server.login(user, password)
            server.sendmail(from_addr, to_addr, body)
