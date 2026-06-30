# AI Regional Risk Analyst

Analyst hanya menerima snapshot numerik yang sudah dihitung backend. Output
menyertakan periode, administrative code, source citation, confidence,
limitations, model, dan prompt version. Input snapshot serta output disimpan
untuk audit melalui migration 029.

Policy menolak prediksi waktu/lokasi gempa dan instruksi evakuasi spekulatif.
Teks pada metadata sumber diperlakukan sebagai data, bukan instruksi. Kegagalan
analyst tidak memengaruhi regional statistics API atau dashboard.
