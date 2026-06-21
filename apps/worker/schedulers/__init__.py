"""Background schedulers for the worker service.

Exposes :class:`schedulers.ingest.IngestScheduler`, a self-contained
loop that drives periodic ingestion on FastAPI startup.
"""

from __future__ import annotations
