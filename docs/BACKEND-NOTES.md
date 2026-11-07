# Catatan Backend NYURAT.AI

Catatan untuk tim frontend, ahli bahasa, dan siapa pun yang men-deploy aplikasi ini. Penomoran § mengacu pada `PROMPT-BACKEND-NYURAT.md`.

## Belum terverifikasi

- **Foto papan nyata belum diuji.** Audit dengan Gemini sungguhan baru memakai foto contoh yang rapi, jadi perilaku pada foto jalanan belum diketahui.
- **Aturan aksara belum diperiksa ahli bahasa.** Lihat bagian TODO di bawah.
- **Safari dan Firefox belum diukur** untuk orientasi EXIF.

## Hasil uji Gemini sungguhan

Diukur pada 6 November 2026 di tier gratis, lewat build produksi. Sampelnya kecil, jadi angka ini gambaran, bukan tolok ukur.

| | `gemini-3.6-flash` (bawaan) | `gemini-3.5-flash-lite` |
| --- | --- | --- |
| Pelafalan berhasil | 3 dari 6 lewat aplikasi | 9 dari 13 lewat aplikasi |
| Waktu pelafalan | 2,3–12 detik | 1,3 detik sampai lewat batas 9 detik |
| Waktu audit foto | 2,6–4,9 detik | 2,6–3,3 detik |
| Kotak tulisan | Rapat | Horizontal tepat, vertikal memotong tulisan |
| Rasio Bali/Latin pada foto yang sama | 1,7–1,9 | 1,5–2,4 |
| Kuota harian tier gratis | 20 permintaan | Belum diketahui, lihat AI Studio |

- **Usulan pelafalan masuk akal di kedua model.** Contohnya `Desa` menjadi `désa`, `Gede` menjadi `gedé`, dan `Sate` menjadi `saté`. `thinkingLevel: LOW` diterima.
- **Waktu respons kedua model tidak stabil, dan berubah menurut jam.** Lima permintaan pertama Flash-Lite selesai di bawah 2 detik, tetapi beberapa jam kemudian hanya 4 dari 8 yang berhasil, dalam 6 sampai lebih dari 9 detik. Jadi Flash-Lite tidak terbukti lebih andal, dan perbedaan pada tabel di atas sebagian besar soal waktu pengukuran. Semua kegagalan jatuh ke opsi aturan tanpa error.
- **Penyebabnya antrean di sisi Google, bukan kode ini.** Pada saat lambat, jaringan ke Google tetap sekitar 120 ms, tetapi jawaban dua token tanpa skema pun butuh 4,3 detik, dan 503 tetap muncul. Skema dan `thinkingLevel` tidak memperbaikinya: `thoughtsTokenCount` selalu 0, dan `MINIMAL` tidak lebih cepat. Apakah tier berbayar lebih cepat belum diukur.
- **Kuota tier gratis sangat kecil.** `gemini-3.6-flash` dibatasi 20 permintaan per hari per proyek per model (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), selain batas per menit. Kuota harian direset tengah malam waktu Pasifik, dan dihitung per proyek, bukan per kunci. Rate limit aplikasi tidak melindungi kuota ini, jadi 20 pengunjung bisa menghabiskannya. Saat habis, pelafalan tetap jalan dengan opsi aturan, tetapi audit foto menjawab `QUOTA_EXHAUSTED`.
- **Bug yang hanya terlihat dengan API asli.** `minItems` dan `maxItems` pada `box_2d` membuat Gemini menolak seluruh request dengan 400. Keduanya dihapus dan dijaga tes regresi. Panjang empat angka tetap diperiksa oleh `outputSchema`.
- **Bacaan aksara Bali tidak bisa dipercaya.** Foto contoh berisi `ᬅᬓ᭄ᬱᬭ ᬩᬮᬶ`, tetapi `gemini-3.6-flash` melaporkan `ᬯᬭᬸᬂ ᬲᬭᬶ` dengan keyakinan `high`, yaitu aksara karangan dari tulisan Latin di bawahnya. Karena itu bacaannya disembunyikan. Lihat keputusan di bawah.

**Keputusan untuk demo.** Demo memakai `GEMINI_MODEL=gemini-3.5-flash-lite` lewat `.env.local`. Bawaan kode tetap `gemini-3.6-flash` sesuai §7, jadi variabel ini juga harus diisi di platform hosting. Keuntungan yang tersisa setelah pengukuran ulang adalah kuota harian yang terpisah dari 3.6 Flash. Kerugiannya kotak audit foto yang kurang rapat. Untuk kembali, hapus baris itu.

**Saran untuk hari demo.** Jalankan dulu nama-nama yang akan didemokan: hasil yang berhasil tersimpan di cache 24 jam dan terjawab dalam sekitar 50 ms, selama server tidak restart. Audit foto tidak di-cache, jadi coba foto demo lebih dulu dan sisakan kuota. Periksa kuota di halaman rate limit AI Studio. Aktifkan penagihan bila banyak pengguna akan mencoba; peningkatan ke Tier 1 biasanya langsung berlaku. Mode `fixture` tersedia sebagai cadangan bila internet atau Gemini bermasalah.

## Notasi pelafalan `nyurat-notation-0.1`

Alih aksara berjalan dari pelafalan yang dipilih, bukan dari `latinName`.

| Unsur | Penulisan |
| --- | --- |
| Vokal | `a i u o`, `e` = pepet /ə/, `é` = taling /e/ |
| Vokal panjang | `ā ī ū` |
| Diftong | `ai`, `au` |
| Konsonan | `h n c r k d t s w l m g b p j y`, digraf `ng`, `ny` |
| Huruf asing | `f v z q x`, gabungan `kh`, `sy` |
| Angka | `0–9` menjadi U+1B50–U+1B59 |

Normalisasi: Unicode NFC, huruf kecil locale `id`, `ə` menjadi `e`, `è` menjadi `é`, spasi berlebih dirapikan.

`isValidNotation` menerima huruf, angka, dan tanda baca. Tanda baca perlu diterima karena token seperti `&` tetap harus punya opsi "seperti ditulis". Tanda baca dibuang dari hasil aksara dan tokennya masuk `unsupportedTokenIds`. Keluaran model AI memakai gerbang lebih ketat, `isPhoneticNotation`, yang hanya menerima huruf dan angka.

Pelafalan buatan pengguna boleh memuat spasi dan huruf di luar notasi. Bagian yang bisa ditulis tetap ditulis, dan tokennya ditandai belum didukung.

## Keputusan yang menyimpang dari atau melengkapi master prompt

- **Pepet pada ra dan la.** §6.2 tidak membahasnya, tetapi `ᬭ` dan `ᬮ` tidak memakai pepet. Mesin menulis `ᬋ` U+1B0B dan `ᬍ` U+1B0D di awal suku kata, serta `ᬺ` U+1B3A dan `ᬼ` U+1B3C di dalam gugus. Sumber: r12a dan Unicode Standard §17.3.
- **Huruf f, v, z.** Hasil tetap memakai rerekan sesuai §5.4, tetapi tokennya masuk `unsupportedTokenIds`. r12a menyebut rerekan khas teks Lombok dan tidak konsisten, sedangkan Wikipedia mencatat adaptasi `pa`, `ja`, dan `sa`. Saklarnya adalah field `unconfirmed` di `FOREIGN_LETTERS`.
- **Vokal mandiri di tengah kata.** §6.3 tidak mengaturnya. Mesin memakai `ha` pembawa, mengikuti r12a.
- **Kode error tambahan.** `NOT_FOUND` (404) dan `METHOD_NOT_ALLOWED` (405) ditambahkan karena §3 mewajibkan envelope JSON untuk keduanya, tetapi katalog tidak memuat kodenya.
- **Body terlalu besar.** §3 menulis `INVALID_INPUT`, katalog menulis `PAYLOAD_TOO_LARGE` 413. Backend memakai katalog karena lebih spesifik.
- **Skrip `npm test`.** Skrip ini memakai `--conditions=react-server`, karena `import "server-only"` melempar error di Node biasa.
- **Skrip `start:prod`.** §10 menulis `--port ${PORT:-3000}`, tetapi bentuk itu gagal di Windows karena npm memakai `cmd.exe`. Skripnya `next start --hostname 0.0.0.0`, dan `next start` sudah membaca `PORT` sendiri dengan bawaan 3000.
- **404 JSON.** §2 meminta `[operation]/route.ts` dihapus, sedangkan §3 mewajibkan 404 berbentuk JSON. Route `[[...path]]/route.ts` hanya menjawab `NOT_FOUND` dan tidak memuat logika adaptor. Route yang persis selalu didahulukan.
- **Stale lebih dulu di `board-renders`.** §5.2 menyebut `validateSelections` sebelum pemeriksaan revisi. Backend memeriksa revisi lebih dulu, supaya usulan lama menjawab `STALE_REVISION`, bukan `INVALID_INPUT`.
- **Nama tanpa aksara.** Nama yang seluruhnya simbol, misalnya `&`, tidak punya apa pun untuk ditulis, sedangkan skema melarang string kosong. `board-renders` menjawab `INVALID_INPUT` dan meminta pengguna menulis pelafalan sendiri.
- **Ekspor mengganti klaim klien.** §5.3 hanya mewajibkan perbandingan `balineseUnicode` dan `resultId`. Backend juga mengganti `matchesInput`, `unsupportedTokenIds`, provenance, dan `checks.roundTrip` dengan hasil hitung ulang, supaya berkas tidak bisa memuat klaim palsu. Hanya `checks.layout` yang tetap dari klien, karena pengukurannya ada di peramban.
- **Keluaran AI kosong.** Bila semua opsi Gemini gagal validasi, hasilnya dicatat `unavailable` dengan provenance aturan, bukan `ai`, karena AI tidak menyumbang apa pun.
- **Alasan dari AI.** `reason` adalah satu-satunya teks bebas dari model. Teks diberi awalan "Usulan AI:", dan yang terlalu panjang atau mirip markup diganti teks baku.
- **SDK Gemini.** `@google/genai` dipin ke 2.32.0. Versi 3.0.0 terbit pada 6 November 2026 dan belum dipakai. Model default `gemini-3.6-flash` masih stabil, walaupun Google menyebutnya generasi sebelumnya dan menunjuk Gemini 3.8 Flash sebagai Flash terbaru.
- **`thinkingLevel: LOW`.** Diterima API sungguhan. Pengukuran menunjukkan level ini tidak memengaruhi waktu respons.
- **Orientasi EXIF pada WebP.** §5.5 meminta dimensi setelah orientasi EXIF untuk semua foto. Pengukuran di Chrome 152 menunjukkan JPEG dan PNG mengikuti EXIF, tetapi WebP tidak. Backend karena itu tidak memutar WebP, baik pada dimensi yang dilaporkan maupun piksel yang dikirim ke model. Tanpa ini, WebP berorientasi 5–8 selalu ditolak frontend, dan kotak meleset dari foto yang tampil. Safari dan Firefox belum diukur.
- **Bacaan aksara Bali disembunyikan.** §5.5 hanya mengosongkan teks yang memuat karakter di luar blok Bali atau kosong, dan menjadikannya `uncertain`. Pengujian menunjukkan model bisa mengarang aksara yang sah dengan keyakinan `high`, sehingga bacaan asli dan karangan tidak bisa dibedakan. Backend kini selalu mengosongkan `text` untuk area Bali, dan prompt tidak lagi meminta model membacanya. `uncertain` tetap mengikuti `confidence`, yang kini berarti keyakinan soal area tulisan, supaya rasio dan posisi tetap tersedia. UI menampilkan "Teks belum terbaca". Jadi aksara Bali di papan tidak diperiksa isinya oleh aplikasi, hanya letak dan ukurannya.
- **Tanpa pemeriksaan `file.type`.** Format ditentukan oleh magic bytes dan `sharp`. Jenis berkas yang dideklarasikan klien diabaikan.
- **Gambar rusak.** Berkas dengan magic bytes benar tetapi isinya rusak dijawab `INVALID_INPUT` 400, karena §5.5 tidak mengaturnya. `UNSUPPORTED_MEDIA_TYPE` dipakai untuk format yang memang tidak didukung.
- **Batas unggahan.** Body multipart dibatasi 10 MB ditambah 64 KB untuk overhead, sebelum `formData()` berjalan. Berkas di atas 10 MB dijawab `PAYLOAD_TOO_LARGE`.
- **Salinan untuk model.** Salinan JPEG tidak membawa metadata, sehingga EXIF seperti lokasi GPS tidak sampai ke penyedia. Latar transparan diisi putih. Cache libvips dimatikan supaya foto tidak tertahan setelah respons.
- **Teks Latin hasil deteksi.** Spasi dirapikan, karakter kontrol dibuang, dan panjang dibatasi 200 karakter.
- **Kotak terlalu kecil.** Setiap sisi `box_2d` di-clamp ke gambar lebih dulu, lalu kotak yang lebar atau tingginya di bawah 0,002 sisi gambar dibuang. Ukuran dibandingkan pada skala 0–1000, tempat batasnya tepat 2, supaya galat pecahan tidak menentukan kotak di ambang batas. Bila semua kotak terbuang, statusnya `no_detection`.
- **Log kuota.** Kegagalan 4xx tidak dicatat, kecuali `QUOTA_EXHAUSTED`. Log memuat `requestId` dan jenis kuota dari Google, karena batas harian dan batas per menit sama-sama 429 tetapi pulihnya berbeda jauh.

## Mode fixture

`NYURAT_MODE=fixture` memakai `src/lib/mock.ts` lewat envelope dan validasi yang sama, dan boleh aktif di build produksi. Gemini tidak pernah dipanggil, walaupun kuncinya ada. Provenance tetap `producer: "fixture"`, sehingga UI menampilkan **Data contoh**.

Audit foto hanya menerima `tests/fixtures/papan-warung-sari-contoh.png`, dicocokkan lewat SHA-256 agar build demo tidak perlu membawa folder `tests`. Foto lain dijawab `INVALID_INPUT` tanpa hasil palsu. Adaptor lama menjawab 404 kosong untuk kasus ini.

## Deploy

Gunakan Node.js 24. Paket `@google/genai` butuh Node 22 ke atas, dan `sharp` butuh Node 20.9 ke atas. Jalankan `npm ci`, `npm run build`, lalu `npm run start:prod`. Isi variabel dari `.env.example` di platform hosting.

**Batas 4,5 MB di Vercel.** Fungsi Vercel menolak body di atas 4,5 MB, sedangkan frontend mengizinkan foto hingga 10 MB. Backend tidak menurunkan batasnya diam-diam.

1. **Disarankan untuk demo: platform Node biasa** seperti Render, Railway, Fly, atau VPS, yang tidak punya batas itu.
2. **Tetap di Vercel:** tim frontend mengompres foto di peramban sebelum unggah. Dimensi yang dilaporkan harus tetap konsisten dengan foto yang tampil.

**Keadaan di memori.** Rate limit dan cache pelafalan hidup per proses, jadi keduanya tidak terbagi antarinstance dan hilang saat restart. Rate limit memakai alamat pertama pada `x-forwarded-for`, sesuai §8. Klien bisa memalsukan header itu bila proxy di depan aplikasi tidak menimpanya, jadi cukup untuk demo tetapi tidak untuk produksi.

## Permintaan ke tim frontend

Backend tidak mengubah UI. Hal berikut perlu dikerjakan di frontend.

1. **Hasil sebagian disebut sampel.** `isLayoutSample` bernilai benar saat `matchesInput` salah, sehingga nama seperti `Café` atau `Warung & Sari` menampilkan "Sampel aksara tetap... bukan alih aksara nama ini" dan "papan memakai sampel tata letak", padahal papan menampilkan hasil alih aksara sebagian. Mohon bedakan `kind: "layout_sample"` dari hasil yang sebagian didukung.
2. **Saran AI tidak terlihat.** `suggestedOptionId` dan `languageGuess` dikirim backend, tetapi belum ditampilkan.
3. **Status layanan lain tidak terlihat.** UI hanya memberi peringatan untuk `quota_exhausted`. Status `timeout` dan `unavailable` juga berarti pengguna hanya melihat opsi aturan.
4. **Kirim ukuran foto dari peramban.** Backend harus menebak apakah peramban menerapkan EXIF, dan jawabannya berbeda per format. Bila frontend mengirim `naturalWidth` dan `naturalHeight` bersama foto, backend bisa memilih orientasi yang sama persis di semua peramban. Ini perlu perubahan kontrak unggahan.
5. **Tampilkan `error.message` dari backend di audit foto, bukan pesan generik.** `requestPhotoAudit` membuang pesan itu dan selalu melempar "Analisis belum berhasil. Foto tetap tersedia untuk dicoba lagi.". Pada satu logo PNG yang sehat, kuota harian habis (429 `QUOTA_EXHAUSTED`) tampil persis seperti kerusakan, sehingga penyebabnya tidak terlihat oleh pengguna maupun tim. Pesan backend sudah berbahasa Indonesia dan aman ditampilkan. Mohon teruskan juga `error.code`, agar UI bisa memberi tindakan yang tepat, misalnya kuota habis, foto terlalu besar, atau layanan belum tersedia.

## TODO verifikasi ahli

Ditandai `TODO(verifikasi-ahli)` di kode bila menyangkut satu aturan tertentu.

1. **Pedoman resmi belum diakses.** Pedoman Badan Pembina Bahasa, Aksara, dan Sastra Bali, *The Balinese Alphabet*, dan kamus Anom dkk. belum terbaca. `SOURCE_REFS` menandainya apa adanya.
2. **Hiatus setelah `i` atau `u`.** `dua` kini menjadi `ᬤᬸᬳ`. Bentuk dengan peluncur seperti `ᬤᬸᬯ` mungkin lebih tepat, tetapi belum ada sumber yang bisa dipastikan.
3. **Vokal awal kata.** §6.3 memakai `ha`, sedangkan r12a menyebut sebagian besar vokal awal memakai aksara suara.
4. **Cecek dan bisah di tengah kata.** §6.3 memakainya di akhir suku kata mana pun, sedangkan r12a menyebut keduanya biasanya hanya di akhir kata, kecuali kata majemuk dan pengulangan.
5. **Diftong.** Notasi selalu membaca `ai` dan `au` sebagai diftong, sehingga `kain`, `daun`, dan `laut` memakai taling repa. Untuk hiatus, pengguna bisa menulis `kahin`.
6. **Konsonan aspirat dan aksara khusus.** `dharma` menjadi `ᬤ᭄ᬳᬃᬫ`, bukan bentuk dengan da madu. Kata seperti ini perlu entri `exceptions.ts` yang bersumber.
7. **Pemisah kata.** Teks Bali tidak memisahkan kata dengan spasi. Spasi U+0020 adalah keputusan tata letak papan nama dan tercatat di `RULES_VERSION`.
8. **`ng` awal kata sebelum konsonan.** `nglawang` ditulis `ᬗ᭄ᬮ`, karena §6.3 tidak mengatur kasus ini.
9. **Tumpukan konsonan.** r12a membatasi konsonan ketiga pada ya, ra, la, wa. Di luar itu mungkin perlu ZWNJ, sedangkan §6.3 hanya mengizinkan blok Bali dan spasi.
10. **Kata majemuk dengan ra repa.** Unicode memberi contoh konsonan + adeg-adeg + ra repa. Notasi tidak bisa menandai batas kata majemuk.

## Sumber yang dipakai

- [Unicode Standard, bab 17](https://www.unicode.org/versions/Unicode18.0.0/core-spec/chapter-17/)
- [r12a, Balinese orthography notes](https://r12a.github.io/scripts/bali/ban)
- [r12a, Balinese character notes](https://r12a.github.io/scripts/bali/ban-details.html)
- [Wikipedia, Balinese script](https://en.wikipedia.org/wiki/Balinese_script)
