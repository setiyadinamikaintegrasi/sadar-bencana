"""Channel adapter registry."""

from alerts.channels.base import BaseChannel
from alerts.channels.email import EmailChannel
from alerts.channels.telegram import TelegramChannel

CHANNELS: dict[str, BaseChannel] = {
    "telegram": TelegramChannel(),
    "email": EmailChannel(),
}

__all__ = ["BaseChannel", "CHANNELS", "TelegramChannel", "EmailChannel"]
