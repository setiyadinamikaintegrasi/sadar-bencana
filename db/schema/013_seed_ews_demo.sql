BEGIN;

-- Demo subscriber
INSERT INTO ews_subscribers (name, email, phone_whatsapp, telegram_chat_id, role)
VALUES (
    'Joko Setiyadi',
    'joko@tugure.co.id',
    '62812xxxxxxxx',
    673177836,
    'admin'
)
ON CONFLICT (email) DO NOTHING;

-- Demo watch zone: Jakarta, 100km radius
INSERT INTO ews_watch_zones (subscriber_id, label, latitude, longitude, radius_km, peril_types, min_magnitude)
SELECT id, 'Jakarta HQ', -6.21, 106.85, 100, ARRAY['earthquake','flood'], 5.0
FROM ews_subscribers WHERE email = 'joko@tugure.co.id'
ON CONFLICT DO NOTHING;

-- Default notification preferences
INSERT INTO ews_notification_prefs (subscriber_id, channel, min_severity, is_enabled)
SELECT id, 'telegram', 'High', TRUE
FROM ews_subscribers WHERE email = 'joko@tugure.co.id'
ON CONFLICT (subscriber_id, channel) DO NOTHING;

COMMIT;
