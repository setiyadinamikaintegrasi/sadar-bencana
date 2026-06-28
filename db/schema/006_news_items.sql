BEGIN;

CREATE TABLE IF NOT EXISTS news_items (
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id      VARCHAR(512) NOT NULL,
    source       VARCHAR(64)  NOT NULL,
    title        TEXT         NOT NULL,
    summary      TEXT,
    url          TEXT,
    published_at TIMESTAMPTZ,
    perils       TEXT[]       NOT NULL DEFAULT '{}',
    lat          FLOAT,
    lon          FLOAT,
    place_name   TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_news_source_item UNIQUE (source, item_id)
);

CREATE INDEX IF NOT EXISTS idx_news_published_at
    ON news_items (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_perils
    ON news_items USING GIN (perils);

CREATE INDEX IF NOT EXISTS idx_news_geo
    ON news_items (lat, lon)
    WHERE lat IS NOT NULL AND lon IS NOT NULL;

COMMIT;
