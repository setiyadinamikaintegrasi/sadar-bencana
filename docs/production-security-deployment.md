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
Permissions-Policy: camera=(), microphone=(), geolocation=()
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
