"""Resolve official source settings with custom > environment > public default priority."""

from __future__ import annotations

import os
from dataclasses import dataclass

import asyncpg


@dataclass(frozen=True)
class ResolvedSourceSetting:
    source_name: str
    enabled: bool
    api_url: str | None
    api_token: str | None
    mode: str
    attribution: str


_ENV_URLS = {
    "inatews": "INATEWS_FEED_URL",
    "pvmbg": "PVMBG_FEED_URL",
    "bnpb": "BNPB_FEED_URL",
    "inarisk": "INARISK_FEED_URL",
}


async def resolve_source_setting(
    pool: asyncpg.Pool,
    source_name: str,
) -> ResolvedSourceSetting | None:
    key = os.getenv("OFFICIAL_SOURCE_SETTINGS_KEY", "")
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT source_name, enabled, mode, default_api_url, custom_api_url,
                          attribution,
                          CASE WHEN api_token_encrypted IS NOT NULL AND $2 <> ''
                            THEN pgp_sym_decrypt(api_token_encrypted, $2) END AS api_token
                   FROM official_source_settings WHERE source_name=$1""",
                source_name,
                key,
            )
    except Exception:
        return None
    if row is None:
        return None
    mode = row["mode"]
    environment_url = os.getenv(_ENV_URLS.get(source_name, ""), "").strip() or None
    if mode == "custom_api":
        api_url = row["custom_api_url"]
    elif mode == "default_public":
        api_url = row["default_api_url"]
    else:
        api_url = row["custom_api_url"] or environment_url or row["default_api_url"]
    return ResolvedSourceSetting(
        source_name=source_name,
        enabled=bool(row["enabled"]),
        api_url=api_url,
        api_token=row["api_token"],
        mode=mode,
        attribution=row["attribution"],
    )


__all__ = ["ResolvedSourceSetting", "resolve_source_setting"]
