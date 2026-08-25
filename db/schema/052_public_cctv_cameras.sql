-- 052_public_cctv_cameras.sql
-- CCTV jalan tol resmi (BPJT Kementerian PUPR + seluruh BUJT: Jasa Marga,
-- Hutama Karya, Astra Infra, Waskita, dll.) — S12a.
-- Sumber: katalog allStreams publik di https://bpjt.pu.go.id/cctv
-- (disediakan terbuka utk pemantauan lalu lintas masyarakat).

CREATE TABLE IF NOT EXISTS public_cctv_cameras (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    camera_id        VARCHAR(64) NOT NULL UNIQUE,
    toll_road_id     VARCHAR(32),
    toll_road_name   TEXT NOT NULL,
    segment_name     TEXT,
    km_point         TEXT NOT NULL,
    operator_code    VARCHAR(32) NOT NULL,
    operator_name    TEXT NOT NULL,
    latitude         DOUBLE PRECISION NOT NULL,
    longitude        DOUBLE PRECISION NOT NULL,
    stream_url       TEXT NOT NULL,
    stream_protocol  VARCHAR(16) NOT NULL DEFAULT 'm3u8',
    is_online        BOOLEAN NOT NULL DEFAULT true,
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cctv_cameras_geo
    ON public_cctv_cameras (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_cctv_cameras_operator
    ON public_cctv_cameras (operator_code);
CREATE INDEX IF NOT EXISTS idx_cctv_cameras_tollroad
    ON public_cctv_cameras (toll_road_name);
