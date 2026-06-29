# EWS Map Risk Overlays

Endpoint `GET /api/v1/map/overlays` memisahkan tiga kelas layer:

- `official`: polygon warning resmi beserta effective/expires;
- `static_risk`: hazard/exposure/vulnerability context dengan data vintage dan
  attribution;
- `watch_zone`: radius pemantauan pengguna.

Frontend menampilkan toggle layer, legend untuk official/observed/inferred/
unverified, dan time slider 72 jam untuk lifecycle warning. Layer kajian statis
tidak diberi tampilan yang sama dengan warning real-time.

Geometry dibatasi maksimal 200 official polygon, 200 risk context, dan 500
watch zone per request. Kegagalan endpoint overlay tidak memblokir marker event
real-time.
