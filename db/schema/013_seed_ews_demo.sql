BEGIN;

-- Demo subscriber
INSERT INTO ews_subscribers (name, email, phone_whatsapp, telegram_chat_id, role)
VALUES (
    'Demo Admin',
    'admin@example.com',
    '62812xxxxxxxx',
    123456789,
    'admin'
)
ON CONFLICT (email) DO NOTHING;

-- Demo watch zone: Jakarta, 100km radius
INSERT INTO ews_watch_zones (subscriber_id, label, latitude, longitude, radius_km, peril_types, min_magnitude)
SELECT id, 'Jakarta Demo Zone', -6.21, 106.85, 100, ARRAY['earthquake','flood'], 5.0
FROM ews_subscribers WHERE email = 'admin@example.com'
ON CONFLICT DO NOTHING;

-- Default notification preferences
INSERT INTO ews_notification_prefs (subscriber_id, channel, min_severity, is_enabled)
SELECT id, 'telegram', 'High', TRUE
FROM ews_subscribers WHERE email = 'admin@example.com'
ON CONFLICT (subscriber_id, channel) DO NOTHING;

COMMIT;
