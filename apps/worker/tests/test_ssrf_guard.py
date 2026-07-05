"""Security tests for Worker authentication and official-feed SSRF controls."""

from __future__ import annotations

import httpx
import pytest

from connectors.official_feeds import ApprovedJSONFeedConnector
from ssrf_guard import is_blocked_ip, resolve_public_ips


def test_ssrf_guard_blocks_metadata_and_private_ips():
    assert is_blocked_ip("169.254.169.254") is True
    assert is_blocked_ip("127.0.0.1") is True
    assert is_blocked_ip("10.0.0.1") is True
    assert is_blocked_ip("192.168.1.1") is True
    assert is_blocked_ip("172.16.0.1") is True
    assert is_blocked_ip("::1") is True
    assert is_blocked_ip("fe80::1") is True
    assert is_blocked_ip("::ffff:127.0.0.1") is True
    assert is_blocked_ip("8.8.8.8") is False


def test_resolver_rejects_if_any_answer_is_private(monkeypatch):
    answers = [
        (2, 1, 6, "", ("203.0.114.10", 0)),
        (2, 1, 6, "", ("169.254.169.254", 0)),
    ]
    monkeypatch.setattr("ssrf_guard.socket.getaddrinfo", lambda *args, **kwargs: answers)

    with pytest.raises(ValueError, match="blocked IP"):
        resolve_public_ips("data.bnpb.go.id")


@pytest.mark.asyncio
async def test_official_connector_pins_validated_ip_and_preserves_tls_host(monkeypatch):
    captured: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["host"] = request.headers["Host"]
        captured["sni"] = request.extensions["sni_hostname"]
        return httpx.Response(200, json={"data": [{"report_id": "one"}]})

    monkeypatch.setattr(
        "connectors.official_feeds.resolve_public_ips",
        lambda hostname: ("203.0.114.10",),
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        connector = ApprovedJSONFeedConnector(
            "bnpb",
            "https://data.bnpb.go.id/feed.json",
            client=client,
        )
        payload = await connector.fetch_payload()

    assert payload["data"][0]["report_id"] == "one"
    assert captured == {
        "url": "https://203.0.114.10/feed.json",
        "host": "data.bnpb.go.id",
        "sni": "data.bnpb.go.id",
    }


@pytest.mark.asyncio
async def test_ingest_endpoint_has_no_user_supplied_url_parameter():
    import inspect
    from main import worker_ingest

    assert list(inspect.signature(worker_ingest).parameters) == []
