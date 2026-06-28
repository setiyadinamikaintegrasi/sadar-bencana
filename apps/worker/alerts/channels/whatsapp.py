"""WhatsApp channel adapter via Fonnte API."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from alerts.channels.base import BaseChannel

logger = logging.getLogger(__name__)

_FONNTE_URL = "https://api.fonnte.com/send"


class WhatsAppChannel(BaseChannel):
    """Sends WhatsApp messages via Fonnte gateway."""

    @property
    def name(self) -> str:
        return "whatsapp"

    async def send(
        self, recipient: str, message: str, **kwargs: Any
    ) -> dict[str, Any]:
        token = os.getenv("FONNTE_API_TOKEN")
        if not token:
            return {"success": False, "provider_id": None,
                    "error": "FONNTE_API_TOKEN not set"}

        payload = {
            "target": recipient,
            "message": message,
            "countryCode": "62",  # Indonesia default
        }

        headers = {"Authorization": token}

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(_FONNTE_URL, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                # Fonnte returns {"status": true, ...} on success
                if data.get("status") is True or data.get("Rl") == "success":
                    return {
                        "success": True,
                        "provider_id": str(data.get("id", "")),
                    }
                return {
                    "success": False,
                    "provider_id": None,
                    "error": str(data),
                }
        except Exception as exc:
            logger.warning("WhatsApp send failed for %s: %s", recipient, exc)
            return {"success": False, "provider_id": None, "error": str(exc)}
