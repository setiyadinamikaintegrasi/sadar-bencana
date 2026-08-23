-- 046_kanari_fire_clusters.sql
-- Snapshot klaster karhutla agregat multi-satelit (kanari.io) — S8-P2.
-- Full-refresh tiap sync (bukan append-only): snapshot klaster aktif.

CREATE TABLE IF NOT EXISTS kanari_fire_clusters (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_id       TEXT NOT NULL UNIQUE,
    longitude        DOUBLE PRECISION NOT NULL,
    latitude         DOUBLE PRECISION NOT NULL,
    detection_count  INTEGER NOT NULL DEFAULT 0 CHECK (detection_count >= 0),
    viirs_count      INTEGER NOT NULL DEFAULT 0 CHECK (viirs_count >= 0),
    goes_count       INTEGER NOT NULL DEFAULT 0 CHECK (goes_count >= 0),
    mtg_count        INTEGER NOT NULL DEFAULT 0 CHECK (mtg_count >= 0),
    max_frp_mw       REAL CHECK (max_frp_mw IS NULL OR max_frp_mw >= 0),
    confidence       TEXT NOT NULL DEFAULT 'possible'
                     CHECK (confidence IN ('possible', 'probable', 'corrobore')),
    first_seen_at    TIMESTAMPTZ,
    last_seen_at     TIMESTAMPTZ,
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kanari_fire_clusters_geo
    ON kanari_fire_clusters (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_kanari_fire_clusters_confidence
    ON kanari_fire_clusters (confidence, detection_count DESC);
