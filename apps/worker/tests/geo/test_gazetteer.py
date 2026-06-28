"""Tests for geo.gazetteer — local gazetteer matching."""

from geo.gazetteer import gazetteer_match


def test_exact_province():
    assert gazetteer_match("Gempa di Sulawesi Tengah") is not None


def test_abbreviation():
    place, lat, lon = gazetteer_match("Banjir terjang Kaltim")
    assert "kaltim" in place.lower() or abs(lat - 0.539) < 0.1


def test_volcano_name():
    result = gazetteer_match("Erupsi Gunung Merapi memuntahkan lava")
    assert result is not None
    place, lat, lon = result
    assert abs(lat - (-7.541)) < 0.1


def test_longest_match_wins():
    # "jawa tengah" should win over "jawa"
    place, lat, lon = gazetteer_match("Banjir di Jawa Tengah")
    assert "tengah" in place.lower()


def test_no_match_returns_none():
    assert gazetteer_match("Breaking news from New York") is None
