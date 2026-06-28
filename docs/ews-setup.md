# EWS Setup Guide — Early Warning System

The EWS adds a multi-channel notification layer (Telegram, WhatsApp, Email) on
top of the existing alert engine. When the worker creates an alert, the
`dispatcher` matches it against registered subscribers' geofenced watch zones
and delivers notifications through each subscriber's enabled channels.

This guide covers configuration, registering the first subscriber, and testing
delivery.

---

## 1. Database migrations

Apply the EWS schema migrations (see [the dev DB workflow](#applying-migrations)):

```bash
psql "$DATABASE_URL" -f db/schema/011_ews_subscribers.sql
psql "$DATABASE_URL" -f db/schema/012_ews_watch_zones.sql
psql "$DATABASE_URL" -f db/schema/013_seed_ews_demo.sql   # optional demo data
```

This creates four tables:

| Table | Purpose |
|-------|---------|
| `ews_subscribers` | Notification recipients (name, contacts, role) |
| `ews_watch_zones` | Geofenced areas (lat/lon/radius, peril filter, min magnitude) |
| `ews_notification_prefs` | Per-subscriber, per-channel preferences |
| `ews_notification_log` | Delivery audit trail |

---

## 2. Channel configuration (environment variables)

Add these to your `.env` (templated in `.env.example`):

### Telegram

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-your-bot-token
```

Each subscriber's `telegram_chat_id` is their personal/group chat id. Create a
bot via [@BotFather](https://t.me/BotFather) and obtain a chat id by messaging
the bot and reading `getUpdates`.

### WhatsApp (Fonnte)

```bash
FONNTE_API_TOKEN=your-fonnte-device-token
```

Register a device at [fonnte.com](https://fonnte.com/), connect a WhatsApp
number, and copy the device token. Subscriber numbers use the `62…` format
(e.g. `628123456789`).

### Email (SMTP)

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ews@tugure.co.id
SMTP_PASSWORD=app-specific-password
SMTP_FROM=ews@tugure.co.id
```

The adapter uses STARTTLS on the configured port. For Gmail, use an
[App Password](https://support.google.com/accounts/answer/185833).

> A channel with missing credentials fails gracefully — the delivery is logged
> as `failed` with an explanatory `error_message`; it never raises.

---

## 3. Register the first subscriber

Use the web UI (**Early Warning** menu → *Subscribers* tab → **+ Subscriber**)
or the API directly:

```bash
# Create subscriber
curl -X POST http://localhost:8001/api/v1/ews/subscribers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Joko Setiyadi","email":"joko@tugure.co.id","telegram_chat_id":673177836,"role":"admin"}'

# Add a watch zone (Jakarta, 100km, earthquake+flood, M>=5.0)
curl -X POST http://localhost:8001/api/v1/ews/subscribers/<SUB_ID>/watch-zones \
  -H 'Content-Type: application/json' \
  -d '{"label":"Jakarta HQ","latitude":-6.21,"longitude":106.85,"radius_km":100,"peril_types":["earthquake","flood"],"min_magnitude":5.0}'

# Enable a channel preference
curl -X PUT http://localhost:8001/api/v1/ews/subscribers/<SUB_ID>/preferences \
  -H 'Content-Type: application/json' \
  -d '{"channel":"telegram","min_severity":"High","is_enabled":true}'
```

> **Global watchers:** a subscriber with *no* watch zones receives every alert
> (subject to severity/peril/quiet-hours preferences). Add a watch zone to
> restrict a subscriber to events within a geographic radius.

---

## 4. Test delivery

The worker exposes a test-dispatch endpoint that sends a synthetic notification
to a subscriber via all their enabled channels (bypassing geo-matching):

```bash
curl -X POST http://localhost:8002/api/v1/worker/ews/test-dispatch/<SUB_ID>
```

Response:

```json
{
  "subscriber": "Joko Setiyadi",
  "results": [
    {"channel": "telegram", "status": "sent", "error": null}
  ]
}
```

Then inspect the audit log in the UI (*Delivery Log* tab) or via API:

```bash
curl 'http://localhost:8001/api/v1/ews/notifications?status=sent'
```

---

## 5. How dispatch decides who gets notified

For each new alert, `dispatch_alert` (in `apps/worker/alerts/dispatcher.py`):

1. Loads all active subscribers and active watch zones.
2. **Geo-match** (if the event has coordinates): a subscriber *with* zones is
   included only if one of their zones contains the event
   (haversine distance ≤ radius) and passes the zone's peril + magnitude
   filters. A subscriber *without* zones is always included (global watcher).
3. For each of the subscriber's enabled channel preferences:
   - **Severity filter** — skip if alert severity < `min_severity`.
   - **Alert-type filter** — skip if `alert_types` is set and excludes this type.
   - **Quiet hours** — if the current time is inside the window, log `skipped`.
   - **Dedup** — skip if a `sent`/`pending` log row already exists for
     (subscriber, alert, channel).
   - **Send** via the channel adapter, then log `sent` or `failed`.

---

## Applying migrations

For the local docker-based dev DB, see `memory`/project docs for the exact
host/port. The migrations are plain SQL wrapped in `BEGIN; … COMMIT;` and are
idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
