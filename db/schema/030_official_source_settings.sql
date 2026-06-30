BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS official_source_settings (
    source_name VARCHAR(64) PRIMARY KEY,
    display_name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mode VARCHAR(24) NOT NULL DEFAULT 'auto'
        CHECK (mode IN ('auto','default_public','custom_api')),
    default_api_url TEXT,
    custom_api_url TEXT,
    api_token_encrypted BYTEA,
    attribution TEXT NOT NULL,
    terms_url TEXT,
    poll_interval_seconds INT NOT NULL DEFAULT 600
        CHECK (poll_interval_seconds BETWEEN 60 AND 86400),
    notes TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO official_source_settings
    (source_name, display_name, enabled, mode, default_api_url, attribution, terms_url, notes)
VALUES
('bmkg', 'BMKG Open Data Gempa', TRUE, 'auto',
 'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json', 'Sumber: BMKG',
 'https://data.bmkg.go.id/tentang/',
 'Open Data gempa aktif sebagai sumber default aplikasi.'),
('bmkg_cap', 'BMKG CAP Nowcast', FALSE, 'auto',
 'https://www.bmkg.go.id/alerts/nowcast/id', 'Sumber: BMKG',
 'https://www.bmkg.go.id/ketentuan-penggunaan',
 'Aktifkan setelah ketentuan integrasi BMKG dikonfirmasi.'),
('inatews', 'InaTEWS Bulletin', FALSE, 'auto', NULL, 'Sumber: BMKG InaTEWS',
 'https://www.bmkg.go.id/ketentuan-penggunaan',
 'Memerlukan feed machine-readable resmi; UI publik tidak di-scrape.'),
('pvmbg', 'PVMBG / MAGMA', FALSE, 'auto', NULL, 'Sumber: PVMBG',
 'https://magma.esdm.go.id/', 'Masukkan feed resmi yang disetujui PVMBG.'),
('bnpb', 'BNPB Situation Reports', FALSE, 'auto', NULL, 'Sumber: BNPB',
 'https://data.bnpb.go.id/', 'Masukkan resource API/dataset BNPB yang sesuai kontrak record.'),
('inarisk', 'InaRISK Spatial Layers', FALSE, 'auto', NULL, 'Sumber: InaRISK BNPB',
 'https://inarisk.bnpb.go.id/', 'Masukkan layer API resmi beserta data vintage.')
ON CONFLICT (source_name) DO NOTHING;

COMMIT;
