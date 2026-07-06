"""Safe, dependency-free HTML templates for EWS email notifications."""

from __future__ import annotations

from datetime import date, datetime
from html import escape
from typing import Any
from urllib.parse import urlsplit

DEFAULT_PUBLIC_BASE_URL = "https://sadarbencana.id"

_SEVERITY_STYLES = {
    "critical": ("KRITIS", "#991b1b", "#fee2e2"),
    "high": ("TINGGI", "#9a3412", "#ffedd5"),
    "moderate": ("MODERAT", "#854d0e", "#fef9c3"),
    "test": ("TEST SISTEM", "#3730a3", "#e0e7ff"),
}

_TYPE_LABELS = {
    "earthquake": "Gempa bumi",
    "flood": "Banjir",
    "volcano": "Aktivitas gunung api",
    "wildfire": "Kebakaran hutan/lahan",
    "risk_score": "Peningkatan skor risiko",
    "system_test": "Pengujian sistem",
}


def safe_public_base_url(value: str | None) -> str:
    """Accept only absolute HTTPS URLs for links rendered into email."""

    candidate = (value or "").strip().rstrip("/")
    parsed = urlsplit(candidate)
    if parsed.scheme != "https" or not parsed.netloc:
        return DEFAULT_PUBLIC_BASE_URL
    if parsed.username or parsed.password:
        return DEFAULT_PUBLIC_BASE_URL
    return candidate


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value).strip()


def _html_text(value: Any) -> str:
    return escape(_text(value), quote=True).replace("\n", "<br>")


def _severity(value: Any) -> tuple[str, str, str]:
    normalized = _text(value).lower()
    return _SEVERITY_STYLES.get(
        normalized,
        ("INFORMASI", "#334155", "#e2e8f0"),
    )


def _recommendation(severity: Any, notification_kind: Any) -> str:
    if _text(notification_kind).lower() == "test":
        return (
            "Tidak ada tindakan darurat yang diperlukan. Pesan ini memastikan "
            "kanal email EWS Anda dapat menerima notifikasi."
        )
    normalized = _text(severity).lower()
    if normalized == "critical":
        return (
            "Segera verifikasi kondisi di lokasi pantauan, ikuti arahan otoritas, "
            "dan aktifkan prosedur respons darurat yang berlaku."
        )
    if normalized == "high":
        return (
            "Tingkatkan kesiapsiagaan, periksa aset atau lokasi pantauan, dan "
            "ikuti pembaruan dari sumber resmi."
        )
    return (
        "Pantau perkembangan melalui sumber resmi dan tinjau kembali kesiapan "
        "lokasi yang terdampak."
    )


def render_html_email(
    *,
    subject: str,
    message: str,
    public_base_url: str | None = None,
    **metadata: Any,
) -> str:
    """Render a responsive, email-client-friendly HTML notification."""

    base_url = safe_public_base_url(public_base_url)
    dashboard_url = f"{base_url}/"
    severity_label, severity_color, severity_background = _severity(
        metadata.get("severity")
    )
    alert_type = _text(metadata.get("alert_type"))
    alert_type_label = _TYPE_LABELS.get(alert_type, alert_type.replace("_", " ").title())
    headline = _text(metadata.get("headline")) or subject

    detail_rows: list[tuple[str, str]] = []
    for label, key in (
        ("Jenis peringatan", "alert_type"),
        ("Sumber", "source"),
        ("Waktu kejadian", "occurred_at"),
        ("Status", "lifecycle_action"),
    ):
        value = metadata.get(key)
        if key == "alert_type" and alert_type:
            value = alert_type_label
        rendered = _text(value)
        if rendered:
            detail_rows.append((label, rendered))

    rows_html = "".join(
        (
            '<tr>'
            f'<td style="padding:8px 12px;color:#64748b;font-size:13px;'
            f'border-bottom:1px solid #e2e8f0;">{escape(label)}</td>'
            f'<td style="padding:8px 12px;color:#0f172a;font-size:13px;'
            f'font-weight:600;border-bottom:1px solid #e2e8f0;">'
            f'{_html_text(value)}</td>'
            '</tr>'
        )
        for label, value in detail_rows
    )
    details_section = (
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="margin-top:20px;border:1px solid #e2e8f0;border-radius:10px;'
        f'border-collapse:separate;overflow:hidden;">{rows_html}</table>'
        if rows_html
        else ""
    )

    description = _text(metadata.get("description"))
    description_section = (
        '<div style="margin-top:16px;padding:14px 16px;background:#f8fafc;'
        'border-left:4px solid #94a3b8;border-radius:6px;color:#334155;'
        f'font-size:14px;line-height:1.6;">{_html_text(description)}</div>'
        if description and description != message
        else ""
    )

    recommendation = _recommendation(
        metadata.get("severity"),
        metadata.get("notification_kind"),
    )
    preheader = _html_text(_text(message)[:180])

    return f"""<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    {preheader}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
               style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;
                      box-shadow:0 8px 30px rgba(15,23,42,.08);">
          <tr>
            <td style="padding:24px 28px;background:#0f172a;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size:20px;font-weight:700;color:#ffffff;">SadarBencana</div>
                    <div style="margin-top:4px;font-size:11px;letter-spacing:1.6px;color:#94a3b8;">
                      EARLY WARNING SYSTEM
                    </div>
                  </td>
                  <td align="right">
                    <span style="display:inline-block;padding:7px 10px;border-radius:999px;
                                 background:{severity_background};color:{severity_color};
                                 font-size:11px;font-weight:700;letter-spacing:.5px;">
                      {severity_label}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0;font-size:24px;line-height:1.3;color:#0f172a;">
                {_html_text(headline)}
              </h1>
              <div style="margin-top:16px;font-size:15px;line-height:1.7;color:#334155;">
                {_html_text(message)}
              </div>
              {description_section}
              {details_section}
              <div style="margin-top:20px;padding:16px;border-radius:10px;background:#eff6ff;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.6px;color:#1d4ed8;">
                  TINDAKAN YANG DISARANKAN
                </div>
                <div style="margin-top:7px;font-size:14px;line-height:1.6;color:#1e3a8a;">
                  {_html_text(recommendation)}
                </div>
              </div>
              <div style="margin-top:24px;text-align:center;">
                <a href="{escape(dashboard_url, quote=True)}"
                   style="display:inline-block;padding:12px 20px;border-radius:9px;
                          background:#2563eb;color:#ffffff;text-decoration:none;
                          font-size:14px;font-weight:700;">
                  Buka Dashboard SadarBencana
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;
                       color:#64748b;font-size:11px;line-height:1.5;text-align:center;">
              Email otomatis dari SadarBencana EWS. Jangan membalas email ini.<br>
              Kelola zona pantauan dan preferensi notifikasi melalui dashboard.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
