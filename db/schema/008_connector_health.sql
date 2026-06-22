-- db/schema/008_connector_health.sql
BEGIN;

CREATE TABLE IF NOT EXISTS connector_health (
    name           VARCHAR(64)  PRIMARY KEY,
    last_polled_at TIMESTAMPTZ,
    items_fetched  INT          NOT NULL DEFAULT 0,
    error_message  TEXT,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMIT;
