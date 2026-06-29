# EWS Action Cards

Action card menjawab: apa yang terjadi, mengapa pengguna menerima alert, dan
apa yang perlu dilakukan sebelum, saat, serta setelah kejadian.

Konten keselamatan Bahasa Indonesia disimpan lokal di `ews_safety_guidance`,
dikurasi, memiliki version dan source URL, serta tidak dibuat bebas oleh LLM.
Karena tersimpan di database aplikasi, panduan tetap tersedia ketika sumber
eksternal gagal.

Endpoint:

```http
GET /api/v1/alerts/{alert_uuid}/action-card
```

Migration `026_ews_action_cards.sql` menyediakan konten awal untuk gempa,
banjir, gunung api, dan karhutla. Instruksi tidak memerintahkan evakuasi
berdasarkan inferensi aplikasi; pengguna diarahkan mengikuti otoritas resmi.
