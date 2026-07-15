# Task 6 Report: Persist BMKG PM2.5 Observations

## Scope

Implemented validated BMKG PM2.5 observation inputs and isolated persistence
helpers for `air_quality_observations`. Observations do not import, create, or
enqueue official alerts or EWS notifications.

## TDD Evidence

### RED

1. `apps/worker/.venv/bin/python -m pytest tests/models/test_air_quality.py -q`
   failed during collection with `ModuleNotFoundError: No module named
   'models.air_quality'`.
2. `apps/worker/.venv/bin/python -m pytest tests/db/test_air_quality.py -q`
   failed during collection with `ModuleNotFoundError: No module named
   'db.air_quality'`.

### GREEN

1. `apps/worker/.venv/bin/python -m pytest tests/models/test_air_quality.py tests/db/test_air_quality.py -q`
   passed: `20 passed in 0.07s`.
2. `apps/worker/.venv/bin/python -m pytest -q`
   passed: `260 passed, 9 skipped, 4 warnings in 0.69s`.

The four warnings are existing FastAPI `on_event` deprecation warnings in
`apps/worker/main.py` and FastAPI internals.

## Files

- `apps/worker/models/air_quality.py`
- `apps/worker/db/air_quality.py`
- `apps/worker/tests/models/test_air_quality.py`
- `apps/worker/tests/db/test_air_quality.py`

## Self-Review

- Unit normalization accepts all required microgram spellings and stores
  `ug/m3`.
- Categories exactly match migration 040; timestamps must be timezone-aware.
- Source URLs require HTTPS on `bmkg.go.id` or a BMKG subdomain.
- Model coordinate-pair validation matches the table constraint and field
  ranges match the migration bounds.
- Upsert binds columns in SQL order, serializes JSON deterministically, and
  reports whether `ON CONFLICT DO NOTHING` inserted a row.
- Retention delegates the exact 30-day cutoff to PostgreSQL using a UTC
  reference timestamp.
- The implementation is isolated from official-alert and EWS code.

## Concerns

None for Task 6. Retention is exposed as a helper; scheduling it is outside
this task's specified files and scope.

## Review Findings Follow-up

### RED

`apps/worker/.venv/bin/python -m pytest tests/models/test_air_quality.py tests/db/test_air_quality.py -q`
failed as expected before the fix: `5 failed, 27 passed in 0.10s`.

- The model accepted `NaN`, `Infinity`, and `datetime` values in `raw_payload`.
- The DB serializer accepted `NaN`.
- Retention interpreted a naive `now` value using the host local timezone.

### GREEN

1. `apps/worker/.venv/bin/python -m pytest tests/models/test_air_quality.py tests/db/test_air_quality.py -q`
   passed: `32 passed in 0.07s`.
2. `apps/worker/.venv/bin/python -m pytest -q`
   passed: `272 passed, 9 skipped, 4 warnings in 0.63s`.

The four warnings are the existing FastAPI `on_event` deprecation warnings in
`apps/worker/main.py` and FastAPI internals.

### Self-Review

- `raw_payload` now accepts only recursively JSON-compatible dictionaries,
  lists, primitives, and finite floating-point values; non-string object keys
  and Python objects such as `datetime` are rejected by model validation.
- The persistence serializer uses `allow_nan=False`, preventing non-finite
  values from being persisted even when a caller bypasses Pydantic validation.
- Retention converts aware datetimes to UTC and rejects naive values before any
  database operation.
- Tests cover invalid units, coordinate bounds, BMKG root and subdomain hosts,
  and look-alike host rejection.
