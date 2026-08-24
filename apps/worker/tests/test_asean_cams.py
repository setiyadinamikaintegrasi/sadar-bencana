"""Tests for ASEAN CAMS sync (S8-P7c)."""

import pytest

from connectors.open_meteo_air_quality import ASEAN_HUBS, us_aqi_category


class TestAseanHubs:
    def test_eight_hubs(self):
        assert len(ASEAN_HUBS) == 8

    def test_transboundary_coverage(self):
        countries = {h["country"] for h in ASEAN_HUBS}
        assert {"MY", "SG", "BN", "TH"} <= countries

    def test_no_indonesia_hubs(self):
        # Panel ini khusus lintas batas — domestik ada di Situasi Wilayah.
        assert all(h["country"] != "ID" for h in ASEAN_HUBS)

    def test_hub_codes_unique(self):
        codes = [h["code"] for h in ASEAN_HUBS]
        assert len(codes) == len(set(codes))


class TestAqiCategory:
    def test_categories(self):
        assert us_aqi_category(30) == "Baik"
        assert us_aqi_category(154) == "Tidak Sehat"
