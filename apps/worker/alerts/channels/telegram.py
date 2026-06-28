"""Telegram Bot API channel adapter."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from alerts.channels.base import BaseChannel

logger = logging.getLogger(__name__)


class TelegramChannel(BaseChannel):
    """Sends messages via Telegram Bot API to individual chat_ids."""

    @property
    def name(self) -> str:
        return "telegram"

    async def send(
        self, recipient: str, message: str, **kwargs: Any
    ) -> dict[str, Any]:
        token = os.getenv("TELEGRAM_BOT_TOKEN")
        if not token:
            return {"success": False, "provider_id": None,
                    "error": "TELEGRAM_BOT_TOKEN not set"}

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": int(recipient),
            "text": message,
            "parse_mode": "Markdown",
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                return {
                    "success": True,
                    "provider_id": str(
                        data.get("result", {}).get("message_id", "")
                    ),
                }
        except Exception as exc:
            logger.warning("Telegram send failed for chat %s: %s", recipient, exc)
            return {"success": False, "provider_id": None, "error": str(exc)}
