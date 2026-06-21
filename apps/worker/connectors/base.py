"""Base connector interfaces for upstream event ingestion."""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseConnector(ABC):
    """Abstract connector responsible for fetching recent upstream events."""

    @abstractmethod
    async def fetch_recent(self) -> list:
        """Fetch the most recent events from the upstream source."""
