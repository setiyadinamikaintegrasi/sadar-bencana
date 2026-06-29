"""Versioned alert confidence policy, independent from hazard severity."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from correlation import source_independence_group

ALERT_POLICY_VERSION = "alert-policy-v1"


class AlertPolicyInput(BaseModel):
    severity: Literal["Minor", "Low", "Moderate", "High", "Critical"]
    source_names: list[str] = Field(default_factory=list)
    official_warning: bool = False
    confirmed_event: bool = False
    freshness: float = Field(default=1.0, ge=0, le=1)
    previous_severity: str | None = None
    manual_confidence_class: str | None = None
    manual_override_by: str | None = None
    manual_override_reason: str | None = None

    @model_validator(mode="after")
    def validate_manual_override(self):
        values = (
            self.manual_confidence_class,
            self.manual_override_by,
            self.manual_override_reason,
        )
        if any(value is not None for value in values) and not all(
            value and value.strip() for value in values
        ):
            raise ValueError("manual override requires class, actor, and reason")
        return self


class AlertPolicyDecision(BaseModel):
    confidence_class: Literal[
        "official_warning",
        "confirmed_event",
        "corroborated_signal",
        "unverified_signal",
    ]
    verification_status: Literal["official", "corroborated", "unverified"]
    lifecycle_action: Literal[
        "create", "escalate", "deescalate", "maintain", "suppress", "review"
    ]
    preserve_source_wording: bool
    policy_version: str
    independent_source_count: int
    reasons: list[str]
    manual_override: bool = False


_SEVERITY_ORDER = {
    "Minor": 0,
    "Low": 1,
    "Moderate": 2,
    "High": 3,
    "Critical": 4,
}
_CONFIDENCE_CLASSES = {
    "official_warning",
    "confirmed_event",
    "corroborated_signal",
    "unverified_signal",
}


def evaluate_alert_policy(policy_input: AlertPolicyInput) -> AlertPolicyDecision:
    groups = {
        source_independence_group(source)
        for source in policy_input.source_names
        if source.strip()
    }
    source_count = len(groups)
    reasons: list[str] = []

    if policy_input.official_warning:
        confidence_class = "official_warning"
        verification = "official"
        reasons.append("authoritative_warning")
    elif policy_input.confirmed_event:
        confidence_class = "confirmed_event"
        verification = "corroborated"
        reasons.append("trusted_structured_event")
    elif source_count >= 2:
        confidence_class = "corroborated_signal"
        verification = "corroborated"
        reasons.append("independent_source_corroboration")
    else:
        confidence_class = "unverified_signal"
        verification = "unverified"
        reasons.append("insufficient_independent_sources")

    manual_override = policy_input.manual_confidence_class is not None
    if manual_override:
        requested = str(policy_input.manual_confidence_class)
        if requested not in _CONFIDENCE_CLASSES:
            raise ValueError("invalid manual confidence class")
        confidence_class = requested
        verification = {
            "official_warning": "official",
            "confirmed_event": "corroborated",
            "corroborated_signal": "corroborated",
            "unverified_signal": "unverified",
        }[requested]
        reasons.append("audited_manual_override")

    if policy_input.freshness <= 0:
        if confidence_class == "official_warning":
            action = "review"
            reasons.append("official_source_stale")
        else:
            action = "suppress"
            reasons.append("source_stale")
    elif policy_input.previous_severity in _SEVERITY_ORDER:
        previous = _SEVERITY_ORDER[str(policy_input.previous_severity)]
        current = _SEVERITY_ORDER[policy_input.severity]
        action = "escalate" if current > previous else "deescalate" if current < previous else "maintain"
    else:
        action = "create"

    return AlertPolicyDecision(
        confidence_class=confidence_class,
        verification_status=verification,
        lifecycle_action=action,
        preserve_source_wording=policy_input.official_warning,
        policy_version=ALERT_POLICY_VERSION,
        independent_source_count=source_count,
        reasons=reasons,
        manual_override=manual_override,
    )


__all__ = [
    "ALERT_POLICY_VERSION",
    "AlertPolicyDecision",
    "AlertPolicyInput",
    "evaluate_alert_policy",
]
