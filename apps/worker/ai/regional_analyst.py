"""Grounded regional analyst constrained to precomputed snapshots."""

from __future__ import annotations

from typing import Any

PROMPT_VERSION = "regional-analyst-v1"
MODEL_NAME = "deterministic-grounded-analyst"
REFUSAL_TERMS = (
    "kapan gempa",
    "lokasi gempa berikut",
    "prediksi gempa",
    "perintahkan evakuasi",
    "suruh evakuasi",
)


def analyze_regional_snapshot(snapshot: dict[str, Any], question: str) -> dict[str, Any]:
    normalized = question.lower()
    if any(term in normalized for term in REFUSAL_TERMS):
        return {
            "refused": True,
            "answer": "Saya tidak dapat memprediksi waktu/lokasi gempa atau membuat instruksi evakuasi. Ikuti peringatan dan arahan otoritas resmi.",
            "citations": [],
            "prompt_version": PROMPT_VERSION,
            "model": MODEL_NAME,
        }
    period = snapshot.get("period") or {}
    coverage = snapshot.get("source_coverage") or []
    sources = [str(item.get("source")) for item in coverage if item.get("source")]
    event_count = int(snapshot.get("event_count") or sum(int(x.get("event_count") or 0) for x in snapshot.get("timeline", [])))
    impact = snapshot.get("impact") or snapshot.get("impacts") or {}
    answer = (
        f"Wilayah {snapshot.get('administrative_code', 'tidak diketahui')} memiliki "
        f"{event_count} kejadian pada periode {period.get('from', '?')} sampai "
        f"{period.get('to', '?')}. Dampak yang tercatat: "
        f"{int(impact.get('deaths') or 0)} meninggal dan "
        f"{int(impact.get('displaced') or 0)} mengungsi/terdampak. "
        "Angka ini menggambarkan catatan historis, bukan prediksi kejadian berikutnya."
    )
    return {
        "refused": False,
        "answer": answer,
        "citations": [{"source": source} for source in sources],
        "period": period,
        "administrative_code": snapshot.get("administrative_code"),
        "confidence": snapshot.get("confidence", "unknown"),
        "limitations": snapshot.get("limitations") or snapshot.get("missing_data") or {},
        "prompt_version": PROMPT_VERSION,
        "model": MODEL_NAME,
    }


__all__ = ["analyze_regional_snapshot", "MODEL_NAME", "PROMPT_VERSION"]
