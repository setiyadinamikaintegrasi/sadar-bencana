"""SSRF defense-in-depth for outbound official-source connections."""

from __future__ import annotations

import ipaddress
import socket


def is_blocked_ip(ip_str: str) -> bool:
    """Return True unless the address is globally routable.

    This deny-by-default check also covers IPv4-mapped IPv6, unspecified,
    documentation, reserved, carrier-grade NAT, loopback, link-local,
    multicast, and private address ranges.
    """
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return not ip.is_global


def resolve_public_ips(hostname: str) -> tuple[str, ...]:
    """Resolve once and return only validated public addresses.

    Callers connect to one returned IP while retaining the original hostname
    for HTTP Host and TLS SNI. This prevents a second DNS lookup from changing
    the validated destination.
    """
    try:
        infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f"DNS resolution failed for {hostname}") from exc

    addresses: list[str] = []
    for info in infos:
        ip = info[4][0]
        if is_blocked_ip(ip):
            raise ValueError(f"Hostname {hostname} resolves to blocked IP {ip}")
        if ip not in addresses:
            addresses.append(ip)
    if not addresses:
        raise ValueError(f"DNS resolution returned no addresses for {hostname}")
    return tuple(addresses)
