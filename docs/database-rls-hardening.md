# Database RLS hardening

SadarBencana uses Supabase Auth in the browser, but application data is read and
mutated through the Go API. Direct PostgREST access would bypass API validation,
personal-asset limits, organization entitlements, and application audit trails.

Migration `035_direct_database_access_hardening.sql` therefore keeps every
`public` table deny-by-default:

- RLS remains enabled.
- No permissive `anon` or `authenticated` policy is added.
- Existing direct table and sequence privileges are revoked from `PUBLIC`,
  `anon`, and `authenticated`.
- Future objects created by the application migration role start private.
- Backend connections using the PostgreSQL `postgres` role continue to work.

Do not add broad public-read policies for `events`, `alerts`, `briefings`,
`risk_scores`, or `news_items`. Public disaster information is already exposed
through bounded API handlers where caching, filtering, and rate limits can be
managed.

Do not add direct CRUD policies for `personal_assets`, organization tables, or
invitations without first moving all business constraints into database
functions. Direct CRUD would bypass hosted limits and token workflows.

## Production procedure

1. Take a Supabase schema backup.
2. Review the migration and current grants/policies.
3. Apply the migration using a transaction-capable PostgreSQL client.
4. Verify that:
   - all public tables have RLS enabled;
   - `anon` and `authenticated` have no direct public-table grants;
   - the backend API remains healthy;
   - Supabase signup/login still works;
   - direct PostgREST table access is denied.

The migration changes authorization metadata only. It does not modify or delete
application rows.
