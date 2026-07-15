# Task 5 Report: Personalized Active Warning API

## RED

Created `apps/api/internal/http/ews_active_warnings_test.go` before production code.

Command:

```bash
cd apps/api
go test ./internal/http -run 'TestEWSMeActiveWarnings|TestEWSMeNotifications.*LifecycleMetadata' -count=1
```

Result: failed as expected because `EWSMeActiveWarnings` and `EWSActiveWarning` were undefined.

## GREEN

Implemented the personalized active-warning handler, enriched self-service notification history, and registered `GET /api/v1/ews/me/active-warnings` inside the authenticated `ewsMe` route group.

Focused verification:

```bash
cd apps/api
go test ./internal/http -run 'TestEWSMeActiveWarnings|TestEWSMeNotifications.*LifecycleMetadata' -count=1
```

Result: PASS.

Full verification:

```bash
cd apps/api
go test ./...
```

Result: PASS. `internal/http` passed and all API packages compiled successfully.

## Files

- `apps/api/internal/http/ews_active_warnings.go`
- `apps/api/internal/http/ews_active_warnings_test.go`
- `apps/api/internal/http/ews_me.go`
- `apps/api/cmd/server/main.go`

## Self-Review

- The active-warning SELECT and `rows.Scan` order match exactly.
- SQL JSON arrays decode into matched watch-zone ID and label slices.
- Queries scope warnings and notification history to the resolved authenticated subscriber; active-warning tests assert the bound subscriber ID.
- Default and explicit valid limits are asserted by sqlmock.
- Nullable alert, guidance, source, and notification lifecycle fields are returned as JSON `null`.
- The active-warning response selects structured metadata, geometry, matched zones, and stored guidance only; it does not select or expose raw payload.
- The route is registered inside the `SupabaseAuth`-protected `/api/v1/ews/me` group.

## Concerns

None. The geographic/peril matching SQL follows the production semantics established by Task 4.
