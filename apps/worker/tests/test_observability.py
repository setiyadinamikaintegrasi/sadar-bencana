from observability import disaster_correlation_id


def test_correlation_id_is_stable_across_pipeline_stages():
    raw = disaster_correlation_id("BMKG_CAP", "alert-001")
    delivery = disaster_correlation_id("bmkg_cap", "alert-001")
    other_revision = disaster_correlation_id("bmkg_cap", "alert-002")

    assert raw == delivery
    assert raw != other_revision
