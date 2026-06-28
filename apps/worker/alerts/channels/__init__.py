"""Channel adapter registry."""

from alerts.channels.base import BaseChannel
from alerts.channels.email import EmailChannel
from alerts.channels.telegram import TelegramChannel
from alerts.channels.whatsapp import WhatsAppChannel

CHANNELS: dict[str, BaseChannel] = {
    "telegram": TelegramChannel(),
    "whatsapp": WhatsAppChannel(),
    "email": EmailChannel(),
}

__all__ = ["BaseChannel", "CHANNELS", "TelegramChannel", "WhatsAppChannel",
           "EmailChannel"]
