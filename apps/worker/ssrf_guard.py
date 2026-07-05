"""SSRF defense-in-depth: validate resolved IPs before connecting.

This module provides a synchronous IP validator that blocks connections
to private, loopback, link-local, multicast, and cloud metadata addresses.
It is intended as a safety net — primary protection is the HTTPS allowlist
in connectors/official_feeds.py.
"""

from __future__ import annotations

import ipaddress
import socket
from typing import Iterable

# IPv4 ranges to block (RFC 1918, loopback, link-local, metadata, etc.)
_BLOCKED_PREFIXES_V4 = [
    ipaddress.ip_network("10.0.0.0/8"),          # RFC 1918 private
    ipaddress.ip_network("172.16.0.0/12"),        # RFC 1918 private
    ipaddress.ip_network("192.168.0.0/16"),       # RFC 1918 private
    ipaddress.ip_network("127.0.0.0/8"),          # loopback
    ipaddress.ip_network("169.254.0.0/16"),       # link-local + AWS metadata
    ipaddress.ip_network("0.0.0.0/8"),            # "this network"
    ipaddress.ip_network("100.64.0.0/10"),        # CGNAT
    ipaddress.ip_network("192.0.2.0/24"),         # TEST-NET-1
    ipaddress.ip_network("198.51.100.0/24"),      # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),       # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),          # multicast
    ipaddress.ip_network("240.0.0.0/4"),          # reserved
]

_BLOCKED_PREFIXES_V6 = [
    ipaddress.ip_network("::1/128"),              # loopback
    ipaddress.ip_network("fc00::/7"),             # ULA
    ipaddress.ip_network("fe80::/10"),            # link-local
    ipaddress.ip_network("ff00::/8"),             # multicast
    ipaddress.ip_network("fd00::/8"),             # Docker internal
]


def is_blocked_ip(ip_str: str) -> bool:
    """Return True if the IP address is in a blocked range."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # invalid IP = blocked

    networks = _BLOCKED_PREFIXES_V4 if ip.version == 4 else _BLOCKED_PREFIXES_V6
    return any(ip in net for net in networks)


def validate_resolved_ips(hostname: str) -> None:
    """Resolve hostname and raise ValueError if any IP is blocked.

    This provides defense-in-depth against DNS rebinding attacks where
    an allowed hostname resolves to an internal IP.
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise ValueError(f"DNS resolution failed for {hostname}")

    for info in infos:
        ip = info[4][0]
        if is_blocked_ip(ip):
            raise ValueError(f"Hostname {hostname} resolves to blocked IP {ip}")


def safe_url_host(url: str) -> str | None:
    """Extract hostname from URL and validate it. Return None if blocked."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        return None
    try:
        validate_resolved_ips(host)
        return host
    except ValueError:
        return None
