"""Bounded streaming reads for connector HTTP responses."""

from __future__ import annotations

import httpx

MAX_CONNECTOR_PAYLOAD_BYTES = 1024 * 1024


async def read_bounded_response(
    response: httpx.Response,
    *,
    label: str,
    max_bytes: int = MAX_CONNECTOR_PAYLOAD_BYTES,
) -> bytes:
    """Read at most max_bytes and always close the response."""
    try:
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            try:
                declared_bytes = int(content_length)
            except ValueError as exc:
                raise ValueError(f"{label} has invalid Content-Length") from exc
            if declared_bytes < 0:
                raise ValueError(f"{label} has invalid Content-Length")
            if declared_bytes > max_bytes:
                raise ValueError(f"{label} exceeds {max_bytes} bytes")

        response.raise_for_status()
        payload = bytearray()
        async for chunk in response.aiter_bytes():
            if len(payload) + len(chunk) > max_bytes:
                raise ValueError(f"{label} exceeds {max_bytes} bytes")
            payload.extend(chunk)
        return bytes(payload)
    finally:
        await response.aclose()


async def read_bounded_text(
    response: httpx.Response,
    *,
    label: str,
    max_bytes: int = MAX_CONNECTOR_PAYLOAD_BYTES,
) -> str:
    encoding = response.encoding or "utf-8"
    payload = await read_bounded_response(
        response,
        label=label,
        max_bytes=max_bytes,
    )
    return payload.decode(encoding, errors="replace")


__all__ = [
    "MAX_CONNECTOR_PAYLOAD_BYTES",
    "read_bounded_response",
    "read_bounded_text",
]
