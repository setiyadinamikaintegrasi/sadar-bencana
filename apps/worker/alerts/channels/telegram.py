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
        correlation_id = str(kwargs.get("idempotency_key") or "")
        token = os.getenv("TELEGRAM_BOT_TOKEN")
        if not token:
            return {
                "success": False,
                "provider_id": None,
                "error": "TELEGRAM_BOT_TOKEN not set",
                "ambiguous": False,
                "retryable": False,
                "correlation_id": correlation_id,
            }

        try:
            chat_id = int(recipient)
        except (TypeError, ValueError):
            logger.warning(
                "Telegram recipient validation failed (delivery_id=%s)",
                correlation_id or "missing",
            )
            return {
                "success": False,
                "provider_id": None,
                "error": "telegram_recipient_invalid",
                "ambiguous": False,
                "retryable": False,
                "correlation_id": correlation_id,
            }

        try:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": message,
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                return {
                    "success": True,
                    "provider_id": str(
                        data.get("result", {}).get("message_id", "")
                    ),
                    "correlation_id": correlation_id,
                }
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            retryable = status == 429 or status >= 500
            logger.warning(
                "Telegram rejected delivery for chat %s "
                "(status=%s delivery_id=%s)",
                recipient,
                status,
                correlation_id or "missing",
            )
            return {
                "success": False,
                "provider_id": None,
                "error": "telegram_delivery_rejected",
                "ambiguous": False,
                "retryable": retryable,
                "correlation_id": correlation_id,
            }
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
            logger.warning(
                "Telegram connection failed before a response "
                "(error_type=%s delivery_id=%s)",
                type(exc).__name__,
                correlation_id or "missing",
            )
            return {
                "success": False,
                "provider_id": None,
                "error": "telegram_connection_failed",
                "ambiguous": False,
                "retryable": True,
                "correlation_id": correlation_id,
            }
        except httpx.TransportError as exc:
            logger.warning(
                "Telegram transport outcome is ambiguous "
                "(error_type=%s delivery_id=%s)",
                type(exc).__name__,
                correlation_id or "missing",
            )
            return {
                "success": False,
                "provider_id": None,
                "error": "telegram_delivery_ambiguous",
                "ambiguous": True,
                "retryable": False,
                "correlation_id": correlation_id,
            }
        except Exception as exc:
            logger.warning(
                "Telegram response outcome is ambiguous "
                "(error_type=%s delivery_id=%s)",
                type(exc).__name__,
                correlation_id or "missing",
            )
            return {
                "success": False,
                "provider_id": None,
                "error": "telegram_delivery_ambiguous",
                "ambiguous": True,
                "retryable": False,
                "correlation_id": correlation_id,
            }
