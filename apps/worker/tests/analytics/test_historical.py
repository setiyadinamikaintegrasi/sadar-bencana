from analytics.historical import build_historical_snapshot


def test_golden_dataset_calculates_backend_numbers():
    rows = [
        {"year": 2023, "month": 1, "peril_type": "flood", "deaths": 1, "displaced": 100},
        {"year": 2023, "month": 2, "peril_type": "flood", "deaths": 0, "displaced": 50},
        {"year": 2024, "month": 1, "peril_type": "earthquake", "deaths": 2, "displaced": 0},
    ]
    snapshot = build_historical_snapshot(
        rows,
        administrative_code="31.71",
        period_from="2023-01-01",
        period_to="2024-12-31",
        population_denominator=100_000,
    )
    assert snapshot["event_count"] == 3
    assert snapshot["impacts"]["deaths"] == 3
    assert snapshot["impact_rates"]["deaths_per_100k"] == 3
    assert snapshot["peril_composition"] == {"earthquake": 1, "flood": 2}


def test_empty_data_does_not_invent_rates_or_confidence():
    snapshot = build_historical_snapshot(
        [],
        administrative_code="31",
        period_from="2020-01-01",
        period_to="2025-12-31",
    )
    assert snapshot["event_count"] == 0
    assert snapshot["impact_rates"] is None
    assert snapshot["confidence"] == "low"
    assert snapshot["missing_data"]["empty_dataset"] is True


def test_administrative_codes_keep_similar_names_separate():
    first = build_historical_snapshot(
        [{"year": 2024, "month": 1, "peril_type": "flood"}],
        administrative_code="32.01",
        period_from="2024-01-01",
        period_to="2024-12-31",
    )
    second = build_historical_snapshot(
        [],
        administrative_code="32.71",
        period_from="2024-01-01",
        period_to="2024-12-31",
    )
    assert first["administrative_code"] != second["administrative_code"]
    assert first["event_count"] != second["event_count"]
