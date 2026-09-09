"""Tests BMKG regional fallback connector (S13) — offline fixtures only."""

import pathlib
from datetime import datetime, timedelta, timezone

import pytest

from connectors.bmkg_regional import (
    REGIONAL_PROVINCES,
    ESTIMATED_VALIDITY_HOURS,
    is_regional_stale,
    parse_regional_page,
    regional_alert_input,
)

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "bmkg_regional"
WIB = timezone(timedelta(hours=7))


def _fresh_fixture() -> str:
    return (FIXTURES / "sumut_fresh.html").read_text()


def _stale_fixture() -> str:
    return (FIXTURES / "sumut_stale.html").read_text()


def _no_alert_fixture() -> str:
    return (FIXTURES / "jabar_no_alert.html").read_text()


class TestParseRegionalPage:
    def test_fresh_page_parses(self):
        parsed = parse_regional_page(_fresh_fixture(), "12")
        assert parsed is not None
        assert parsed["published_at"] == datetime(2026, 9, 1, 12, 50, tzinfo=WIB)
        assert parsed["alert_id"] == "CSU20260901002"
        assert parsed["province_name"] == "Jawa Barat"  # kode 12 di map kita
        assert parsed["headline"] is not None

    def test_stale_page_parses_with_old_date(self):
        parsed = parse_regional_page(_stale_fixture(), "12")
        assert parsed is not None
        # Fixture stale: tanggal diubah ke 24 Agustus.
        assert parsed["published_at"].month == 8
        assert parsed["published_at"].day == 24

    def test_no_alert_page_returns_none(self):
        # Halaman provinsi tanpa peringatan aktif → None.
        assert parse_regional_page(_no_alert_fixture(), "32") is None

    def test_empty_html_returns_none(self):
        assert parse_regional_page("", "12") is None
        assert parse_regional_page("<html>short</html>", "12") is None

    def test_changed_html_missing_date_returns_none(self):
        # Aturan 9 field hilang: tanpa pola tanggal → None (tidak nebak).
        html = _fresh_fixture().replace("tgl 01 September 2026", "tgl XX")
        assert parse_regional_page(html, "12") is None


class TestIsRegionalStale:
    def test_fresh_within_threshold(self):
        published = datetime(2026, 9, 1, 12, 50, tzinfo=WIB)
        now = published + timedelta(hours=6)
        assert is_regional_stale(published, now=now) is False

    def test_stale_beyond_12h(self):
        published = datetime(2026, 9, 1, 12, 50, tzinfo=WIB)
        now = published + timedelta(hours=13)
        assert is_regional_stale(published, now=now) is True


class TestRegionalAlertInput:
    def test_labeled_bmkg_regional_not_cap(self):
        parsed = parse_regional_page(_fresh_fixture(), "12")
        alert = regional_alert_input(parsed)
        # Aturan 4: label jelas — TIDAK bmkg_cap.
        assert alert.source == "bmkg_regional"
        assert alert.source != "bmkg_cap"

    def test_headline_marked_regional(self):
        parsed = parse_regional_page(_fresh_fixture(), "12")
        alert = regional_alert_input(parsed)
        assert alert.headline is not None
        assert alert.headline.startswith("[BMKG Regional]")

    def test_estimated_expiry(self):
        parsed = parse_regional_page(_fresh_fixture(), "12")
        alert = regional_alert_input(parsed)
        delta = alert.expires_at - alert.effective_at
        assert delta == timedelta(hours=ESTIMATED_VALIDITY_HOURS)

    def test_attribution_in_payload(self):
        parsed = parse_regional_page(_fresh_fixture(), "12")
        alert = regional_alert_input(parsed)
        assert "BMKG" in alert.raw_payload["attribution"]

    def test_peril_weather(self):
        parsed = parse_regional_page(_fresh_fixture(), "12")
        alert = regional_alert_input(parsed)
        assert alert.peril_type == "weather"


class TestProvinceMap:
    def test_34_provinces(self):
        assert len(REGIONAL_PROVINCES) == 34

    def test_codes_two_digit(self):
        for code in REGIONAL_PROVINCES:
            assert len(code) == 2 and code.isdigit()
