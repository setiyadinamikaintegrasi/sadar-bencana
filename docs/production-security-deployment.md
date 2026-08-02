# Production security deployment

This runbook covers the security-sensitive deployment changes introduced by
the publication hardening branch. It contains no production credentials.

## 1. Generate independent internal tokens

Generate two different values. Never commit the generated output.

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Store the first value as `WORKER_API_TOKEN` and the second as
`MASTRA_API_TOKEN` in the production environment. The API, Worker, and Mastra
processes must receive the matching values:

- API: `WORKER_API_TOKEN` and `MASTRA_API_TOKEN`
- Worker: `WORKER_API_TOKEN`
- Mastra: `WORKER_API_TOKEN`, `MASTRA_API_TOKEN`, and `API_ENV=hosted`

Production services fail closed when a required token is missing or shorter
than 32 characters. Do not reuse one token for both services.

### Hosted AI provider

Hosted Mastra uses one DeepSeek provider for both Executive Briefing and
Analyst Copilot. Store the API key only in the protected Mastra environment
file:

```dotenv
MASTRA_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=replace-with-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-v4-flash
MASTRA_AI_MAX_OUTPUT_TOKENS=2048
MASTRA_AI_MAX_STEPS=6
```

`deepseek-v4-flash` is the default low-cost model. The integration explicitly
disables thinking mode to avoid unnecessary reasoning-token output. Hosted
startup fails closed if the key is missing, the model uses a legacy identifier,
or the base URL does not point to the official HTTPS DeepSeek endpoint. Output
tokens and agent steps are also capped to limit runaway cost.

## 2. Use internal service addresses

For Docker Compose:

```dotenv
WORKER_BASE_URL=http://worker:8002
MASTRA_BASE_URL=http://host.docker.internal:4111
TRUSTED_PROXIES=127.0.0.1/32,::1/128,172.16.0.0/12
```

Do not use `127.0.0.1:8002` from inside the API container; that address points
back to the API container rather than the Worker container.

`TRUSTED_PROXIES` must contain only the loopback and private Docker networks
that can directly reach the Go API. Production startup rejects an empty list
and wildcard networks such as `0.0.0.0/0` or `::/0`.

The Go API automatically enables Gin release mode when `API_ENV` is
`production`, `hosted`, or `docker`; no separate `GIN_MODE` setting is needed.

## 3. Keep internal ports private

The Compose file binds Web, API, Worker, and Redis to `127.0.0.1`. Mastra must
also listen only on loopback or a private container network. Confirm:

```bash
ss -ltnp | grep -E ':3001|:4111|:6379|:8001|:8002'
```

No listed service should bind to `0.0.0.0` or `*`.

## 4. Remove public Worker and Mastra routes

The browser only needs the main application domain. Do not publicly reverse
proxy Worker or Mastra. Existing Caddy site blocks can be replaced with:

```caddyfile
worker.example.org {
    respond 404
}

mastra.example.org {
    respond 404
}
```

The bearer tokens remain mandatory as defense in depth even after the public
routes are removed.

## 5. Supabase Auth

For a public community application:

- Email signup may remain enabled.
- Confirm email must be enabled.
- Anonymous sign-ins must be disabled.
- Use custom SMTP and verify SPF/DKIM for the sender domain.
- Keep direct database access denied by RLS; application data flows through
  the Go API.

## 6. Edge headers and DNS

At the TLS reverse proxy, set:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
Permissions-Policy: camera=(), microphone=(), geolocation=(self)
```

Only add the HSTS `preload` directive after every subdomain is permanently
HTTPS-capable and the operational consequences have been reviewed.

Configure SPF and DKIM using the records provided by the SMTP provider. Add a
DMARC record in monitoring mode first, review reports, then move to quarantine:

```text
_dmarc.example.org TXT "v=DMARC1; p=none; rua=mailto:dmarc@example.org"
```

Do not cache authenticated API, Worker, or Mastra responses at the CDN/reverse
proxy.

## 7. Apply database hardening separately

Back up the schema, review the migration, and apply it in a transaction:

```bash
pg_dump --schema-only "$DATABASE_URL" > "schema_backup_$(date +%Y%m%d).sql"
psql "$DATABASE_URL" --single-transaction \
  -f db/schema/035_direct_database_access_hardening.sql
```

See [database-rls-hardening.md](database-rls-hardening.md) for verification and
rollback guidance.

## 8. Post-deployment checks

```bash
curl -fsS https://example.org/api/v1/meta
curl -i https://worker.example.org/api/v1/worker/events
curl -i https://mastra.example.org/api/agents
```

The main API must succeed. Public Worker and Mastra requests must return 404.
Then verify authenticated application flows, email confirmation, personal
assets, official-source preview, AI briefing, and logout.

## 9. Enable authenticated AI features

Apply the AI access-control migration before deploying the API build that
contains authenticated AI routes:

```bash
psql "$DATABASE_URL" --single-transaction \
  -f db/schema/036_ai_access_controls.sql
```

The defaults require a Supabase login, cache Executive Briefing for six hours,
and limit Copilot to 5 requests/minute and 10 requests/day per account. These
values can be adjusted without rebuilding:

```dotenv
AI_EXECUTIVE_CACHE_TTL=6h
AI_EXECUTIVE_PER_MINUTE=2
AI_EXECUTIVE_PER_DAY=3
AI_EXECUTIVE_GLOBAL_PER_DAY=20
AI_COPILOT_PER_MINUTE=5
AI_COPILOT_PER_DAY=10
AI_COPILOT_GLOBAL_PER_MINUTE=30
AI_COPILOT_GLOBAL_PER_DAY=100
AI_COPILOT_MAX_CHARACTERS=2000
```

After deployment, unauthenticated calls to both AI endpoints must return 401.
Authenticated calls require migration `036`; if its tables are absent the API
fails closed with 503 instead of sending a paid upstream request.

## 10. Enable EWS delivery

Apply the EWS hardening migration before deploying the API and worker build:

```bash
psql "$DATABASE_URL" --single-transaction \
  -f db/schema/037_ews_delivery_hardening.sql
```

Configure Telegram and Resend SMTP in the server `.env`. Keep delivery disabled
until both test sends succeed:

```dotenv
TELEGRAM_BOT_TOKEN=
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=
SMTP_FROM=noreply@sadarbencana.id
EWS_DELIVERY_ENABLED=false
EWS_LIFECYCLE_DELIVERY_ENABLED=false
```

Rebuild `api`, `worker`, and `web`, then use **Admin EWS** to verify provider
status and send one Telegram and one email test. Set both EWS flags to `true`
only after successful tests, recreate the worker, and monitor pending, failed,
and dead-letter counts for 24 hours.

## 11. MapLibre operational map rollout

MapLibre remains opt-in. `VITE_OPERATIONAL_MAP_ENGINE=leaflet` is the
production default until the staged rollout below is approved. This repository
does not contain the production Caddy configuration; do not change Caddy as
part of a source checkout update.

### Approved CSP origins

The deployed web application calls its API at `/api/v1`, so `connect-src
'self'` covers `https://sadarbencana.id/api/v1`. The approved Supabase origin
is `https://njqvgshkdhxcfllhmeey.supabase.co`; this is the historical
production release hostname and must match the configured web build value
before a proxy change. Do not use wildcard Supabase or basemap origins.

```text
connect-src 'self' https://njqvgshkdhxcfllhmeey.supabase.co https://tiles.openfreemap.org;
img-src 'self' data: blob: https://tiles.openfreemap.org;
worker-src 'self' blob:;
```

`https://tiles.openfreemap.org` covers the reviewed constant style URL
`https://tiles.openfreemap.org/styles/liberty` and its basemap resources. Keep
the existing approved origins in each directive; the lines above are additions,
not an instruction to remove unrelated application requirements.

MapLibre is bundled into the web asset. Do **not** add a CDN host, `unsafe-eval`,
or any other relaxation to `script-src`. Preserve any stricter existing
`worker-src` policy only if it already permits the bundled MapLibre worker;
otherwise add `blob:` to `worker-src`, not to `script-src`.

Before any Caddy edit, validate the exact configured production build value.
Run this in the protected deployment environment where `VITE_SUPABASE_URL` is
defined for the web build; it fails closed for an unset value, a malformed URL,
or any hostname other than the approved project:

```bash
approved_origin='https://njqvgshkdhxcfllhmeey.supabase.co'
configured_origin="$(node -e 'const value = process.argv[1]; try { process.stdout.write(new URL(value).origin) } catch { process.exit(1) }' "${VITE_SUPABASE_URL:?VITE_SUPABASE_URL is required}")"
test "$configured_origin" = "$approved_origin" || {
  echo "Refusing MapLibre CSP rollout: VITE_SUPABASE_URL is not the approved project origin" >&2
  exit 1
}
```

Then inspect the actual public header and compare it with the approved list
above:

```bash
curl -fsSI https://sadarbencana.id/ | tr -d '\r' | grep -i '^content-security-policy:'
```

Record the current header and web image/commit. Update external Caddy only
after that comparison confirms the needed origins are absent or equivalent.
Re-run the command after the change and verify browser developer tools show no
CSP violations for API, Supabase, style, sprite, glyph, tile, image, or worker
requests.

### Deployment and rollback order

1. Deploy the API map-feed release first while leaving
   `VITE_OPERATIONAL_MAP_ENGINE=leaflet`. Verify the public endpoints with a
   bounded request and keep the existing Leaflet user flow healthy.
2. Apply and verify the reviewed CSP additions at the external proxy. Do not
   enable the flag while a required CSP request is blocked.
3. In a staging or controlled production window, set
   `VITE_OPERATIONAL_MAP_ENGINE=maplibre`, rebuild and recreate **only** the
   web service, then verify anonymous desktop/mobile map loading, visible
   legend/attribution/truncation, and authenticated owner layers. Confirm an
   anonymous browser never requests `/api/v1/me/map/`.
4. Keep the API, worker, database, and Leaflet implementation unchanged during
   the web-only rollout. Monitor for seven consecutive days before considering
   Leaflet retirement in a separate reviewed change.

To roll back, first restore `VITE_OPERATIONAL_MAP_ENGINE=leaflet` and rebuild
only the web service (or restore the recorded web image). Confirm the Leaflet
map works before changing anything else. Leave the API map feeds in place.
Revert a newly added CSP origin only after the Leaflet rollback is verified and
the header comparison confirms no remaining application resource requires it.

### Metrics to monitor

- Public operational-map endpoint request rate, `2xx`/`4xx`/`5xx` ratio, and
  p95 latency by layer.
- Client-side MapLibre initialization failures, WebGL fallback frequency, CSP
  violations, and basemap/style request failures.
- Private map endpoint `401`/`403` responses and any anonymous request to
  `/api/v1/me/map/`.
- Feature truncation frequency, stale/unavailable layer state, and visible
  source attribution after each web deployment.
- Desktop and mobile smoke checks after every deployment, plus API, worker,
  Redis, and Mastra health.
