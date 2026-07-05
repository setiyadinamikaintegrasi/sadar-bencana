from __future__ import annotations

import httpx
import os
import pytest
import subprocess
import sys

import main


@pytest.fixture(autouse=True)
def reset_security_state(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "t" * 32)
    main._WORKER_TOKEN = None
    main._mutation_log.clear()
    yield
    main._WORKER_TOKEN = None
    main._mutation_log.clear()


@pytest.mark.asyncio
async def test_worker_api_requires_bearer_token_and_health_is_public():
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://worker") as client:
        assert (await client.get("/health")).status_code == 200
        assert (await client.get("/api/v1/not-found")).status_code == 401
        assert (
            await client.get(
                "/api/v1/not-found",
                headers={"Authorization": f"Bearer {'t' * 32}"},
            )
        ).status_code == 404


@pytest.mark.asyncio
async def test_unauthenticated_mutations_do_not_consume_internal_rate_limit():
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://worker") as client:
        for _ in range(main._MUTATION_MAX + 1):
            response = await client.post("/api/v1/worker/ingest")
            assert response.status_code == 401

    assert dict(main._mutation_log) == {}


@pytest.mark.asyncio
async def test_chunked_api_request_is_rejected_before_handler():
    async def chunks():
        yield b"{}"

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://worker") as client:
        response = await client.post(
            "/api/v1/worker/ingest",
            headers={"Authorization": f"Bearer {'t' * 32}"},
            content=chunks(),
        )
    assert response.status_code == 411


def test_production_requires_strong_worker_token(monkeypatch):
    monkeypatch.setattr(main, "_is_production", True)
    monkeypatch.setenv("WORKER_API_TOKEN", "short")
    main._WORKER_TOKEN = None

    with pytest.raises(RuntimeError, match="at least 32 characters"):
        main._validate_worker_auth_config()


def test_production_disables_interactive_api_documentation():
    environment = {
        **os.environ,
        "API_ENV": "hosted",
        "WORKER_API_TOKEN": "t" * 32,
    }
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import main; "
                "assert main.app.docs_url is None; "
                "assert main.app.redoc_url is None; "
                "assert main.app.openapi_url is None"
            ),
        ],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )
    assert result.returncode == 0, result.stderr
