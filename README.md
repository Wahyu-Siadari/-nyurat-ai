# NYURAT.AI

Studio papan nama dan audit foto beraksara Bali. Ruang kerja papan nama mencakup pelafalan, komposisi, pemeriksaan, dan ekspor draf. Audit foto mengirim gambar pilihan pengguna dan menampilkan hasil dari layanan. Frontend dan backend berada di repo yang sama.

## Menjalankan

Ekstrak ZIP, lalu buka folder `NYURAT-AI-Frontend` yang berisi `package.json` di Antigravity IDE atau editor lain. Gunakan Node.js 24 dan jalankan dari terminal folder tersebut.

```powershell
npm ci
npm run dev
```

Buka http://127.0.0.1:3000. Jika port 3000 sedang dipakai, jalankan `npm run dev -- --port 3100` dan buka http://127.0.0.1:3100. Di Windows, gunakan `npm.cmd` bila PowerShell memblokir `npm.ps1`.

### Konfigurasi

Salin `.env.example` menjadi `.env.local`, lalu isi yang diperlukan. Semua variabel hanya dibaca server.

| Variabel | Bawaan | Fungsi |
| --- | --- | --- |
| `GEMINI_API_KEY` | kosong | Kunci Google Gemini untuk usulan pelafalan dan audit foto |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Model Gemini yang dipakai |
| `NYURAT_RATE_LIMIT_PER_MIN` | `30` | Batas permintaan per IP per menit; satu audit foto dihitung 3 |
| `NYURAT_MODE` | `live` | `live` memakai layanan asli, `fixture` memakai data contoh |

Tiga cara menjalankan:

- **Dengan `GEMINI_API_KEY`.** Pelafalan memuat usulan AI, dan audit foto menganalisis foto apa pun.
- **Tanpa kunci.** Pelafalan memakai mesin aturan saja, alih aksara dan ekspor tetap berjalan, dan audit foto menjawab layanan belum tersedia.
- **`NYURAT_MODE=fixture`.** Semua hasil adalah data contoh tanpa internet, juga di build produksi, untuk demo offline. UI menandainya **Data contoh**, dan audit foto hanya menerima berkas contoh yang disertakan.

Tier gratis Gemini sangat terbatas: `gemini-3.6-flash` hanya 20 permintaan per hari. Hasil pengukuran dan saran untuk demo ada di [docs/BACKEND-NOTES.md](docs/BACKEND-NOTES.md).

### Alur uji lokal

1. Buka **Papan nama**, isi **Warung Sari**, lalu pilih jenis usaha **Warung** dan bahasa **Indonesia**.
2. Minta usulan pelafalan, pilih satu opsi untuk setiap kata, dan centang konfirmasi. Pilih **Susun papan**.
3. Sesuaikan tata letak, pilih **Periksa draf**, lalu coba **Unduh PDF draf**, **Unduh SVG draf**, atau **Unduh data paket (.json)**.
4. Buka **Audit foto**, unggah foto papan, lalu pilih **Analisis foto**. Langkah ini perlu `GEMINI_API_KEY`. Dalam mode `fixture`, unggah [papan-warung-sari-contoh.png](tests/fixtures/papan-warung-sari-contoh.png) untuk melihat hasil simulasi.

### Pemeriksaan kode dan build produksi

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run start -- --port 3000
```

Tes tidak pernah memanggil Gemini sungguhan. Draf dan foto aktif disimpan di memori tab. Font IBM Plex Sans dan Noto Sans Balinese disajikan dari public/fonts, beserta lisensinya.

### Deploy

Gunakan `npm run start:prod` di platform Node seperti Render, Railway, Fly, atau VPS. Skrip ini menerima koneksi dari luar dan membaca port dari `PORT`, sedangkan `npm run start` hanya melayani 127.0.0.1. Vercel membatasi body permintaan 4,5 MB, lebih kecil dari batas foto 10 MB. Pilihannya ada di [docs/BACKEND-NOTES.md](docs/BACKEND-NOTES.md).

## Integrasi backend

Backend adalah Next.js Route Handlers di `src/app/api/v1/**`, dengan logika di `src/server/**`. Frontend memanggil /api/v1 pada origin yang sama. Kunci API hanya ada di server. Kode `src/server/**` tidak boleh diimpor dari komponen client.

| Operasi | Endpoint POST | Data respons |
| --- | --- | --- |
| Usulan pelafalan | /api/v1/pronunciation-proposals | proposalSchema |
| Alih aksara dan pratinjau | /api/v1/board-renders | renderResultSchema |
| Paket pemeriksaan JSON | /api/v1/review-packages | exportFileSchema |
| Ekspor SVG | /api/v1/exports | exportFileSchema |
| Audit foto | /api/v1/photo-audits | photoAnalysisSchema |

Empat endpoint papan nama menerima JSON berisi schemaVersion, projectId, revision, dan project, maksimal 256 KB. Bentuk ProjectDraft, provenance, dan skema respons ada di src/lib/contract.ts. Adaptor ada di src/lib/api-service.ts.

Respons sukses memuat ok: true, schemaVersion: "0.1-draft", requestId, projectId, revision, dan data. projectId dan revision sama dengan permintaan. projectId adalah UUID draf yang dibuat di klien. Revisi input, konfirmasi, hasil alih aksara, dan tata letak pada data sesuai dengan snapshot permintaan.

Semua kegagalan, termasuk alamat tidak dikenal dan metode selain POST, menjawab JSON berisi ok: false, schemaVersion, requestId, dan error dengan code, message, serta retryable. Pesannya aman ditampilkan kepada pengguna. Setiap respons memuat header `X-Request-Id` dan `Cache-Control: no-store`. Adaptor memvalidasi respons dan batas tunggu permintaan adalah 15 detik.

| Kode | HTTP | Arti |
| --- | --- | --- |
| INVALID_INPUT | 400 | Body, skema, nama, atau tata letak tidak valid |
| NOT_FOUND | 404 | Alamat tidak dikenal |
| METHOD_NOT_ALLOWED | 405 | Metode selain POST |
| STALE_REVISION | 409 | Snapshot tidak konsisten atau hasilnya sudah lama |
| PAYLOAD_TOO_LARGE | 413 | Body melewati batas |
| UNSUPPORTED_MEDIA_TYPE | 415 | Jenis data salah, atau foto bukan JPEG, PNG, atau WebP |
| RATE_LIMITED | 429 | Terlalu banyak permintaan |
| QUOTA_EXHAUSTED | 429 | Kuota Gemini habis saat audit foto |
| EXPORT_FAILED | 500 | Berkas gagal dibuat |
| INTERNAL_ERROR | 500 | Kendala lain di server |
| UPSTREAM_UNAVAILABLE | 503 | Gemini gagal atau kunci belum diatur saat audit foto |
| AI_TIMEOUT | 504 | Gemini melewati batas waktu saat audit foto |

Usulan pelafalan tidak gagal saat Gemini bermasalah. Endpoint tetap menjawab 200 dengan opsi aturan, dan `serviceState` menunjukkan sebabnya.

Audit foto menerima multipart/form-data dengan photo dan photoRevision, lalu menjawab JSON { ok: true, data: PhotoAnalysis } sesuai src/lib/photo-audit.ts. Hasil memuat dimensi gambar, revisi foto, status, sumber, serta kotak tulisan dengan koordinat ternormalisasi 0–1. Hasil hanya ditampilkan ketika dimensi dan revisi sesuai dengan foto yang dikirim. Teks area aksara Bali selalu kosong, karena bacaan model tidak bisa dipercaya; letak dan ukurannya tetap dilaporkan. Batas unggahan JPEG, PNG, atau WebP adalah 10 MB, 24 megapiksel, dan minimal 64 × 64 piksel. Foto hanya diproses di memori dan tidak disimpan.

Notasi pelafalan, keputusan aturan, dan daftar verifikasi ahli ada di [docs/BACKEND-NOTES.md](docs/BACKEND-NOTES.md).

## Status dan ekspor

Alih aksara dibuat oleh mesin aturan deterministik di `src/server/aksara`, dari pelafalan yang dipilih pengguna. AI hanya mengusulkan pelafalan dan mendeteksi area tulisan, serta tidak pernah menghasilkan aksara Bali final. Aturannya belum diperiksa ahli bahasa. Kegagalan API ditampilkan pada operasi terkait sehingga pengguna dapat mencoba ulang dengan data yang sama.

PDF A4 lanskap dibuat di browser dari pratinjau berskala. SVG dan JSON berasal dari backend melalui kontrak exportFileSchema dengan filename, mimeType, dan contents. Status dokumen tetap **belum diperiksa ahli**. Pemeriksaan balik menilai konsistensi teknis dan validasi cetak masih diperlukan.
