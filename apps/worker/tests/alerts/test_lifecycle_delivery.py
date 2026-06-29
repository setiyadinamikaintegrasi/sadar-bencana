from datetime import timedelta

from alerts.lifecycle_delivery import lifecycle_action, lifecycle_message, retry_delay


def test_lifecycle_action_maps_update_cancel_and_expiry():
    assert lifecycle_action("alert", "active") == "alert"
    assert lifecycle_action("update", "active") == "update"
    assert lifecycle_action("cancel", "cancelled") == "cancellation"
    assert lifecycle_action("alert", "expired") == "expiry"


def test_retry_uses_bounded_exponential_schedule():
    assert retry_delay(1) == timedelta(seconds=30)
    assert retry_delay(2) == timedelta(seconds=60)
    assert retry_delay(5) == timedelta(seconds=480)


def test_cancellation_message_preserves_official_text():
    message = lifecycle_message(
        {
            "lifecycle_action": "cancellation",
            "headline": "Peringatan Dini Cuaca",
            "description": "Peringatan telah dicabut BMKG.",
        }
    )
    assert message.startswith("[DIBATALKAN] Peringatan Dini Cuaca")
    assert "dicabut BMKG" in message
