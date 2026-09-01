"""Tests for BMKG CAP feed stale detection."""

from datetime import datetime, timedelta, timezone

from connectors.bmkg_cap import is_feed_stale, newest_pub_date

FRESH_FEED = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><link>https://www.bmkg.go.id/alerts/nowcast/id/NEW1_alert.xml</link>
  <pubDate>Mon, 01 Sep 2026 10:00:00 +0000</pubDate></item>
</channel></rss>"""

STALE_FEED = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><link>https://www.bmkg.go.id/alerts/nowcast/id/OLD1_alert.xml</link>
  <pubDate>Mon, 24 Aug 2026 08:30:00 +0700</pubDate></item>
  <item><link>https://www.bmkg.go.id/alerts/nowcast/id/OLD2_alert.xml</link>
  <pubDate>Mon, 24 Aug 2026 07:24:00 +0700</pubDate></item>
</channel></rss>"""

NO_DATE_FEED = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><link>https://www.bmkg.go.id/alerts/nowcast/id/X_alert.xml</link></item>
</channel></rss>"""


class TestNewestPubDate:
    def test_fresh_feed(self):
        newest = newest_pub_date(FRESH_FEED)
        assert newest is not None
        assert newest.year == 2026 and newest.month == 9

    def test_stale_feed_picks_newest_of_old(self):
        newest = newest_pub_date(STALE_FEED)
        assert newest is not None
        assert newest.month == 8 and newest.day == 24

    def test_no_pubdate(self):
        assert newest_pub_date(NO_DATE_FEED) is None

    def test_empty(self):
        assert newest_pub_date("") is None


class TestIsFeedStale:
    def test_fresh_within_48h(self):
        now = datetime.now(timezone.utc)
        assert is_feed_stale(now - timedelta(hours=24)) is False

    def test_stale_beyond_48h(self):
        old = datetime(2026, 8, 24, 8, 30, tzinfo=timezone.utc)
        assert is_feed_stale(old) is True

    def test_none_is_stale(self):
        # Tanpa item ber-tanggal, anggap stale (aman: UI menampilkan pesan).
        assert is_feed_stale(None) is True

    def test_naive_datetime_treated_as_utc(self):
        naive = datetime.utcnow() - timedelta(hours=1)
        assert is_feed_stale(naive) is False

    def test_custom_threshold(self):
        old = datetime.now(timezone.utc) - timedelta(hours=5)
        assert is_feed_stale(old, max_age_hours=2) is True
        assert is_feed_stale(old, max_age_hours=10) is False
