from unittest.mock import AsyncMock, MagicMock

import pytest

from scripts import seed_indonesia_regional_events as seed_script


def _patch_seed_dependencies(monkeypatch):
    dependencies = {
        "init_pool": AsyncMock(),
        "get_pool": MagicMock(return_value=object()),
        "upsert_events": AsyncMock(return_value=5),
        "score_events": AsyncMock(return_value=5),
        "evaluate_alerts": AsyncMock(return_value=[]),
        "close_pool": AsyncMock(),
    }
    for name, value in dependencies.items():
        monkeypatch.setattr(seed_script, name, value)
    return dependencies


@pytest.mark.asyncio
async def test_seed_script_refuses_database_writes_without_explicit_opt_in(monkeypatch):
    monkeypatch.delenv("ALLOW_SYNTHETIC_EVENT_SEEDING", raising=False)
    dependencies = _patch_seed_dependencies(monkeypatch)

    with pytest.raises(RuntimeError, match="ALLOW_SYNTHETIC_EVENT_SEEDING=true"):
        await seed_script.main()

    dependencies["init_pool"].assert_not_awaited()
    dependencies["upsert_events"].assert_not_awaited()


@pytest.mark.asyncio
async def test_seed_script_writes_when_explicitly_opted_in(monkeypatch):
    monkeypatch.setenv("ALLOW_SYNTHETIC_EVENT_SEEDING", "true")
    dependencies = _patch_seed_dependencies(monkeypatch)

    await seed_script.main()

    dependencies["init_pool"].assert_awaited_once()
    dependencies["upsert_events"].assert_awaited_once()
    dependencies["close_pool"].assert_awaited_once()
