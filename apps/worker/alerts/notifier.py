"""Telegram notification helper for worker alerts."""

from __future__ import annotations

import os
from typing import Any

import httpx


async def send_telegram(message: str) -> dict[str, Any] | None:
    """Send a Telegram message when bot credentials are configured."""

    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return None

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": message}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
    except Exception:
        return None
