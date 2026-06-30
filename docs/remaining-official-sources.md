# Remaining Official Source Connectors

InaTEWS, PVMBG, BNPB, dan InaRISK memakai kontrak approved JSON feed:

- URL wajib HTTPS dan hostname resmi (`bmkg.go.id`, `esdm.go.id`, atau
  `bnpb.go.id`);
- redirects dimatikan;
- feature flag default off;
- URL feed wajib direview terms/licensing sebelum aktivasi;
- payload invalid ditolak per record tanpa mengubah status resmi terakhir.

InaTEWS menyimpan bulletin group dan revision; final bulletin menjadi
cancellation, bukan inferensi magnitude. PVMBG mempertahankan Level I–IV dan
recommendation tanpa mengubahnya menjadi magnitude. BNPB diperlakukan sebagai
impact confirmation, bukan warning prediktif. InaRISK hanya menjadi versioned
static risk context dengan data vintage dan attribution.

Portal resmi yang sudah teridentifikasi adalah InaTSP public bulletin BMKG dan
Satu Data Bencana BNPB. MAGMA/InaRISK harus memakai feed yang disetujui pemilik
data; aplikasi tidak melakukan scraping UI.
