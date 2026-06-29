# EWS Alert Lifecycle Delivery

Migration `025_ews_alert_lifecycle_delivery.sql` menambahkan delivery per revisi
official alert, exponential retry, dead-letter, acknowledgement, dan latency.

Dedup key terdiri dari subscriber, channel, source, source alert identifier,
revision, dan lifecycle action. Update tetap terkirim sebagai revisi baru,
sedangkan retry revisi yang sama tidak menghasilkan duplikat.

Cancellation dan expiry hanya diantrikan kepada penerima alert/revisi
sebelumnya. Ini memastikan pencabutan sampai kepada pihak yang menerima
peringatan awal.

Retry dilakukan pada 30, 60, 120, 240, dan 480 detik. Setelah percobaan kelima,
delivery berstatus `dead_letter`. `delivery_latency_ms` dihitung dari timestamp
rilis official alert sampai pengiriman berhasil.

```bash
psql "$DATABASE_URL" -f db/schema/025_ews_alert_lifecycle_delivery.sql
```
