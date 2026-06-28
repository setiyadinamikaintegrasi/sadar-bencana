"""Generate risk monitoring briefings using local LLM (Gemma4-E4B via llama.cpp).

The LLM endpoint is OpenAI-compatible at localhost:8080.
No sensitive data leaves the host.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from models.event import EarthquakeEvent

logger = logging.getLogger(__name__)

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:8080")
LLM_MODEL = os.getenv("LLM_MODEL", "gemma4-e4b")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "30"))

_SYSTEM_PROMPT = (
    "Anda adalah asisten analisis risiko bencana dan early warning. "
    "Berdasarkan data event gempa terbaru, buat ringkasan singkat (3-5 kalimat) "
    "dalam Bahasa Indonesia yang menyoroti: jumlah event signifikan, wilayah "
    "paling terdampak, dan rekomendasi tindak lanjut untuk tim pemantau risiko bencana. "
    "Format: naratif profesional, padat, tidak sensational."
)


def _fallback_summary(events: list[EarthquakeEvent]) -> str:
    top = events[:5]
    sig = [e for e in events if e.magnitude and e.magnitude >= 5.0]
    return (
        f"Pemantauan menunjukkan {len(sig)} event signifikan (M5.0+) "
        f"dari total {len(events)} event. "
        f"Wilayah dengan event terbesar saat ini: {top[0].place if top else 'tidak tersedia'}. "
        f"Rekomendasi: verifikasi eksposur portofolio dan akumulasi risiko pada area terdampak. "
        f"(Briefing ini dibuat dengan fallback lokal karena respons LLM belum tersedia stabil.)"
    )


async def generate_briefing(events: list[EarthquakeEvent]) -> str:
    """Send top events to local LLM and return the generated summary text.

    Args:
        events: List of earthquake events (should be pre-sorted by magnitude DESC).

    Returns:
        Briefing summary string. On failure, returns a fallback template.
    """

    if not events:
        return "Tidak ada event signifikan dalam periode pemantauan terbaru."

    top = events[:5]
    lines: list[str] = []
    for e in top:
        lines.append(f"- M{e.magnitude:.1f} | {e.place} | {e.source} | {e.time}")
    event_block = "\n".join(lines)

    user_prompt = (
        f"Berikut adalah {len(events)} event gempa terbaru "
        f"({len(top)} terbesar ditampilkan):\n\n{event_block}\n\n"
        "Buat ringkasan briefing risiko bencana."
    )

    payload: dict[str, Any] = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 2048,
    }

    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            resp = await client.post(
                f"{LLM_BASE_URL}/v1/chat/completions",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            summary = data["choices"][0]["message"]["content"].strip()
            if not summary:
                # Gemma-4 reasoning mode: content may be empty if reasoning
                # consumed all tokens. Try reasoning_content as last resort.
                reasoning = data["choices"][0]["message"].get("reasoning_content", "").strip()
                if reasoning:
                    logger.warning("LLM content empty, extracting from reasoning_content")
                    return reasoning
                logger.warning("LLM returned empty summary, using fallback")
                return _fallback_summary(events)
            return summary
    except Exception as exc:
        logger.warning("LLM briefing failed, using fallback: %s", exc)
        return _fallback_summary(events)


def build_briefing_record(
    summary: str,
    events: list[EarthquakeEvent],
    event_ids: list[str],
    model: str = LLM_MODEL,
) -> dict[str, Any]:
    """Build a dict ready for DB insertion into briefings table."""

    now = datetime.now(timezone.utc)
    return {
        "briefing_type": "daily",
        "summary": summary,
        "event_ids": event_ids,
        "event_count": len(events),
        "model": model,
        "prompt_hash": None,
        "created_at": now,
    }
