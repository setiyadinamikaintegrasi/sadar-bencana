BEGIN;

ALTER TABLE ews_watch_zones
    ADD COLUMN IF NOT EXISTS thresholds JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE ews_watch_zones
SET thresholds = jsonb_build_object(
    'earthquake', jsonb_build_object('min_magnitude', min_magnitude),
    'flood', jsonb_build_object(
        'min_depth_cm',
        CASE
            WHEN min_magnitude >= 4 THEN 300
            WHEN min_magnitude >= 3 THEN 150
            WHEN min_magnitude >= 2 THEN 70
            ELSE 0
        END
    ),
    'volcano', jsonb_build_object(
        'min_activity_level', LEAST(4, GREATEST(1, CEIL(min_magnitude)::int))
    ),
    'wildfire', jsonb_build_object('min_frp', min_magnitude * 50)
)
WHERE thresholds = '{}'::jsonb;

ALTER TABLE ews_watch_zones
    ALTER COLUMN min_magnitude DROP NOT NULL;

COMMENT ON COLUMN ews_watch_zones.min_magnitude IS
    'Deprecated compatibility field; use thresholds JSONB for new clients.';

COMMENT ON COLUMN ews_watch_zones.thresholds IS
    'Per-peril thresholds: earthquake.min_magnitude, flood.min_depth_cm, volcano.min_activity_level, wildfire.min_frp.';

COMMIT;
