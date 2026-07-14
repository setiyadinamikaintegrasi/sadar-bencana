# BMKG Dashboard and EWS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menampilkan peringatan cuaca dan kualitas udara resmi BMKG pada dashboard utama serta mengirimkan peringatan yang relevan ke EWS berdasarkan watch zone.

**Architecture:** Peringatan cuaca dan kualitas udara memakai lifecycle official_alerts yang sudah ada, dengan metadata terstruktur dan pencocokan geospasial PostGIS. Pengukuran PM2.5 disimpan terpisah sebagai air_quality_observations dan tidak pernah memicu notifikasi. Frontend mengambil data melalui API publik untuk dashboard dan endpoint terautentikasi untuk peringatan personal.

**Tech Stack:** PostgreSQL/Supabase + PostGIS, Python 3 worker (Pydantic, asyncpg, httpx, pytest), Go 1.25 API (Gin, database/sql, sqlmock), React 18 + TypeScript 6 + Vite 8 + Leaflet, Vitest.

## Global Constraints

- Jangan melakukan scraping HTML halaman publik BMKG.
- bmkg_air_quality harus nonaktif secara default sampai endpoint machine-readable resmi, format, rate limit, dan izin pemanfaatannya dikonfirmasi.
- Hanya peringatan yang diterbitkan BMKG yang boleh memicu EWS; observasi PM2.5 Tidak Sehat tetap hanya observasi.
- URL sumber wajib HTTPS pada bmkg.go.id atau subdomain resminya, termasuk setelah redirect.
- Atribusi harus tampil sebagai BMKG (Badan Meteorologi, Klimatologi, dan Geofisika).
- raw_payload dan credential tidak boleh dikirim oleh API ke browser.
- Severity kualitas udara: Tidak Sehat = Moderate, Sangat Tidak Sehat = High, Berbahaya = Critical.
- Delivery awal wajib cocok dengan watch zone, peril type, min severity, alert type, kanal, dan revision.
- Update, cancel, dan expiry dikirim kepada penerima revision sebelumnya.
- Kanal tetap email dan Telegram; tidak menambah kanal baru.
- Perubahan mengikuti TDD: test gagal, implementasi minimum, test lulus, lalu commit.

---

## File Map

### Database

- Create: db/schema/040_bmkg_warning_and_air_quality.sql
  Menambah metadata official alert, matched watch zone, PostGIS, tabel observasi PM2.5, dan seed sumber bmkg_air_quality.
- Modify: db/schema/README.md
  Mendokumentasikan migration 040.

### Worker

- Modify: apps/worker/models/official_alert.py
  Memperluas kontrak alert resmi.
- Create: apps/worker/models/air_quality.py
  Mendefinisikan kontrak observasi PM2.5.
- Modify: apps/worker/connectors/bmkg_cap.py
  Mengambil severity, area, dan source URL dari CAP.
- Create: apps/worker/connectors/bmkg_air_quality.py
  Mengambil dan menormalisasi dua koleksi JSON resmi: warnings dan observations.
- Modify: apps/worker/connectors/official_feeds.py
  Mendaftarkan host dan kontrak bmkg_air_quality.
- Modify: apps/worker/db/official_alerts.py
  Menyimpan metadata baru.
- Create: apps/worker/db/air_quality.py
  Upsert dan retensi observasi.
- Modify: apps/worker/db/source_settings.py
  Membaca expected_interval_seconds.
- Modify: apps/worker/alerts/lifecycle_delivery.py
  Memfilter delivery awal dengan PostGIS dan menyimpan watch zone pemicu.
- Modify: apps/worker/main.py
  Menjalankan siklus kualitas udara dan health.

### API

- Modify: apps/api/internal/http/official_alerts.go
  Mengembalikan metadata dan filter peril_type.
- Modify: apps/api/internal/http/map_overlays.go
  Mengembalikan peril type, source URL, dan titik fallback.
- Create: apps/api/internal/http/air_quality.go
  Endpoint latest PM2.5.
- Create: apps/api/internal/http/ews_active_warnings.go
  Endpoint warning aktif yang cocok dengan watch zone pengguna.
- Modify: apps/api/internal/http/ews_me.go
  Memperkaya riwayat notifikasi dengan lifecycle dan watch zone.
- Modify: apps/api/internal/http/official_source_settings.go
  Mendaftarkan host, expected interval, dan validasi source.
- Modify: apps/api/internal/http/official_source_onboarding.go
  Preview/dry-run kontrak warnings + observations.
- Modify: apps/api/cmd/server/main.go
  Mendaftarkan dua route baru.

### Web

- Modify: apps/web/package.json
  Menambah script test dan Vitest.
- Modify: package-lock.json
  Mengunci dependency test.
- Modify: apps/web/src/lib/api/client.ts
  Tipe dan client official alerts serta PM2.5.
- Modify: apps/web/src/lib/api/ews.ts
  Tipe dan client active warnings serta notification metadata.
- Create: apps/web/src/features/executive/bmkgPresentation.ts
  Sorting, severity, freshness, dan format presentasi.
- Create: apps/web/src/features/executive/bmkgPresentation.test.ts
  Unit test presentasi.
- Create: apps/web/src/features/executive/BmkgWarningsPanel.tsx
  Panel segmented Cuaca Ekstrem/Kualitas Udara.
- Modify: apps/web/src/features/executive/ExecutiveOverview.tsx
  Fetch data BMKG dan pasang panel.
- Modify: apps/web/src/components/RiskMap.tsx
  Fokus polygon/titik alert terpilih.
- Create: apps/web/src/features/ews/ActiveWarningsTab.tsx
  Daftar warning personal.
- Modify: apps/web/src/features/ews/EwsPage.tsx
  Tab pertama, peril selector, dan history metadata.
- Modify: apps/web/src/App.tsx
  Navigasi warning EWS ke dashboard map.
- Modify: apps/web/src/features/health/SourceHealthPage.tsx
  Menampilkan bmkg_cap dan bmkg_air_quality.

---

### Task 1: Persist Structured Official Alert Metadata

**Files:**
- Create: db/schema/040_bmkg_warning_and_air_quality.sql
- Modify: db/schema/README.md
- Modify: apps/worker/models/official_alert.py:10-37
- Modify: apps/worker/db/official_alerts.py:12-170
- Modify: apps/worker/tests/db/test_official_alerts.py
- Create: apps/worker/tests/models/test_official_alert.py

**Interfaces:**
- Consumes: Existing OfficialAlertInput and upsert_official_alert(pool, alert).
- Produces: OfficialAlertInput fields peril_type, severity, category, area_name, latitude, longitude, source_url; persisted rows expose the same names.

- [ ] **Step 1: Write failing model tests**

~~~python
from datetime import datetime, timezone
import pytest
from models.official_alert import OfficialAlertInput


def base_alert(**overrides):
    values = {
        "source": "bmkg_cap",
        "source_alert_id": "alert-1",
        "sent_at": datetime(2026, 7, 15, tzinfo=timezone.utc),
        "peril_type": "weather",
        "severity": "High",
        "area_name": "Jawa Barat",
        "source_url": "https://www.bmkg.go.id/alerts/alert-1",
        "raw_payload": {"id": "alert-1"},
    }
    values.update(overrides)
    return OfficialAlertInput(**values)


def test_official_alert_accepts_structured_metadata():
    alert = base_alert(latitude=-6.9, longitude=107.6)
    assert alert.peril_type == "weather"
    assert alert.severity == "High"
    assert alert.latitude == -6.9


def test_official_alert_rejects_invalid_coordinates():
    with pytest.raises(ValueError):
        base_alert(latitude=-91)


def test_official_alert_rejects_malformed_geojson():
    with pytest.raises(ValueError):
        base_alert(area_geojson={"type": "Polygon", "coordinates": [[[107.0, -6.0]]]})
~~~

- [ ] **Step 2: Run the tests and verify failure**

Run:

~~~bash
cd apps/worker
python -m pytest tests/models/test_official_alert.py -q
~~~

Expected: FAIL because OfficialAlertInput does not expose or validate the new fields.

- [ ] **Step 3: Extend the Pydantic model**

Add these exact fields and validators:

~~~python
peril_type: Literal["weather", "air_quality"] | None = None
severity: Literal["Moderate", "High", "Critical"] | None = None
category: str | None = None
area_name: str | None = None
latitude: float | None = Field(default=None, ge=-90, le=90)
longitude: float | None = Field(default=None, ge=-180, le=180)
source_url: str | None = None
~~~

Add source_url validation:

~~~python
from urllib.parse import urlparse


@field_validator("source_url")
@classmethod
def source_url_must_be_official_https(cls, value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("source_url must use HTTPS")
    return value

@field_validator("area_geojson")
@classmethod
def area_geojson_must_be_valid_polygon(
    cls, value: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if value is None:
        return None
    geometry_type = value.get("type")
    coordinates = value.get("coordinates")
    polygons = [coordinates] if geometry_type == "Polygon" else coordinates
    if geometry_type not in {"Polygon", "MultiPolygon"} or not isinstance(polygons, list):
        raise ValueError("area_geojson must be a Polygon or MultiPolygon")
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            raise ValueError("area_geojson polygon must contain rings")
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("area_geojson rings must be closed")
            for point in ring:
                if not isinstance(point, list) or len(point) < 2:
                    raise ValueError("area_geojson positions must contain longitude and latitude")
                longitude, latitude = point[:2]
                if not isinstance(longitude, (int, float)) or not isinstance(latitude, (int, float)):
                    raise ValueError("area_geojson positions must be numeric")
                if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
                    raise ValueError("area_geojson position is outside valid bounds")
    return value
~~~

- [ ] **Step 4: Add migration 040**

Use this schema:

~~~sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE official_alerts
    ADD COLUMN IF NOT EXISTS peril_type VARCHAR(32),
    ADD COLUMN IF NOT EXISTS severity VARCHAR(16),
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS area_name TEXT,
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS source_url TEXT;

ALTER TABLE official_alerts
    DROP CONSTRAINT IF EXISTS official_alerts_peril_type_check,
    DROP CONSTRAINT IF EXISTS official_alerts_severity_check,
    DROP CONSTRAINT IF EXISTS official_alerts_coordinates_check,
    ADD CONSTRAINT official_alerts_peril_type_check
      CHECK (peril_type IS NULL OR peril_type IN ('weather', 'air_quality')),
    ADD CONSTRAINT official_alerts_severity_check
      CHECK (severity IS NULL OR severity IN ('Moderate', 'High', 'Critical')),
    ADD CONSTRAINT official_alerts_coordinates_check
      CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
      );

ALTER TABLE ews_notification_log
    ADD COLUMN IF NOT EXISTS matched_watch_zone_id UUID
      REFERENCES ews_watch_zones(id) ON DELETE SET NULL;

ALTER TABLE official_source_settings
    ADD COLUMN IF NOT EXISTS expected_interval_seconds INT NOT NULL DEFAULT 600
      CHECK (expected_interval_seconds BETWEEN 60 AND 86400);

CREATE TABLE IF NOT EXISTS air_quality_observations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(64) NOT NULL,
    station_id VARCHAR(255) NOT NULL,
    station_name TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    pollutant VARCHAR(16) NOT NULL CHECK (pollutant = 'pm25'),
    value DOUBLE PRECISION NOT NULL CHECK (value >= 0),
    unit VARCHAR(16) NOT NULL DEFAULT 'ug/m3' CHECK (unit = 'ug/m3'),
    category TEXT NOT NULL CHECK (
      category IN ('Baik', 'Sedang', 'Tidak Sehat', 'Sangat Tidak Sehat', 'Berbahaya')
    ),
    observed_at TIMESTAMPTZ NOT NULL,
    source_url TEXT,
    raw_payload JSONB NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
    ),
    UNIQUE (source, station_id, pollutant, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_air_quality_latest
  ON air_quality_observations (source, station_id, pollutant, observed_at DESC);

ALTER TABLE air_quality_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE air_quality_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE air_quality_observations FROM PUBLIC, anon, authenticated;

INSERT INTO ews_safety_guidance (
  peril_type, language_code, content_version, content, curated_by, source_url
) VALUES
(
  'weather', 'id', 'id-v1',
  '{"before":["Pantau pembaruan peringatan resmi BMKG untuk wilayah Anda.","Amankan benda di luar ruang dan siapkan tempat berlindung yang aman."],"during":["Hindari area terbuka, pohon, baliho, dan saluran air saat cuaca ekstrem.","Ikuti arahan BMKG, BPBD, dan petugas setempat."],"after":["Periksa bahaya di sekitar sebelum kembali beraktivitas.","Tetap pantau pembaruan atau pencabutan peringatan resmi."]}',
  'SadarBencana safety editorial',
  'https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca'
),
(
  'air_quality', 'id', 'id-v1',
  '{"before":["Pantau kategori dan periode peringatan kualitas udara BMKG.","Siapkan perlindungan pernapasan sesuai arahan kesehatan resmi."],"during":["Kurangi aktivitas luar ruang, terutama untuk kelompok rentan.","Ikuti arahan BMKG, dinas kesehatan, dan pemerintah setempat."],"after":["Pantau pembaruan kualitas udara sebelum kembali beraktivitas normal.","Cari bantuan medis bila mengalami gangguan kesehatan."]}',
  'SadarBencana safety editorial',
  'https://iklim.bmkg.go.id/en/kualitas-udara-indonesia/'
)
ON CONFLICT (peril_type, language_code, content_version) DO NOTHING;

INSERT INTO official_source_settings (
  source_name, display_name, enabled, mode, default_api_url, attribution,
  terms_url, poll_interval_seconds, expected_interval_seconds, notes
) VALUES (
  'bmkg_air_quality', 'BMKG Kualitas Udara', FALSE, 'custom_api', NULL,
  'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
  'https://www.bmkg.go.id/ketentuan-penggunaan', 3600, 3600,
  'Aktifkan hanya setelah endpoint machine-readable resmi dan izin integrasi dikonfirmasi.'
) ON CONFLICT (source_name) DO NOTHING;

COMMIT;
~~~

- [ ] **Step 5: Extend official alert persistence**

Add the fields to _RETURNING_COLUMNS and _INSERT_SQL, then pass values in this order:

~~~python
alert.peril_type,
alert.severity,
alert.category,
alert.area_name,
alert.latitude,
alert.longitude,
alert.source_url,
~~~

The SQL column segment must be:

~~~sql
peril_type, severity, category, area_name, latitude, longitude, source_url
~~~

- [ ] **Step 6: Update DB tests for the new bind arguments**

Extend the fake row and assertions:

~~~python
assert inserted_args[15:22] == (
    "weather",
    "High",
    None,
    "Jawa Barat",
    -6.9,
    107.6,
    "https://www.bmkg.go.id/alerts/alert-1",
)
~~~

- [ ] **Step 7: Run worker tests**

Run:

~~~bash
cd apps/worker
python -m pytest tests/models/test_official_alert.py tests/db/test_official_alerts.py -q
~~~

Expected: PASS.

- [ ] **Step 8: Document and commit**

Add migration 040 to db/schema/README.md, then:

~~~bash
git add db/schema/040_bmkg_warning_and_air_quality.sql db/schema/README.md apps/worker/models/official_alert.py apps/worker/db/official_alerts.py apps/worker/tests/models/test_official_alert.py apps/worker/tests/db/test_official_alerts.py
git commit -m "feat(data): add BMKG warning metadata"
~~~

---

### Task 2: Normalize BMKG CAP Severity and Area Metadata

**Files:**
- Modify: apps/worker/connectors/bmkg_cap.py:70-220
- Modify: apps/worker/tests/connectors/test_bmkg_cap.py

**Interfaces:**
- Consumes: OfficialAlertInput fields from Task 1.
- Produces: parse_bmkg_cap(xml_text, source_url=None) returns weather metadata with the validated detail URL.

- [ ] **Step 1: Extend the CAP fixture and failing assertions**

Add these CAP elements:

~~~xml
<severity>Severe</severity>
<area>
  <areaDesc>Jawa Barat</areaDesc>
  <polygon>-6.9,107.5 -6.7,107.8 -7.1,107.9</polygon>
</area>
~~~

Assert:

~~~python
assert alert.peril_type == "weather"
assert alert.severity == "High"
assert alert.area_name == "Jawa Barat"
assert alert.source_url is None
~~~

Add parametrized mapping coverage:

~~~python
import pytest


@pytest.mark.parametrize(
    ("cap_value", "expected"),
    [("Minor", "Moderate"), ("Moderate", "Moderate"),
     ("Severe", "High"), ("Extreme", "Critical")],
)
def test_cap_severity_mapping(cap_value, expected):
    alert = parse_bmkg_cap(cap_xml().replace("<severity>Severe</severity>",
                                              "<severity>" + cap_value + "</severity>"))
    assert alert.severity == expected


def test_cap_missing_severity_is_not_deliverable():
    alert = parse_bmkg_cap(cap_xml().replace("<severity>Severe</severity>", ""))
    assert alert.severity is None
~~~

- [ ] **Step 2: Run the parser tests and verify failure**

Run:

~~~bash
cd apps/worker
python -m pytest tests/connectors/test_bmkg_cap.py -q
~~~

Expected: FAIL on missing peril_type, severity, and area_name.

- [ ] **Step 3: Implement CAP metadata helpers**

~~~python
CAP_SEVERITY = {
    "minor": "Moderate",
    "moderate": "Moderate",
    "severe": "High",
    "extreme": "Critical",
}


def _area_name(info: ET.Element) -> str | None:
    names = [
        _child_text(area, "areaDesc")
        for area in _children(info, "area")
        if _child_text(area, "areaDesc")
    ]
    return "; ".join(dict.fromkeys(names)) or None
~~~

Pass to OfficialAlertInput:

~~~python
peril_type="weather",
severity=CAP_SEVERITY.get((_child_text(info, "severity") or "").lower()),
area_name=_area_name(info),
~~~

Pass the detail URL through the parser so validation occurs:

~~~python
def parse_bmkg_cap(
    xml_text: str,
    source_url: str | None = None,
) -> OfficialAlertInput:
    root = ET.fromstring(xml_text)
    if _local_name(root.tag) != "alert":
        raise ValueError("CAP document root must be alert")
    identifier = _child_text(root, "identifier")
    sent_raw = _child_text(root, "sent")
    message_type_raw = (_child_text(root, "msgType") or "Alert").lower()
    if not identifier or not sent_raw:
        raise ValueError("CAP identifier and sent are required")
    message_type_map = {
        "alert": "alert",
        "update": "update",
        "cancel": "cancel",
    }
    if message_type_raw not in message_type_map:
        raise ValueError("unsupported CAP msgType: " + message_type_raw)
    message_type = message_type_map[message_type_raw]
    info = _preferred_info(root)
    effective_raw = _child_text(info, "effective")
    expires_raw = _child_text(info, "expires")
    payload = {
        "format": "CAP-XML",
        "message_identifier": identifier,
        "source_url": source_url,
        "xml": xml_text,
    }
    return OfficialAlertInput(
        source="bmkg_cap",
        source_alert_id=_lifecycle_identifier(root, identifier, message_type),
        message_type=message_type,
        status="cancelled" if message_type == "cancel" else "active",
        sent_at=_parse_datetime(sent_raw, "sent"),
        effective_at=_parse_datetime(effective_raw, "effective") if effective_raw else None,
        expires_at=_parse_datetime(expires_raw, "expires") if expires_raw else None,
        headline=_child_text(info, "headline") or _child_text(info, "event") or None,
        description=_child_text(info, "description") or None,
        area_geojson=_area_geojson(info),
        peril_type="weather",
        severity=CAP_SEVERITY.get((_child_text(info, "severity") or "").lower()),
        area_name=_area_name(info),
        source_url=source_url,
        raw_payload=payload,
    )
~~~

In fetch_active call parse_bmkg_cap(detail.text, source_url=url).

- [ ] **Step 4: Run tests**

Run:

~~~bash
cd apps/worker
python -m pytest tests/connectors/test_bmkg_cap.py tests/db/test_official_alerts.py -q
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/worker/connectors/bmkg_cap.py apps/worker/tests/connectors/test_bmkg_cap.py
git commit -m "feat(worker): normalize BMKG CAP metadata"
~~~

---

### Task 3: Expose Structured Official Alerts and Map Metadata

**Files:**
- Modify: apps/api/internal/http/official_alerts.go
- Modify: apps/api/internal/http/official_alerts_test.go
- Modify: apps/api/internal/http/map_overlays.go
- Create: apps/api/internal/http/map_overlays_test.go

**Interfaces:**
- Consumes: official_alerts columns from Task 1.
- Produces: GET /api/v1/official-alerts?peril_type=weather and enriched MapOverlay response.

- [ ] **Step 1: Write failing validation tests**

~~~go
func TestOfficialAlertPerilTypes(t *testing.T) {
    for _, peril := range []string{"weather", "air_quality"} {
        if !officialAlertPerilTypes[peril] {
            t.Fatalf("expected %q to be accepted", peril)
        }
    }
    if officialAlertPerilTypes["earthquake"] {
        t.Fatal("unsupported peril accepted")
    }
}

func TestOfficialAlertsReturnsStructuredMetadataWithoutRawPayload(t *testing.T) {
    gin.SetMode(gin.TestMode)
    db, mock, err := sqlmock.New()
    if err != nil { t.Fatal(err) }
    defer db.Close()
    now := time.Now()
    columns := []string{
        "id", "source", "source_alert_id", "revision", "message_type", "status",
        "sent_at", "effective_at", "expires_at", "headline", "description",
        "area_geojson", "previous_alert_id", "is_current", "ingested_at",
        "peril_type", "severity", "category", "area_name", "latitude",
        "longitude", "source_url",
    }
    mock.ExpectQuery("FROM official_alerts").
        WithArgs("", "", false, "weather", 100).
        WillReturnRows(sqlmock.NewRows(columns).AddRow(
            "alert-1", "bmkg_cap", "cap-1", 1, "alert", "active", now,
            now, now.Add(time.Hour), "Peringatan Dini Cuaca", "Hujan lebat",
            []byte(`{"type":"Polygon","coordinates":[]}`), nil, true, now,
            "weather", "High", nil, "Jawa Barat", nil, nil,
            "https://www.bmkg.go.id/alerts/alert-1",
        ))
    recorder := httptest.NewRecorder()
    context, _ := gin.CreateTestContext(recorder)
    context.Request = httptest.NewRequest(http.MethodGet,
        "/api/v1/official-alerts?peril_type=weather", nil)
    OfficialAlerts(db)(context)
    var body map[string]any
    if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil { t.Fatal(err) }
    item := body["data"].([]any)[0].(map[string]any)
    if item["peril_type"] != "weather" || item["severity"] != "High" ||
        item["area_name"] != "Jawa Barat" {
        t.Fatalf("missing metadata: %#v", item)
    }
    if _, exists := item["raw_payload"]; exists { t.Fatal("raw_payload leaked") }
    if err := mock.ExpectationsWereMet(); err != nil { t.Fatal(err) }
}
~~~

Import encoding/json, net/http, net/http/httptest, testing, time, gin, and
sqlmock.

- [ ] **Step 2: Run API tests and verify failure**

Run:

~~~bash
cd apps/api
go test ./internal/http -run 'TestOfficialAlert' -count=1
~~~

Expected: FAIL because peril_type validation and response fields do not exist.

- [ ] **Step 3: Extend the handler**

Add fields:

~~~go
PerilType  *string  `json:"peril_type"`
Severity   *string  `json:"severity"`
Category   *string  `json:"category"`
AreaName   *string  `json:"area_name"`
Latitude   *float64 `json:"latitude"`
Longitude  *float64 `json:"longitude"`
SourceURL  *string  `json:"source_url"`
~~~

Add the filter:

~~~go
var officialAlertPerilTypes = map[string]bool{
    "weather": true,
    "air_quality": true,
}
~~~

Change the query to include:

~~~sql
AND ($4 = '' OR peril_type = $4)
ORDER BY sent_at DESC, revision DESC
LIMIT $5
~~~

Return HTTP 400 invalid_peril_type for unsupported values.

- [ ] **Step 4: Enrich map overlays**

Select and scan:

~~~sql
SELECT id, headline, area_geojson, latitude, longitude, effective_at,
       expires_at, source, peril_type, source_url
FROM official_alerts
WHERE is_current = TRUE
  AND status = 'active'
  AND (area_geojson IS NOT NULL OR (latitude IS NOT NULL AND longitude IS NOT NULL))
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY sent_at DESC
LIMIT 200
~~~

Set Attribution to the full BMKG attribution when source begins with bmkg, and preserve PerilType, SourceURL, Latitude, and Longitude.

- [ ] **Step 5: Run API tests**

Run:

~~~bash
cd apps/api
go test ./internal/http -run 'TestOfficialAlert|TestMapOverlay' -count=1
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add apps/api/internal/http/official_alerts.go apps/api/internal/http/official_alerts_test.go apps/api/internal/http/map_overlays.go apps/api/internal/http/map_overlays_test.go
git commit -m "feat(api): expose BMKG official warning metadata"
~~~

---

### Task 4: Restrict Official Lifecycle Delivery to Matching Watch Zones

**Files:**
- Modify: apps/worker/alerts/lifecycle_delivery.py:16-156
- Modify: apps/worker/tests/alerts/test_lifecycle_delivery.py

**Interfaces:**
- Consumes: official alert id, geometry/titik, peril_type, severity, preferences, and watch zones.
- Produces: enqueue_official_alert_revision(pool, alert) inserts at most one row per subscriber/channel/revision with matched_watch_zone_id.

- [ ] **Step 1: Write failing enqueue tests**

~~~python
def fake_pool(returning):
    conn = AsyncMock()
    conn.fetch.return_value = returning
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    return pool, conn


@pytest.mark.asyncio
async def test_active_delivery_requires_matching_zone_and_preferences():
    pool, conn = fake_pool([{"id": "delivery-1"}])
    alert = {
        "id": "alert-1", "source": "bmkg_cap",
        "source_alert_id": "cap-1", "revision": 1,
        "message_type": "alert", "status": "active",
    }
    assert await enqueue_official_alert_revision(pool, alert) == 1
    sql = conn.fetch.await_args.args[0]
    for fragment in (
        "ST_Intersects", "ST_DWithin", "peril_types",
        "min_severity", "alert_types", "matched_watch_zone_id",
    ):
        assert fragment in sql


@pytest.mark.asyncio
async def test_cancel_uses_prior_recipients_without_geo_rematch():
    pool, conn = fake_pool([])
    alert = {
        "id": "alert-2", "source": "bmkg_cap",
        "source_alert_id": "cap-1", "revision": 2,
        "message_type": "cancel", "status": "cancelled",
    }
    await enqueue_official_alert_revision(pool, alert)
    sql = conn.fetch.await_args.args[0]
    assert "matched_watch_zone_id" in sql
    assert "ST_Intersects" not in sql


@pytest.mark.asyncio
async def test_update_uses_prior_recipients_without_geo_rematch():
    pool, conn = fake_pool([])
    alert = {
        "id": "alert-2", "source": "bmkg_cap",
        "source_alert_id": "cap-1", "revision": 2,
        "message_type": "update", "status": "active",
    }
    await enqueue_official_alert_revision(pool, alert)
    sql = conn.fetch.await_args.args[0]
    assert "matched_watch_zone_id" in sql
    assert "ST_Intersects" not in sql
~~~

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~bash
cd apps/worker
python -m pytest tests/alerts/test_lifecycle_delivery.py -q
~~~

Expected: FAIL because the active query only checks that any watch zone exists.

- [ ] **Step 3: Replace the active enqueue query**

Use a lateral match to select one deterministic zone:

~~~sql
INSERT INTO ews_notification_log (
  subscriber_id, official_alert_id, channel, status, source, source_alert_id,
  alert_revision, lifecycle_action, next_attempt_at, correlation_id,
  delivery_kind, matched_watch_zone_id
)
SELECT s.id, oa.id, p.channel, 'pending', oa.source, oa.source_alert_id,
       oa.revision, $2, now(), $3, 'official_lifecycle', matched.id
FROM official_alerts oa
JOIN ews_subscribers s ON s.is_active = TRUE
JOIN ews_notification_prefs p
  ON p.subscriber_id = s.id AND p.is_enabled = TRUE
JOIN ews_channel_settings cs
  ON cs.channel = p.channel AND cs.is_enabled = TRUE
JOIN LATERAL (
  SELECT z.id
  FROM ews_watch_zones z
  WHERE z.subscriber_id = s.id
    AND z.is_active = TRUE
    AND (cardinality(z.peril_types) = 0 OR oa.peril_type = ANY(z.peril_types))
    AND (
      (oa.area_geojson IS NOT NULL AND ST_Intersects(
        ST_SetSRID(ST_GeomFromGeoJSON(oa.area_geojson::text), 4326)::geography,
        ST_Buffer(
          ST_SetSRID(ST_MakePoint(z.longitude, z.latitude), 4326)::geography,
          z.radius_km * 1000
        )
      ))
      OR
      (oa.latitude IS NOT NULL AND oa.longitude IS NOT NULL AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(oa.longitude, oa.latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(z.longitude, z.latitude), 4326)::geography,
        z.radius_km * 1000
      ))
    )
  ORDER BY z.created_at, z.id
  LIMIT 1
) matched ON TRUE
WHERE oa.id = $1
  AND oa.severity IS NOT NULL
  AND CASE oa.severity WHEN 'Critical' THEN 3 WHEN 'High' THEN 2 ELSE 1 END
      >= CASE p.min_severity WHEN 'Critical' THEN 3 WHEN 'High' THEN 2 ELSE 1 END
  AND (cardinality(p.alert_types) = 0 OR oa.peril_type = ANY(p.alert_types))
ON CONFLICT DO NOTHING
RETURNING id
~~~

Change active call arguments to alert id, lifecycle action, correlation id. Use
this projection in the prior-recipient query so the latest successful delivery
per subscriber/channel retains its original matched zone:

~~~sql
SELECT DISTINCT ON (l.subscriber_id, l.channel)
       l.subscriber_id, $1, l.channel, 'pending', $2, $3, $4, $5, now(), $6,
       'official_lifecycle', l.matched_watch_zone_id
FROM ews_notification_log l
JOIN ews_channel_settings cs
  ON cs.channel = l.channel AND cs.is_enabled = TRUE
WHERE l.source = $2
  AND l.source_alert_id = $3
  AND l.status IN ('sent', 'acknowledged')
ORDER BY l.subscriber_id, l.channel, l.alert_revision DESC, l.created_at DESC
~~~

Include matched_watch_zone_id in the INSERT column list. Select
_ENQUEUE_PRIOR_RECIPIENTS_SQL when action is update, cancellation, or expiry;
only action alert uses the geospatial initial-delivery query:

~~~python
sql = (
    _ENQUEUE_PRIOR_RECIPIENTS_SQL
    if action in {"update", "cancellation", "expiry"}
    else _ENQUEUE_ACTIVE_SQL
)
~~~

- [ ] **Step 4: Include official severity and type in delivery content**

In _CLAIM_DUE_SQL use:

~~~sql
COALESCE(oa.severity, a.severity, '') AS severity,
COALESCE(oa.peril_type, a.alert_type, c.lifecycle_action, 'alert') AS alert_type
~~~

- [ ] **Step 5: Run lifecycle and dispatcher tests**

Run:

~~~bash
cd apps/worker
python -m pytest tests/alerts/test_lifecycle_delivery.py tests/integration/test_ews_dispatch.py -q
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add apps/worker/alerts/lifecycle_delivery.py apps/worker/tests/alerts/test_lifecycle_delivery.py
git commit -m "fix(ews): match official warnings to watch zones"
~~~

---

### Task 5: Add Personalized Active Warning API

**Files:**
- Create: apps/api/internal/http/ews_active_warnings.go
- Create: apps/api/internal/http/ews_active_warnings_test.go
- Modify: apps/api/internal/http/ews_me.go:506-559
- Modify: apps/api/cmd/server/main.go:220-245

**Interfaces:**
- Consumes: Authenticated subscriber context and PostGIS alert/watch-zone data.
- Produces: EWSMeActiveWarnings(db) and enriched EWSMeNotifications(db).

- [ ] **Step 1: Write failing sqlmock tests**

~~~go
func TestEWSMeActiveWarningsIsScopedToAuthenticatedSubscriber(t *testing.T) {
gin.SetMode(gin.TestMode)
db, mock, err := sqlmock.New()
if err != nil { t.Fatal(err) }
defer db.Close()
mock.ExpectQuery("SELECT id FROM ews_subscribers").WithArgs("user-1").
    WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("subscriber-1"))
rows := sqlmock.NewRows([]string{
    "id", "source", "message_type", "status", "sent_at", "peril_type", "severity", "category", "headline",
    "description", "area_name", "effective_at", "expires_at", "source_url",
    "area_geojson", "latitude", "longitude",
    "matched_watch_zone_ids", "matched_watch_zone_labels", "guidance", "guidance_source",
}).AddRow(
    "alert-1", "bmkg_cap", "update", "active", time.Now(), "weather", "High", nil,
    "Peringatan Dini Cuaca", "Hujan lebat", "Jawa Barat",
    time.Now(), time.Now().Add(time.Hour),
    "https://www.bmkg.go.id/alerts/alert-1",
    []byte(`{"type":"Polygon","coordinates":[]}`),
    nil, nil, []byte(`["zone-1"]`), []byte(`["Rumah"]`),
    []byte(`{"before":[],"during":["Hindari area terbuka."],"after":[]}`),
    "https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca",
)
mock.ExpectQuery("FROM official_alerts oa").WithArgs("subscriber-1", 100).
    WillReturnRows(rows)
recorder := httptest.NewRecorder()
context, _ := gin.CreateTestContext(recorder)
context.Set(ctxAuthUserID, "user-1")
context.Set(ctxAuthEmail, "user@example.test")
context.Request = httptest.NewRequest(http.MethodGet,
    "/api/v1/ews/me/active-warnings", nil)
EWSMeActiveWarnings(db)(context)
if recorder.Code != http.StatusOK { t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body) }
var body struct { Data []EWSActiveWarning `json:"data"` }
if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil { t.Fatal(err) }
if len(body.Data) != 1 || body.Data[0].Source != "bmkg_cap" {
    t.Fatalf("unexpected data: %#v", body.Data)
}
if !reflect.DeepEqual(body.Data[0].MatchedWatchZoneLabels, []string{"Rumah"}) {
    t.Fatalf("unexpected zones: %#v", body.Data[0].MatchedWatchZoneLabels)
}
if err := mock.ExpectationsWereMet(); err != nil { t.Fatal(err) }
}

func TestEWSMeNotificationsMetadata(t *testing.T) {
    gin.SetMode(gin.TestMode)
    db, mock, err := sqlmock.New()
    if err != nil { t.Fatal(err) }
    defer db.Close()
    mock.ExpectQuery("SELECT id FROM ews_subscribers").WithArgs("user-1").
        WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("subscriber-1"))
    now := time.Now()
    rows := sqlmock.NewRows([]string{
        "id", "alert_id", "channel", "status", "error_message", "sent_at",
        "created_at", "headline", "peril_type", "lifecycle_action",
        "matched_watch_zone_label",
    }).AddRow("notification-1", nil, "email", "sent", nil, now, now,
        "Peringatan Dini Cuaca", "weather", "update", "Rumah")
    mock.ExpectQuery("FROM ews_notification_log l").WithArgs("subscriber-1", 100).
        WillReturnRows(rows)
    recorder := httptest.NewRecorder()
    context, _ := gin.CreateTestContext(recorder)
    context.Set(ctxAuthUserID, "user-1")
    context.Set(ctxAuthEmail, "user@example.test")
    context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/ews/me/notifications", nil)
    EWSMeNotifications(db)(context)
    var body struct { Data []map[string]any `json:"data"` }
    if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil { t.Fatal(err) }
    row := body.Data[0]
    if row["headline"] != "Peringatan Dini Cuaca" || row["peril_type"] != "weather" ||
        row["lifecycle_action"] != "update" || row["matched_watch_zone_label"] != "Rumah" {
        t.Fatalf("missing lifecycle metadata: %#v", row)
    }
    if err := mock.ExpectationsWereMet(); err != nil { t.Fatal(err) }
}
~~~

Import encoding/json, net/http, net/http/httptest, reflect, testing, time, gin,
and sqlmock.

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~bash
cd apps/api
go test ./internal/http -run 'TestEWSMeActiveWarnings|TestEWSMeNotificationsMetadata' -count=1
~~~

Expected: FAIL because the handler and metadata are absent.

- [ ] **Step 3: Implement EWSMeActiveWarnings**

Define with exact JSON tags:

~~~go
type EWSActiveWarning struct {
    ID                     string          `json:"id"`
    Source                 string          `json:"source"`
    MessageType            string          `json:"message_type"`
    Status                 string          `json:"status"`
    SentAt                 time.Time       `json:"sent_at"`
    PerilType              string          `json:"peril_type"`
    Severity               string          `json:"severity"`
    Category               *string         `json:"category"`
    Headline               *string         `json:"headline"`
    Description            *string         `json:"description"`
    AreaName               *string         `json:"area_name"`
    EffectiveAt            *time.Time      `json:"effective_at"`
    ExpiresAt              *time.Time      `json:"expires_at"`
    SourceURL              *string         `json:"source_url"`
    AreaGeoJSON            json.RawMessage `json:"area_geojson"`
    Latitude               *float64        `json:"latitude"`
    Longitude              *float64        `json:"longitude"`
    MatchedWatchZoneIDs    []string        `json:"matched_watch_zone_ids"`
    MatchedWatchZoneLabels []string        `json:"matched_watch_zone_labels"`
    Guidance               json.RawMessage `json:"guidance"`
    GuidanceSource         *string         `json:"guidance_source"`
}
~~~

Use this query. The two array_to_json aggregates scan as JSON bytes in
database/sql:

~~~sql
SELECT oa.id, oa.source, oa.message_type, oa.status, oa.sent_at, oa.peril_type, oa.severity,
       oa.category, oa.headline, oa.description, oa.area_name,
       oa.effective_at, oa.expires_at, oa.source_url, oa.area_geojson,
       oa.latitude, oa.longitude,
       array_to_json(array_agg(DISTINCT z.id::text)),
       array_to_json(array_agg(DISTINCT z.label)),
       guidance.content, guidance.source_url
FROM official_alerts oa
JOIN ews_watch_zones z
  ON z.subscriber_id = $1
 AND z.is_active = TRUE
 AND (cardinality(z.peril_types) = 0 OR oa.peril_type = ANY(z.peril_types))
 AND (
   (oa.area_geojson IS NOT NULL AND ST_Intersects(
     ST_SetSRID(ST_GeomFromGeoJSON(oa.area_geojson::text), 4326)::geography,
     ST_Buffer(
       ST_SetSRID(ST_MakePoint(z.longitude, z.latitude), 4326)::geography,
       z.radius_km * 1000
     )
   ))
   OR
   (oa.latitude IS NOT NULL AND oa.longitude IS NOT NULL AND ST_DWithin(
     ST_SetSRID(ST_MakePoint(oa.longitude, oa.latitude), 4326)::geography,
     ST_SetSRID(ST_MakePoint(z.longitude, z.latitude), 4326)::geography,
     z.radius_km * 1000
   ))
 )
LEFT JOIN ews_safety_guidance guidance
  ON guidance.peril_type = oa.peril_type
 AND guidance.language_code = 'id'
 AND guidance.is_active = TRUE
WHERE oa.is_current = TRUE
  AND oa.status = 'active'
  AND (oa.effective_at IS NULL OR oa.effective_at <= now())
  AND (oa.expires_at IS NULL OR oa.expires_at > now())
GROUP BY oa.id, guidance.content, guidance.source_url
ORDER BY CASE oa.severity
           WHEN 'Critical' THEN 3 WHEN 'High' THEN 2 ELSE 1
         END DESC,
         COALESCE(oa.effective_at, oa.sent_at) DESC
LIMIT $2
~~~

The API returns stored before/during/after arrays verbatim and never generates
safety text.

- [ ] **Step 4: Enrich notification history**

Change the query to:

~~~sql
SELECT l.id, l.alert_id, l.channel, l.status, l.error_message, l.sent_at,
       l.created_at, oa.headline, oa.peril_type, l.lifecycle_action, z.label
FROM ews_notification_log l
LEFT JOIN official_alerts oa ON oa.id = l.official_alert_id
LEFT JOIN ews_watch_zones z ON z.id = l.matched_watch_zone_id
WHERE l.subscriber_id = $1
ORDER BY l.created_at DESC
LIMIT $2
~~~

Return nullable headline, peril_type, lifecycle_action, and matched_watch_zone_label.

- [ ] **Step 5: Register the route**

Inside the authenticated /api/v1/ews/me group:

~~~go
ewsMe.GET("/active-warnings", apihttp.EWSMeActiveWarnings(dbPool))
~~~

- [ ] **Step 6: Run API tests**

Run:

~~~bash
cd apps/api
go test ./internal/http -run 'TestEWSMeActiveWarnings|TestEWSMeNotificationsMetadata' -count=1
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add apps/api/internal/http/ews_active_warnings.go apps/api/internal/http/ews_active_warnings_test.go apps/api/internal/http/ews_me.go apps/api/cmd/server/main.go
git commit -m "feat(api): add personalized BMKG warnings"
~~~

---

### Task 6: Persist BMKG PM2.5 Observations

**Files:**
- Create: apps/worker/models/air_quality.py
- Create: apps/worker/db/air_quality.py
- Create: apps/worker/tests/models/test_air_quality.py
- Create: apps/worker/tests/db/test_air_quality.py

**Interfaces:**
- Produces: AirQualityObservationInput and upsert_air_quality_observation(pool, observation) -> tuple[dict, bool].

- [ ] **Step 1: Write failing model tests**

~~~python
def observation(**overrides):
    values = {
        "source": "bmkg", "station_id": "kmy3",
        "station_name": "Kemayoran", "pollutant": "pm25",
        "value": 66.2, "unit": "µg/m³", "category": "Tidak Sehat",
        "observed_at": datetime(2026, 7, 15, tzinfo=timezone.utc),
        "source_url": "https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
        "raw_payload": {"station": "kmy3"},
    }
    values.update(overrides)
    return AirQualityObservationInput(**values)


def test_pm25_unit_is_normalized():
    assert observation().unit == "ug/m3"


def test_unknown_category_is_rejected():
    with pytest.raises(ValueError):
        observation(category="Unknown")
~~~

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~bash
cd apps/worker
python -m pytest tests/models/test_air_quality.py -q
~~~

Expected: FAIL because models.air_quality does not exist.

- [ ] **Step 3: Create the observation model**

~~~python
class AirQualityObservationInput(BaseModel):
    source: Literal["bmkg"] = "bmkg"
    station_id: str = Field(min_length=1, max_length=255)
    station_name: str = Field(min_length=1)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    pollutant: Literal["pm25"] = "pm25"
    value: float = Field(ge=0)
    unit: str
    category: Literal[
        "Baik", "Sedang", "Tidak Sehat", "Sangat Tidak Sehat", "Berbahaya"
    ]
    observed_at: datetime
    source_url: str | None = None
    raw_payload: dict[str, Any]

    @field_validator("unit")
    @classmethod
    def normalize_unit(cls, value: str) -> str:
        if value.strip().lower() not in {"ug/m3", "µg/m³", "μg/m³"}:
            raise ValueError("PM2.5 unit must be micrograms per cubic meter")
        return "ug/m3"

    @field_validator("observed_at")
    @classmethod
    def observed_at_must_have_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("observed_at must include a timezone")
        return value

    @field_validator("source_url")
    @classmethod
    def source_url_must_be_official_bmkg(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme != "https" or not (
            host == "bmkg.go.id" or host.endswith(".bmkg.go.id")
        ):
            raise ValueError("source_url must use an official BMKG HTTPS host")
        return value
~~~

Import datetime, urlparse, Any, Literal, BaseModel, Field, and field_validator.

- [ ] **Step 4: Write failing DB tests**

~~~python
@pytest.mark.asyncio
async def test_upsert_returns_created_row():
    pool, conn = fake_pool(fetchrow={"id": "obs-1", "station_id": "kmy3"})
    row, created = await upsert_air_quality_observation(pool, observation())
    assert created is True
    assert row["station_id"] == "kmy3"
    args = conn.fetchrow.await_args.args
    assert args[1:4] == ("bmkg", "kmy3", "Kemayoran")


@pytest.mark.asyncio
async def test_duplicate_returns_not_created():
    pool, _ = fake_pool(fetchrow=None)
    row, created = await upsert_air_quality_observation(pool, observation())
    assert row == {}
    assert created is False
~~~

- [ ] **Step 5: Implement upsert and retention**

~~~python
_UPSERT_SQL = """
INSERT INTO air_quality_observations (
  source, station_id, station_name, latitude, longitude, pollutant, value,
  unit, category, observed_at, source_url, raw_payload
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
ON CONFLICT (source, station_id, pollutant, observed_at) DO NOTHING
RETURNING id, source, station_id, station_name, latitude, longitude, pollutant,
          value, unit, category, observed_at, source_url, ingested_at
"""

_DELETE_OLD_SQL = """
DELETE FROM air_quality_observations
WHERE observed_at < $1 - interval '30 days'
"""
~~~

Expose upsert_air_quality_observation(pool, observation) and delete_old_air_quality_observations(pool, now=None).

- [ ] **Step 6: Run tests**

Run:

~~~bash
cd apps/worker
python -m pytest tests/models/test_air_quality.py tests/db/test_air_quality.py -q
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add apps/worker/models/air_quality.py apps/worker/db/air_quality.py apps/worker/tests/models/test_air_quality.py apps/worker/tests/db/test_air_quality.py
git commit -m "feat(worker): persist BMKG PM2.5 observations"
~~~

---

### Task 7: Add the Gated BMKG Air Quality Adapter and Worker Cycle

**Files:**
- Create: apps/worker/connectors/bmkg_air_quality.py
- Create: apps/worker/tests/connectors/test_bmkg_air_quality.py
- Modify: apps/worker/connectors/official_feeds.py:14-25
- Modify: apps/worker/db/source_settings.py:12-82
- Modify: apps/worker/tests/db/test_source_settings.py
- Modify: apps/worker/main.py:330-515
- Modify: apps/api/internal/http/official_source_settings.go
- Modify: apps/api/internal/http/official_source_onboarding.go
- Modify: apps/api/internal/http/official_source_settings_test.go
- Modify: apps/api/internal/http/official_source_onboarding_test.go
- Modify: apps/web/src/lib/api/client.ts
- Modify: apps/web/src/features/settings/OfficialSourcesSettingsPage.tsx

**Interfaces:**
- Consumes: A configured official HTTPS endpoint and field_mapping.
- Produces: parse_air_quality_payload(payload, mapping) -> tuple[list[OfficialAlertInput], list[AirQualityObservationInput], list[str]].
- Produces: BMKGAirQualityConnector(url, client=None).fetch_payload() -> dict[str, Any].
- Activation gate: source remains disabled until preview and dry-run succeed against an approved endpoint.

- [ ] **Step 1: Write the canonical fixture tests**

~~~python
PAYLOAD = {
    "warnings": [{
        "source_alert_id": "aq-jabar-20260715",
        "message_type": "alert",
        "status": "active",
        "sent_at": "2026-07-15T08:00:00+07:00",
        "effective_at": "2026-07-16T00:00:00+07:00",
        "expires_at": "2026-07-17T00:00:00+07:00",
        "category": "Tidak Sehat",
        "area_name": "Jawa Barat",
        "area_geojson": {
            "type": "Polygon",
            "coordinates": [[[106, -7], [108, -7], [108, -6], [106, -7]]],
        },
        "headline": "Peringatan Dini Kualitas Udara Jawa Barat",
        "description": "Potensi kualitas udara tidak sehat.",
        "source_url": "https://iklim.bmkg.go.id/kualitas-udara-indonesia/",
    }],
    "observations": [{
        "station_id": "kmy3", "station_name": "Kemayoran",
        "latitude": -6.155, "longitude": 106.84,
        "value": 66.2, "unit": "ug/m3", "category": "Tidak Sehat",
        "observed_at": "2026-07-15T04:00:00+07:00",
        "source_url": "https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
    }],
}


def test_parser_separates_official_warning_and_observation():
    warnings, observations, errors = parse_air_quality_payload(PAYLOAD, {})
    assert errors == []
    assert warnings[0].peril_type == "air_quality"
    assert warnings[0].severity == "Moderate"
    assert observations[0].station_id == "kmy3"


def test_baik_is_observation_but_not_warning():
    payload = deepcopy(PAYLOAD)
    payload["warnings"][0]["category"] = "Baik"
    warnings, observations, errors = parse_air_quality_payload(payload, {})
    assert warnings == []
    assert len(observations) == 1
    assert errors == ["warning aq-jabar-20260715: category is not extreme"]


@pytest.mark.parametrize(
    ("category", "severity"),
    [("Tidak Sehat", "Moderate"),
     ("Sangat Tidak Sehat", "High"),
     ("Berbahaya", "Critical")],
)
def test_warning_category_maps_to_severity(category, severity):
    payload = deepcopy(PAYLOAD)
    payload["warnings"][0]["category"] = category
    warnings, _, errors = parse_air_quality_payload(payload, {})
    assert errors == []
    assert warnings[0].severity == severity


def test_warning_update_preserves_lifecycle_identity():
    payload = deepcopy(PAYLOAD)
    payload["warnings"][0]["message_type"] = "update"
    payload["warnings"][0]["sent_at"] = "2026-07-15T09:00:00+07:00"
    warnings, _, errors = parse_air_quality_payload(payload, {})
    assert errors == []
    assert warnings[0].source_alert_id == "aq-jabar-20260715"
    assert warnings[0].message_type == "update"


def test_observation_without_coordinates_remains_displayable():
    payload = deepcopy(PAYLOAD)
    payload["observations"][0]["latitude"] = None
    payload["observations"][0]["longitude"] = None
    _, observations, errors = parse_air_quality_payload(payload, {})
    assert errors == []
    assert observations[0].latitude is None
    assert observations[0].longitude is None


def test_schema_drift_is_rejected_before_record_processing():
    with pytest.raises(ValueError, match="warnings and observations must be arrays"):
        parse_air_quality_payload({"warnings": {}, "observations": []}, {})


def test_connector_rejects_unofficial_host():
    with pytest.raises(ValueError, match="official BMKG"):
        BMKGAirQualityConnector("https://evil.example/air-quality")


@pytest.mark.parametrize("category", ["Baik", "Sedang"])
def test_non_extreme_observation_never_becomes_warning(category):
    payload = deepcopy(PAYLOAD)
    payload["warnings"] = []
    payload["observations"][0]["category"] = category
    warnings, observations, errors = parse_air_quality_payload(payload, {})
    assert errors == []
    assert warnings == []
    assert observations[0].category == category


@pytest.mark.parametrize(
    ("field", "value", "expected_fragment"),
    [
        ("observed_at", "2026-07-15T04:00:00",
         "timezone"),
        ("source_url", "https://evil.example/data",
         "official BMKG HTTPS host"),
        ("longitude", 181,
         "longitude"),
    ],
)
def test_invalid_record_preserves_valid_sibling(field, value, expected_fragment):
    payload = deepcopy(PAYLOAD)
    invalid = deepcopy(payload["observations"][0])
    invalid["station_id"] = "bad"
    invalid[field] = value
    payload["observations"].append(invalid)
    _, observations, errors = parse_air_quality_payload(payload, {})
    assert [item.station_id for item in observations] == ["kmy3"]
    assert len(errors) == 1
    assert errors[0].startswith("observation bad:")
    assert expected_fragment in errors[0]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [302, 429, 503])
async def test_redirect_rate_limit_and_upstream_errors_are_rejected(monkeypatch, status):
    monkeypatch.setattr("connectors.bmkg_air_quality.resolve_public_ips",
                        lambda _: ["203.0.113.10"])
    client = httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(status, headers={"Location": "https://evil.example/data"})
    ))
    connector = BMKGAirQualityConnector(
        "https://iklim.bmkg.go.id/api/air-quality", client=client,
    )
    try:
        with pytest.raises(httpx.HTTPStatusError):
            await connector.fetch_payload()
    finally:
        await connector.close()
        await client.aclose()


@pytest.mark.asyncio
async def test_timeout_is_reported(monkeypatch):
    monkeypatch.setattr("connectors.bmkg_air_quality.resolve_public_ips",
                        lambda _: ["203.0.113.10"])
    def timeout(request):
        raise httpx.ReadTimeout("timed out", request=request)
    client = httpx.AsyncClient(transport=httpx.MockTransport(timeout))
    connector = BMKGAirQualityConnector(
        "https://iklim.bmkg.go.id/api/air-quality", client=client,
    )
    try:
        with pytest.raises(httpx.ReadTimeout):
            await connector.fetch_payload()
    finally:
        await connector.close()
        await client.aclose()
~~~

- [ ] **Step 2: Run connector tests and verify failure**

Run:

~~~bash
cd apps/worker
python -m pytest tests/connectors/test_bmkg_air_quality.py -q
~~~

Expected: FAIL because the connector does not exist.

- [ ] **Step 3: Implement the dedicated parser**

~~~python
AIR_QUALITY_SEVERITY = {
    "Tidak Sehat": "Moderate",
    "Sangat Tidak Sehat": "High",
    "Berbahaya": "Critical",
}

DEFAULT_MAPPING = {
    "__warnings": "warnings",
    "__observations": "observations",
}
~~~

Use these exact mapping helpers:

~~~python
def _mapped_value(value: Any, path: str) -> Any:
    current = value
    for segment in path.split("."):
        if not isinstance(current, dict) or segment not in current:
            return None
        current = current[segment]
    return current


def _mapped_record(
    record: dict[str, Any],
    prefix: str,
    mapping: dict[str, str],
    fields: tuple[str, ...],
) -> dict[str, Any]:
    result = dict(record)
    for field in fields:
        path = mapping.get(prefix + "." + field)
        if path:
            result[field] = _mapped_value(record, path)
    return result
~~~

The canonical warning fields are source_alert_id, message_type, status, sent_at,
effective_at, expires_at, category, area_name, area_geojson, latitude, longitude,
headline, description, and source_url. Observation fields are station_id, station_name,
latitude, longitude, value, unit, category, observed_at, and source_url. Return
a three-tuple of valid warnings, valid observations, and per-record error
strings.

Construct accepted records with these fixed source fields; parse ISO timestamps
with datetime.fromisoformat and rely on the Pydantic validators from Tasks 1
and 6 for timezone, coordinate, and URL checks:

~~~python
warning = OfficialAlertInput(
    source="bmkg_air_quality",
    source_alert_id=record["source_alert_id"],
    message_type=record.get("message_type", "alert"),
    status=record.get("status", "active"),
    sent_at=datetime.fromisoformat(record["sent_at"]),
    effective_at=datetime.fromisoformat(record["effective_at"]),
    expires_at=datetime.fromisoformat(record["expires_at"]),
    headline=record.get("headline"),
    description=record.get("description"),
    area_geojson=record.get("area_geojson"),
    peril_type="air_quality",
    severity=AIR_QUALITY_SEVERITY[record["category"]],
    category=record["category"],
    area_name=record.get("area_name"),
    latitude=record.get("latitude"),
    longitude=record.get("longitude"),
    source_url=record["source_url"],
    raw_payload=record,
)

observation = AirQualityObservationInput(
    source="bmkg",
    station_id=record["station_id"],
    station_name=record["station_name"],
    latitude=record.get("latitude"),
    longitude=record.get("longitude"),
    pollutant="pm25",
    value=record["value"],
    unit=record["unit"],
    category=record["category"],
    observed_at=datetime.fromisoformat(record["observed_at"]),
    source_url=record["source_url"],
    raw_payload=record,
)
~~~

- [ ] **Step 4: Implement safe fetching**

Use the SSRF-pinned pattern from ApprovedJSONFeedConnector with:

~~~python
ALLOWED_HOSTS = ("bmkg.go.id",)
USER_AGENT = "SadarBencana/0.5 bmkg-air-quality"
TIMEOUT_SECONDS = 30
~~~

Disable redirects. Reject credentials in URLs, non-443 ports, private resolved IPs, and non-BMKG hosts.

- [ ] **Step 5: Extend source settings**

Add expected_interval_seconds to ResolvedSourceSetting, its SELECT, the Go
OfficialSourceSetting response/update structs, and the versioned configuration
JSON. Register bmkg_air_quality with host bmkg.go.id in Python and Go. Add this
Go adapter contract:

~~~go
"bmkg_air_quality": {"v1": {"__warnings", "__observations"}},
~~~

The preview branch must report warning_count, observation_count, valid_count, invalid_count, and payload_stored=false.

Add expected_interval_seconds to the web OfficialSourceSetting type and render
an input with min 60 and max 86400 beside poll_interval_seconds. Include the
value in updateOfficialSourceSetting requests.

- [ ] **Step 6: Implement _bmkg_air_quality_cycle**

The disabled gate is:

~~~python
setting = await resolve_source_setting(pool, "bmkg_air_quality")
if setting is None or not setting.enabled or not setting.api_url:
    return {"warnings": 0, "observations": 0}
~~~

For active mode, use this loop shape:

~~~python
for warning in warnings:
    await create_source_record(
        pool,
        SourceRecordInput(
            source_name="bmkg_air_quality",
            source_record_id=warning.source_alert_id,
            source_type="official",
            source_url=warning.source_url,
            attribution=BMKG_ATTRIBUTION,
            observed_at=warning.effective_at,
            published_at=warning.sent_at,
            raw_payload=warning.raw_payload,
        ),
    )
    row, created = await upsert_official_alert(pool, warning)
    if created and _env_enabled("EWS_LIFECYCLE_DELIVERY_ENABLED"):
        await enqueue_official_alert_revision(pool, row)

for observation in observations:
    await upsert_air_quality_observation(pool, observation)

await delete_old_air_quality_observations(pool)
~~~

For dry_run, stop after parsing and health update. Always update
connector_health with name bmkg_air_quality and join at most three record
errors.

Call the cycle after _bmkg_cap_cycle and add its warning count to official_alerts.

- [ ] **Step 7: Run worker and API source tests**

Run:

~~~bash
cd apps/worker
python -m pytest tests/connectors/test_bmkg_air_quality.py tests/db/test_source_settings.py -q
cd ../api
go test ./internal/http -run 'TestApprovedOfficialSourceHosts|TestAirQualityPreview|TestAdapter' -count=1
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add apps/worker/connectors/bmkg_air_quality.py apps/worker/tests/connectors/test_bmkg_air_quality.py apps/worker/connectors/official_feeds.py apps/worker/db/source_settings.py apps/worker/tests/db/test_source_settings.py apps/worker/main.py apps/api/internal/http/official_source_settings.go apps/api/internal/http/official_source_onboarding.go apps/api/internal/http/official_source_settings_test.go apps/api/internal/http/official_source_onboarding_test.go apps/web/src/lib/api/client.ts apps/web/src/features/settings/OfficialSourcesSettingsPage.tsx
git commit -m "feat(worker): add gated BMKG air quality adapter"
~~~

---

### Task 8: Expose Latest Air Quality Observations

**Files:**
- Create: apps/api/internal/http/air_quality.go
- Create: apps/api/internal/http/air_quality_test.go
- Modify: apps/api/cmd/server/main.go

**Interfaces:**
- Produces: GET /api/v1/air-quality/observations?source=bmkg&latest=true&limit=50 with meta.source_active from official_source_settings.

- [ ] **Step 1: Write failing handler tests**

~~~go
func TestAirQualityLimit(t *testing.T) {
    for _, tc := range []struct {
        raw string
        valid bool
    }{{"1", true}, {"50", true}, {"0", false}, {"51", false}, {"abc", false}} {
        _, valid := airQualityLimit(tc.raw)
        if valid != tc.valid {
            t.Fatalf("airQualityLimit(%q) valid=%v, want %v", tc.raw, valid, tc.valid)
        }
    }
}

func TestAirQualityObservationsOmitsRawPayload(t *testing.T) {
    gin.SetMode(gin.TestMode)
    db, mock, err := sqlmock.New()
    if err != nil { t.Fatal(err) }
    defer db.Close()
    now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
    columns := []string{
        "id", "source", "station_id", "station_name", "latitude", "longitude",
        "pollutant", "value", "unit", "category", "observed_at", "source_url",
        "stale", "ingested_at",
    }
    mock.ExpectQuery("SELECT enabled AND run_mode = 'active'").
        WillReturnRows(sqlmock.NewRows([]string{"source_active"}).AddRow(true))
    mock.ExpectQuery("WITH latest AS").
        WithArgs("bmkg", 50).
        WillReturnRows(sqlmock.NewRows(columns).
            AddRow("obs-1", "bmkg", "kmy3", "Kemayoran", -6.155, 106.84,
                "pm25", 66.2, "ug/m3", "Tidak Sehat", now,
                "https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3",
                false, now.Add(time.Minute)))
    recorder := httptest.NewRecorder()
    context, _ := gin.CreateTestContext(recorder)
    context.Request = httptest.NewRequest(http.MethodGet,
        "/api/v1/air-quality/observations?source=bmkg&latest=true&limit=50", nil)
    AirQualityObservations(db)(context)
    if recorder.Code != http.StatusOK { t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body) }
    var body struct {
        Data []map[string]any `json:"data"`
        Meta struct { SourceActive bool `json:"source_active"` } `json:"meta"`
    }
    if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil { t.Fatal(err) }
    if len(body.Data) != 1 || body.Data[0]["category"] != "Tidak Sehat" {
        t.Fatalf("unexpected data: %#v", body.Data)
    }
    if _, exists := body.Data[0]["raw_payload"]; exists { t.Fatal("raw_payload leaked") }
    if !body.Meta.SourceActive { t.Fatal("source_active should be true") }
    if err := mock.ExpectationsWereMet(); err != nil { t.Fatal(err) }
}

func TestAirQualityObservationsRejectsInvalidQueries(t *testing.T) {
    gin.SetMode(gin.TestMode)
    for _, rawURL := range []string{
        "/api/v1/air-quality/observations?source=other",
        "/api/v1/air-quality/observations?latest=maybe",
        "/api/v1/air-quality/observations?limit=0",
        "/api/v1/air-quality/observations?limit=51",
        "/api/v1/air-quality/observations?limit=abc",
    } {
        db, mock, err := sqlmock.New()
        if err != nil { t.Fatal(err) }
        recorder := httptest.NewRecorder()
        context, _ := gin.CreateTestContext(recorder)
        context.Request = httptest.NewRequest(http.MethodGet, rawURL, nil)
        AirQualityObservations(db)(context)
        if recorder.Code != http.StatusBadRequest {
            t.Fatalf("%s status=%d body=%s", rawURL, recorder.Code, recorder.Body)
        }
        if err := mock.ExpectationsWereMet(); err != nil { t.Fatal(err) }
        db.Close()
    }
}
~~~

Import encoding/json, net/http, net/http/httptest, testing, time, gin, sqlmock.

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~bash
cd apps/api
go test ./internal/http -run 'TestAirQuality' -count=1
~~~

Expected: FAIL because AirQualityObservations does not exist.

- [ ] **Step 3: Implement latest-per-station query**

~~~sql
WITH latest AS (
  SELECT DISTINCT ON (o.station_id, o.pollutant)
         o.id, o.source, o.station_id, o.station_name, o.latitude, o.longitude,
         o.pollutant, o.value, o.unit, o.category, o.observed_at, o.source_url,
         (o.observed_at < now() - make_interval(secs => 2 * s.expected_interval_seconds)) AS stale,
         o.ingested_at
  FROM air_quality_observations o
  JOIN official_source_settings s ON s.source_name = 'bmkg_air_quality'
  WHERE ($1 = '' OR o.source = $1)
  ORDER BY o.station_id, o.pollutant, o.observed_at DESC
)
SELECT id, source, station_id, station_name, latitude, longitude, pollutant,
       value, unit, category, observed_at, source_url, stale, ingested_at
FROM latest
ORDER BY CASE category
           WHEN 'Berbahaya' THEN 5 WHEN 'Sangat Tidak Sehat' THEN 4
           WHEN 'Tidak Sehat' THEN 3 WHEN 'Sedang' THEN 2 ELSE 1
         END DESC,
         observed_at DESC
LIMIT $2
~~~

For latest=false, use this query:

~~~sql
SELECT o.id, o.source, o.station_id, o.station_name, o.latitude, o.longitude,
       o.pollutant, o.value, o.unit, o.category, o.observed_at, o.source_url,
       (o.observed_at < now() - make_interval(secs => 2 * s.expected_interval_seconds)) AS stale,
       o.ingested_at
FROM air_quality_observations o
JOIN official_source_settings s ON s.source_name = 'bmkg_air_quality'
WHERE ($1 = '' OR o.source = $1)
ORDER BY o.observed_at DESC
LIMIT $2
~~~

Accept only source empty or bmkg, latest true/false, and limit 1..50. The
airQualityLimit helper defaults an empty value to 50.

Before the observation query, read activation with:

~~~sql
SELECT enabled AND run_mode = 'active' AS source_active
FROM official_source_settings
WHERE source_name = 'bmkg_air_quality'
~~~

Return false if that row is absent. The response meta contains count, limit,
latest, and source_active; raw_payload is never selected or serialized.

~~~go
sourceActive := false
err := db.QueryRowContext(c.Request.Context(), `
    SELECT enabled AND run_mode = 'active' AS source_active
    FROM official_source_settings
    WHERE source_name = 'bmkg_air_quality'
`).Scan(&sourceActive)
if err != nil && err != sql.ErrNoRows {
    c.JSON(http.StatusServiceUnavailable, gin.H{
        "error": "source_status_query_failed", "message": err.Error(),
    })
    return
}
~~~

- [ ] **Step 4: Register route and run tests**

~~~go
router.GET("/api/v1/air-quality/observations", apihttp.AirQualityObservations(dbPool))
~~~

Run:

~~~bash
cd apps/api
go test ./internal/http -run 'TestAirQuality' -count=1
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/internal/http/air_quality.go apps/api/internal/http/air_quality_test.go apps/api/cmd/server/main.go
git commit -m "feat(api): expose BMKG PM2.5 observations"
~~~

---

### Task 9: Build the Dashboard BMKG Warning Panel

**Files:**
- Modify: apps/web/package.json
- Modify: package-lock.json
- Modify: apps/web/src/lib/api/client.ts
- Create: apps/web/src/features/executive/bmkgPresentation.ts
- Create: apps/web/src/features/executive/bmkgPresentation.test.ts
- Create: apps/web/src/features/executive/BmkgWarningsPanel.tsx
- Modify: apps/web/src/features/executive/ExecutiveOverview.tsx
- Modify: apps/web/src/components/RiskMap.tsx

**Interfaces:**
- Consumes: getOfficialAlerts, getAirQualityObservations, MapOverlay[].
- Produces: BmkgWarningsPanel props weatherAlerts, airQualityAlerts, observations, sourceActive, loading, errors, onFocusAlert.

- [ ] **Step 1: Add Vitest and failing presentation tests**

Update scripts with test: vitest run, then:

~~~bash
npm install --save-dev vitest --workspace apps/web
~~~

~~~typescript
import { describe, expect, it } from 'vitest'
import type { OfficialAlert } from '../../lib/api/client'
import { categoryRank, formatIndonesiaTime, sortOfficialAlerts } from './bmkgPresentation'

describe('BMKG presentation', () => {
  it('sorts severity before effective time', () => {
    const sorted = sortOfficialAlerts([
      { id: 'moderate', severity: 'Moderate', sent_at: '2026-07-15T10:00:00Z' },
      { id: 'critical', severity: 'Critical', sent_at: '2026-07-15T09:00:00Z' },
    ] as OfficialAlert[])
    expect(sorted.map((item) => item.id)).toEqual(['critical', 'moderate'])
  })

  it('orders air quality categories from low to dangerous', () => {
    expect(categoryRank('Berbahaya')).toBeGreaterThan(categoryRank('Sedang'))
  })

  it.each([
    ['Asia/Jakarta', 'WIB'],
    ['Asia/Makassar', 'WITA'],
    ['Asia/Jayapura', 'WIT'],
  ])('formats %s with %s', (timeZone, suffix) => {
    expect(formatIndonesiaTime('2026-07-15T04:00:00Z', timeZone)).toContain(suffix)
  })
})
~~~

- [ ] **Step 2: Run web tests and verify failure**

Run:

~~~bash
npm run test --workspace apps/web
~~~

Expected: FAIL because bmkgPresentation.ts is absent.

- [ ] **Step 3: Add API types and clients**

Define:

~~~typescript
export type OfficialAlert = {
  id: string
  source: string
  source_alert_id: string
  revision: number
  message_type: 'alert' | 'update' | 'cancel'
  status: 'active' | 'updated' | 'expired' | 'cancelled'
  sent_at: string
  sent_at: string
  effective_at: string | null
  expires_at: string | null
  peril_type: 'weather' | 'air_quality' | null
  severity: AlertSeverity | null
  category: string | null
  headline: string | null
  description: string | null
  area_name: string | null
  area_geojson: MapOverlay['geometry']
  latitude: number | null
  longitude: number | null
  source_url: string | null
}

export type AirQualityObservation = {
  id: string
  source: 'bmkg'
  station_id: string
  station_name: string
  latitude: number | null
  longitude: number | null
  pollutant: 'pm25'
  value: number
  unit: 'ug/m3'
  category: 'Baik' | 'Sedang' | 'Tidak Sehat' | 'Sangat Tidak Sehat' | 'Berbahaya'
  observed_at: string
  source_url: string | null
  stale: boolean
  ingested_at: string
}

export type AirQualityObservationsResponse = {
  data: AirQualityObservation[]
  meta: { count: number; limit: number; latest: boolean; source_active: boolean }
}
~~~

Add:

~~~typescript
export async function getOfficialAlerts(
  source: 'bmkg_cap' | 'bmkg_air_quality',
): Promise<OfficialAlert[]> {
  const response = await request<{ data: OfficialAlert[] }>(
    '/official-alerts?source=' + encodeURIComponent(source) + '&status=active&limit=20',
  )
  return response.data
}

export async function getAirQualityObservations(): Promise<AirQualityObservationsResponse> {
  return request<AirQualityObservationsResponse>(
    '/air-quality/observations?source=bmkg&latest=true&limit=50',
  )
}
~~~

- [ ] **Step 4: Implement pure presentation helpers**

~~~typescript
const severityRank = { Critical: 3, High: 2, Moderate: 1 } as const
const airRank: Record<string, number> = {
  Baik: 1, Sedang: 2, 'Tidak Sehat': 3,
  'Sangat Tidak Sehat': 4, Berbahaya: 5,
}

export function categoryRank(category: string): number {
  return airRank[category] ?? 0
}

const indonesiaZoneLabels: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
}

export function formatIndonesiaTime(
  value: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const supportedZone = indonesiaZoneLabels[timeZone] ? timeZone : 'Asia/Jakarta'
  const formatted = new Intl.DateTimeFormat('id-ID', {
    timeZone: supportedZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
  return formatted + ' ' + indonesiaZoneLabels[supportedZone]
}

export function sortOfficialAlerts(items: OfficialAlert[]): OfficialAlert[] {
  return [...items].sort((left, right) =>
    (severityRank[right.severity ?? 'Moderate'] - severityRank[left.severity ?? 'Moderate'])
    || new Date(right.effective_at ?? right.sent_at).getTime()
       - new Date(left.effective_at ?? left.sent_at).getTime()
  )
}
~~~

- [ ] **Step 5: Build BmkgWarningsPanel**

The exported props are:

~~~typescript
type BmkgWarningsPanelProps = {
  weatherAlerts: OfficialAlert[]
  airQualityAlerts: OfficialAlert[]
  observations: AirQualityObservation[]
  sourceActive: boolean
  loading: boolean
  errors: Record<string, string>
  onFocusAlert: (id: string) => void
  onRetry: () => void
}
~~~

Use a two-option segmented control Cuaca Ekstrem and Kualitas Udara. Weather
rows show headline, area_name or Wilayah belum terpetakan, severity,
effective/expires, and Sumber BMKG. Air quality shows official alerts first,
then PM2.5 station rows sorted by category and observed_at. A stale observation
displays Data terlambat. If sourceActive is false, show Integrasi kualitas udara
BMKG belum aktif and the official BMKG PM2.5 link.

Use formatIndonesiaTime for every source timestamp. Category and severity
colors always have visible text and an aria-label. While loading, render stable
height skeleton rows. Empty lists show Tidak ada peringatan aktif. A tab-level
error leaves successful rows visible and adds a Coba lagi button wired to
onRetry; it does not replace the map or the other tab.

Do not put cards inside cards; use one section with divided rows. Every external link uses target="_blank" and rel="noopener noreferrer".

- [ ] **Step 6: Wire dashboard loading and partial errors**

~~~typescript
const [weatherWarnings, setWeatherWarnings] = useState<OfficialAlert[]>([])
const [airWarnings, setAirWarnings] = useState<OfficialAlert[]>([])
const [airObservations, setAirObservations] = useState<AirQualityObservation[]>([])
const [airQualitySourceActive, setAirQualitySourceActive] = useState(false)
const [bmkgErrors, setBmkgErrors] = useState<Record<string, string>>({})
const [bmkgLoading, setBmkgLoading] = useState(true)
const [selectedOfficialAlertId, setSelectedOfficialAlertId] = useState<string | null>(null)

const loadBmkg = useCallback(async () => {
  setBmkgLoading(true)
  setBmkgErrors({})
  try {
    const results = await Promise.allSettled([
      getOfficialAlerts('bmkg_cap'),
      getOfficialAlerts('bmkg_air_quality'),
      getAirQualityObservations(),
    ])
    if (results[0].status === 'fulfilled') setWeatherWarnings(results[0].value)
    if (results[1].status === 'fulfilled') setAirWarnings(results[1].value)
    if (results[2].status === 'fulfilled') {
      setAirObservations(results[2].value.data)
      setAirQualitySourceActive(results[2].value.meta.source_active)
    }
    setBmkgErrors(Object.fromEntries(
      results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [[['weather', 'air_quality', 'observations'][index], String(result.reason)]]
          : [],
      ),
    ))
  } finally {
    setBmkgLoading(false)
  }
}, [])

useEffect(() => { void loadBmkg() }, [loadBmkg])
~~~

Pass airQualitySourceActive as sourceActive and loadBmkg as onRetry. Place the
panel directly below the map section and above KPI cards.

- [ ] **Step 7: Add map overlay focus**

Add selectedOverlayId to RiskMapProps and implement:

~~~tsx
function OverlayFocusController({ overlay }: { overlay?: MapOverlay }) {
  const map = useMap()
  useEffect(() => {
    if (!overlay) return
    const polygons = overlayPolygons(overlay)
    if (polygons.length > 0) {
      map.fitBounds(polygons.flat(), { padding: [32, 32], maxZoom: 9 })
      return
    }
    if (overlay.latitude != null && overlay.longitude != null) {
      map.flyTo([overlay.latitude, overlay.longitude], 9)
    }
  }, [map, overlay])
  return null
}
~~~

Move overlayPolygons to module scope. Render point-only official overlays:

~~~tsx
{visibleOverlays
  .filter((item) => item.latitude != null && item.longitude != null && !item.geometry)
  .map((item) => (
    <CircleMarker
      key={item.id}
      center={[item.latitude!, item.longitude!]}
      radius={8}
      pathOptions={{ color: '#e879f9', fillColor: '#e879f9', fillOpacity: 0.35 }}
    >
      <Popup>{item.label}</Popup>
    </CircleMarker>
  ))}
~~~

- [ ] **Step 8: Run tests and build**

Run:

~~~bash
npm run test --workspace apps/web
npm run build --workspace apps/web
~~~

Expected: tests PASS and Vite production build succeeds.

- [ ] **Step 9: Commit**

~~~bash
git add apps/web/package.json package-lock.json apps/web/src/lib/api/client.ts apps/web/src/features/executive/bmkgPresentation.ts apps/web/src/features/executive/bmkgPresentation.test.ts apps/web/src/features/executive/BmkgWarningsPanel.tsx apps/web/src/features/executive/ExecutiveOverview.tsx apps/web/src/components/RiskMap.tsx
git commit -m "feat(web): show BMKG warnings on dashboard"
~~~

---

### Task 10: Add Active BMKG Warnings to EWS

**Files:**
- Modify: apps/web/src/lib/api/ews.ts
- Create: apps/web/src/features/ews/ActiveWarningsTab.tsx
- Modify: apps/web/src/features/ews/EwsPage.tsx
- Modify: apps/web/src/App.tsx
- Modify: apps/web/src/features/health/SourceHealthPage.tsx

**Interfaces:**
- Consumes: GET /ews/me/active-warnings and enriched notification history.
- Produces: Peringatan Aktif tab and onViewOnMap(officialAlertId).

- [ ] **Step 1: Add EWS API types**

~~~typescript
export interface EWSActiveWarning {
  id: string
  source: string
  message_type: 'alert' | 'update' | 'cancel'
  status: 'active' | 'updated' | 'expired' | 'cancelled'
  peril_type: 'weather' | 'air_quality'
  severity: EWSSeverity
  category?: string | null
  headline?: string | null
  description?: string | null
  area_name?: string | null
  effective_at?: string | null
  expires_at?: string | null
  source_url?: string | null
  area_geojson?: unknown
  latitude?: number | null
  longitude?: number | null
  matched_watch_zone_ids: string[]
  matched_watch_zone_labels: string[]
  guidance?: { before: string[]; during: string[]; after: string[] } | null
  guidance_source?: string | null
}

export async function fetchMyActiveWarnings(): Promise<EWSActiveWarning[]> {
  const res = await request<ListResponse<EWSActiveWarning>>('/ews/me/active-warnings')
  return res.data
}
~~~

Extend EWSNotificationLogEntry with nullable headline, peril_type,
lifecycle_action, and matched_watch_zone_label.

- [ ] **Step 2: Build ActiveWarningsTab**

The component signature and load path are:

~~~tsx
import { useCallback, useEffect, useState } from 'react'
import { formatIndonesiaTime } from '../executive/bmkgPresentation'


export default function ActiveWarningsTab({
  onViewOnMap,
}: {
  onViewOnMap: (officialAlertId: string) => void
}) {
  const [warnings, setWarnings] = useState<EWSActiveWarning[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadWarnings = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchMyActiveWarnings()
      .then(setWarnings)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Gagal memuat peringatan.'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    loadWarnings()
  }, [loadWarnings])
  if (loading) {
    return (
      <div className="flex min-h-32 items-center justify-center" role="status" aria-label="Memuat peringatan">
        <span className="size-5 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-rose-300">{error}</p>
        <button type="button" onClick={loadWarnings}
          className="mt-3 text-xs font-semibold text-sky-300">
          Coba lagi
        </button>
      </div>
    )
  }
  if (warnings.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Tidak ada peringatan aktif untuk watch zone Anda.</p>
  }
  return (
    <div className="divide-y divide-slate-800 border-y border-slate-800">
      {warnings.map((warning) => (
        <article key={warning.id} className="py-4">
          <p className="text-xs font-semibold text-sky-300">Resmi BMKG</p>
          <h3 className="mt-1 text-sm font-semibold text-slate-100">
            {warning.headline ?? 'Peringatan resmi BMKG'}
          </h3>
          {warning.description && (
            <p className="mt-1 text-sm text-slate-300">{warning.description}</p>
          )}
          <p className="mt-1 text-xs text-slate-400">
            {(warning.peril_type === 'weather' ? 'Cuaca' : 'Kualitas Udara')
              + ' · ' + warning.severity + ' · ' + warning.status}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {(warning.area_name ?? 'Wilayah belum terpetakan')
              + ' · Watch zone: ' + warning.matched_watch_zone_labels.join(', ')}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {'Diterbitkan: ' + formatIndonesiaTime(warning.sent_at)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {'Berlaku: ' + (warning.effective_at
              ? formatIndonesiaTime(warning.effective_at)
              : 'sekarang')
              + ' sampai ' + (warning.expires_at
                ? formatIndonesiaTime(warning.expires_at)
                : 'ada pembaruan')}
          </p>
          <div className="mt-3 flex gap-3">
            {(warning.area_geojson
              || (warning.latitude != null && warning.longitude != null)) && (
              <button type="button" onClick={() => onViewOnMap(warning.id)}
                className="text-xs font-semibold text-indigo-300">
                Lihat di peta
              </button>
            )}
            {warning.source_url && (
              <a href={warning.source_url} target="_blank" rel="noopener noreferrer"
                className="text-xs font-semibold text-sky-300">
                Sumber BMKG
              </a>
            )}
          </div>
          {warning.guidance && (
            <details className="mt-3 text-xs text-slate-300">
              <summary className="cursor-pointer font-semibold">Panduan keselamatan</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {warning.guidance.during.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </details>
          )}
        </article>
      ))}
    </div>
  )
}
~~~

- [ ] **Step 3: Make the tab first and extend peril controls**

~~~typescript
type Tab = 'warnings' | 'zones' | 'prefs' | 'notifs'
const TABS = [
  { key: 'warnings', label: 'Peringatan Aktif' },
  { key: 'zones', label: 'Watch Zones' },
  { key: 'prefs', label: 'Preferences' },
  { key: 'notifs', label: 'Notifikasi Saya' },
] as const
const PERILS = ['earthquake', 'flood', 'volcano', 'wildfire', 'windstorm',
                'weather', 'air_quality']
~~~

Initialize tab with warnings. Add active warning rendering and show the new notification metadata in NotifsTab.

- [ ] **Step 4: Wire EWS-to-dashboard map navigation**

In App:

~~~typescript
const [focusedOfficialAlertId, setFocusedOfficialAlertId] = useState<string | null>(null)

const showOfficialAlertOnMap = (id: string) => {
  setFocusedOfficialAlertId(id)
  navigate('Executive Overview')
}
~~~

Pass focusedOfficialAlertId to ExecutiveOverview and onViewOnMap to EwsPage. ExecutiveOverview initializes selectedOfficialAlertId from the prop and clears it after the user selects another map item.

- [ ] **Step 5: Add source health entries**

Change the Hazard names to bmkg, bmkg_cap, bmkg_air_quality, usgs, gdacs_fl,
gdacs_vo, and nasa_firms. Build a synthetic inactive row only for missing
official connectors:

~~~typescript
const inactiveOfficial = new Set(['bmkg_cap', 'bmkg_air_quality'])
const connectors = names.map((name) => byName.get(name) ?? (
  inactiveOfficial.has(name)
    ? {
        name, status: 'stale', last_polled_at: null, items_fetched: 0,
        error_message: 'Belum aktif', threshold_seconds: 0, updated_at: null,
      }
    : undefined
)).filter(Boolean) as ConnectorHealth[]
~~~

- [ ] **Step 6: Run web verification**

Run:

~~~bash
npm run test --workspace apps/web
npm run build --workspace apps/web
~~~

Expected: PASS and no TypeScript errors.

- [ ] **Step 7: Commit**

~~~bash
git add apps/web/src/lib/api/ews.ts apps/web/src/features/ews/ActiveWarningsTab.tsx apps/web/src/features/ews/EwsPage.tsx apps/web/src/App.tsx apps/web/src/features/health/SourceHealthPage.tsx apps/web/src/features/executive/ExecutiveOverview.tsx
git commit -m "feat(web): add BMKG warnings to EWS"
~~~

---

### Task 11: Verify End-to-End Behavior and Update Operations Docs

**Files:**
- Modify: docs/bmkg-cap-nowcast.md
- Create: docs/bmkg-air-quality.md

**Interfaces:**
- Produces: Verified feature, activation runbook, rollback procedure, and known source gate.

- [ ] **Step 1: Run the complete automated suite**

~~~bash
cd apps/worker
python -m pytest -q
cd ../api
go test ./...
cd ../..
npm run test --workspace apps/web
npm run build --workspace apps/web
npm run verify
git diff --check
~~~

Expected: every command exits 0.

- [ ] **Step 2: Apply migration to an isolated database**

~~~bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema/040_bmkg_warning_and_air_quality.sql
psql "$TEST_DATABASE_URL" -c '\d official_alerts'
psql "$TEST_DATABASE_URL" -c '\d air_quality_observations'
~~~

Expected: metadata columns, matched_watch_zone_id, and the observations table exist; rerunning migration 040 exits 0.

- [ ] **Step 3: Verify the weather path with fixtures**

Run one worker ingest against a test DB with bmkg_cap in dry_run, then active mode. Query source, peril_type, severity, area_name, status, and is_current for the latest five bmkg_cap rows. An outside watch zone must produce no pending delivery; an intersecting zone with matching preference must produce one.

- [ ] **Step 4: Verify the air-quality gate**

Query enabled, run_mode, and default_api_url for bmkg_air_quality. Expected: enabled=false, run_mode=disabled, default_api_url null, and dashboard displays Integrasi kualitas udara BMKG belum aktif.

With an approved canonical fixture endpoint in dry_run, preview reports valid warnings and observations while official_alerts and air_quality_observations counts remain unchanged. Activation is permitted only after the dry-run config version is valid.

- [ ] **Step 5: Perform responsive visual QA**

Start each service in a separate terminal so both processes remain available:

~~~bash
npm run dev:api
~~~

~~~bash
npm run dev:web
~~~

Inspect 1440x900, 1024x768, and 390x844. Verify the BMKG panel is below the map; segmented tabs do not resize it; long headlines wrap; warning selection focuses the correct geometry; Peringatan Aktif is first; all loading/empty/stale/inactive/error states are legible; and attribution is visible.

- [ ] **Step 6: Write operations documentation**

docs/bmkg-air-quality.md contains prerequisites, canonical fields, Custom API -> Preview -> Dry-run -> Activate, health checks, PM2.5 non-delivery rule, rollback, attribution, and terms. Update docs/bmkg-cap-nowcast.md with structured metadata and watch-zone delivery.

- [ ] **Step 7: Commit verification docs**

~~~bash
git add docs/bmkg-cap-nowcast.md docs/bmkg-air-quality.md
git commit -m "docs: add BMKG warning operations runbook"
~~~

- [ ] **Step 8: Final status check**

~~~bash
git status --short
git log --oneline -12
~~~

Expected: clean worktree and one focused commit per task.

---

## Execution Checkpoints

- After Task 3: BMKG CAP weather warnings are queryable and map-ready.
- After Task 5: weather warnings are personalized and delivery-safe for EWS.
- After Task 8: air-quality storage and API are complete, while production activation remains gated.
- After Task 10: dashboard and EWS UI are feature-complete.
- After Task 11: all automated and visual checks pass, and activation/rollback are documented.

## Spec Coverage

| Design requirement | Implementation task |
| --- | --- |
| Dashboard weather warnings, severity, period, attribution, and map focus | Tasks 2, 3, and 9 |
| Dashboard PM2.5 categories, freshness, worst-first ordering, and inactive source state | Tasks 6, 7, 8, and 9 |
| Personalized active-warning tab and notification history | Tasks 4, 5, and 10 |
| Watch-zone geospatial, peril, severity, alert-type, channel, and revision matching | Task 4 |
| Update/cancel/expiry delivery to prior recipients | Task 4 |
| Official warning and observation data kept separate | Tasks 1, 6, and 7 |
| No HTML scraping, HTTPS allowlist, disabled-by-default air-quality gate | Tasks 1 and 7 |
| BMKG attribution, source links, curated guidance, and no raw payload in browser | Tasks 1, 3, 5, 8, 9, and 10 |
| Email and Telegram channels unchanged | Task 4 |
| Automated, migration, responsive, activation, and rollback verification | Task 11 |
