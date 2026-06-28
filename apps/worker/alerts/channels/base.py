"""Abstract base for notification channel adapters."""

from __future__ import annotations

import abc
from typing import Any


class BaseChannel(abc.ABC):
    """All channel adapters implement this interface."""

    @property
    @abc.abstractmethod
    def name(self) -> str:
        """Channel identifier: 'telegram', 'whatsapp', 'email'."""
        ...

    @abc.abstractmethod
    async def send(
        self, recipient: str, message: str, **kwargs: Any
    ) -> dict[str, Any]:
        """
        Send a notification.

        Args:
            recipient: chat_id (Telegram), phone E.164 (WhatsApp),
                       or email address (Email).
            message: The alert message text.
            **kwargs: Channel-specific options (subject, severity, etc.)

        Returns:
            dict with at least {"success": bool, "provider_id": str|None}
        """
        ...
