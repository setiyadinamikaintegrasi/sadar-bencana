"""Tests for BPJT CCTV connector (S12a)."""

import pytest

from connectors.bpjt_cctv import (
    OPERATOR_NAMES,
    _decode_json,
    _in_indonesia,
    operator_name,
    parse_cameras,
)


SAMPLE_ALLSTREAMS = """const allStreams = {"1":[
  {"unique_id":"479-1-105","camera_id":"479","no_urut_segment":"2",
   "nama_ruas":"Jakarta-Bogor-Ciawi","nama_segment":"CILILITAN - TM MINI",
   "nama_km":"JAGORAWI KM 04+500 | B","bujt":"jm","protocol":"m3u8",
   "status":"1","lat":"-6.2856471909535","lon":"106.877086758614",
   "stream":"https://jid.jasamarga.com/cctv2/abc123?tx=177"},
  {"unique_id":"100-2-5","camera_id":"100","no_urut_segment":"5",
   "nama_ruas":"Terbanggi Besar-Pematang Panggang","nama_segment":"SEGMENT A",
   "nama_km":"TBG KM 10+000","bujt":"hk","protocol":"m3u8",
   "status":"0","lat":"-4.85","lon":"105.25",
   "stream":"https://live.hkj.com/hls/xyz.m3u8"},
  {"unique_id":"999-9-9","camera_id":"999","no_urut_segment":"9",
   "nama_ruas":"Paris Road","nama_segment":"X","nama_km":"PARIS 01",
   "bujt":"xx","protocol":"m3u8","status":"1",
   "lat":"48.85","lon":"2.35","stream":"https://paris.test/x.m3u8"},
  {"unique_id":"888-8-8","camera_id":"888","no_urut_segment":"8",
   "nama_ruas":"Rusak","nama_segment":"","nama_km":"KM 00",
   "bujt":"jm","protocol":"m3u8","status":"1","lat":"bad","lon":"bad",
   "stream":""}
]};"""


class TestDecodeJson:
    def test_extracts_cameras_from_allstreams(self):
        cameras = _decode_json(SAMPLE_ALLSTREAMS)
        assert len(cameras) == 4
        assert cameras[0]["toll_road_id"] == "1"

    def test_raises_when_marker_missing(self):
        with pytest.raises(ValueError):
            _decode_json("no marker here")


class TestInIndonesia:
    def test_jakarta_inside(self):
        assert _in_indonesia(-6.2, 106.8) is True

    def test_paris_outside(self):
        assert _in_indonesia(48.85, 2.35) is False

    def test_papua_inside(self):
        assert _in_indonesia(-4.5, 136.0) is True


class TestOperatorName:
    def test_known_codes(self):
        assert operator_name("jm") == "PT Jasa Marga (Persero) Tbk"
        assert operator_name("hk") == "PT Hutama Karya (Persero)"

    def test_unknown_code(self):
        assert operator_name("zzz") == "BUJT ZZZ"

    def test_all_codes_mapped(self):
        # Setiap kode di OPERATOR_NAMES harus non-kosong & tidak duplikat.
        names = list(OPERATOR_NAMES.values())
        assert all(names)
        assert len(set(names)) == len(names)  # tidak ada duplikat


class TestParseCameras:
    def test_filters_and_normalizes(self):
        parsed = parse_cameras(SAMPLE_ALLSTREAMS)
        # Paris ditolak (luar Indonesia), rusak ditolak (bad coords), sisanya 2.
        assert len(parsed) == 2

        jagorawi = next(p for p in parsed if p["camera_id"] == "479-1-105")
        assert jagorawi["toll_road_name"] == "Jakarta-Bogor-Ciawi"
        assert jagorawi["km_point"] == "JAGORAWI KM 04+500 | B"
        assert jagorawi["operator_code"] == "jm"
        assert jagorawi["is_online"] is True
        assert jagorawi["stream_url"].startswith("https://jid.jasamarga.com/")

        hk = next(p for p in parsed if p["camera_id"] == "100-2-5")
        assert hk["operator_code"] == "hk"
        assert hk["is_online"] is False

    def test_empty_input(self):
        assert parse_cameras("") == []
