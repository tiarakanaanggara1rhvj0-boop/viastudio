# Zombie Apocalypse: Donation Chaos

Paket game pixel 9:16 untuk TikTok LIVE, dashboard admin, simulasi donasi, serta webhook Saweria dan SociaBuzz. Project ini berjalan di Railway dengan Node.js bawaan dan tanpa library tambahan.

## Upload ke GitHub dan deploy ke Railway

1. Unduh ZIP project, ekstrak, lalu unggah **isi folder** ke root repository GitHub. `package.json` dan `server.mjs` harus terlihat di halaman utama repo.
2. Di Railway pilih **New Project → Deploy from GitHub Repo**, lalu pilih repo tadi.
3. Tunggu deploy selesai. Buka **Settings → Networking → Generate Domain** bila domain Railway belum ada.
4. Buka domain Railway. Dashboard ada di `/`, game untuk sumber browser live ada di `/overlay`.
5. Di **Railway → Variables**, tambahkan `SOCIABUZZ_WEBHOOK_TOKEN` dengan token webhook SociaBuzz. Jangan taruh token di GitHub atau kirim ke chat. Setelah perubahan variabel, tunggu service restart/deploy.
6. Di dashboard project, salin **URL Webhook SociaBuzz**. Di SociaBuzz TRIBE → Integrations → Webhook: aktifkan, isi URL tadi, lalu simpan.
7. Kolom **Webhook HTTP Test Response** SociaBuzz dipakai untuk menampilkan hasil tes. Tekan **Test Notifikasi**. Jika berhasil HTTP 200, gunakan tombol simulasi di dashboard untuk memastikan game menerima event; uji payload sungguhan hanya jika tes resmi tidak mengirim event donasi.
8. Untuk live, buka `/overlay` sebagai Browser Source di TikTok LIVE Studio. Dashboard admin dibuka di tab terpisah.

## Variabel Railway

- `SOCIABUZZ_WEBHOOK_TOKEN`: token webhook dari pengaturan SociaBuzz. Server memeriksa token jika SociaBuzz menyertakannya pada header `X-Webhook-Token`, `Webhook-Token`, `Authorization: Bearer ...`, atau field JSON `webhook_token`/`token`.
- `SAWERIA_STREAMING_KEY`: opsional, hanya untuk Saweria. Harus key yang benar menurut dokumentasi Saweria; MediaShare `streamKey` belum dapat diasumsikan sama.
- `PORT`: disediakan Railway otomatis.

SociaBuzz mendokumentasikan pengaturan TRIBE webhook berupa URL, token, dan tombol uji. Format payload/header uji tidak dirinci pada panduan tersebut. Penerima ini mencoba menemukan token yang sama persis di nilai header, query, atau nilai scalar JSON (termasuk awalan Bearer/Token), lalu mengenali beberapa nama umum untuk nominal dan donatur. Jika token tidak ditemukan, Railway Logs hanya mencatat nama header dan field JSON, tanpa nilainya. Format lain masih perlu dicocokkan dengan contoh request nyata.

## Endpoint

- `GET /`: dashboard + game + simulasi
- `GET /overlay`: tampilan vertikal game
- `GET /health`: status server dan jumlah overlay tersambung
- `GET /sociabuzz`: respons teks `OK` untuk pemeriksaan URL
- `POST /sociabuzz` dan `POST /`: menerima callback SociaBuzz jika token valid dan payload berisi nominal. Kedua alamat didukung karena contoh integrasi yang diberikan memakai `POST /`.
- `POST /saweria`: callback Saweria dengan validasi signature resmi

## Keamanan

Token yang sempat terlihat dalam screenshot sebaiknya diganti di SociaBuzz sebelum dipakai. Simpan token baru hanya di Railway Variables dan kolom token pada halaman SociaBuzz. Jangan commit file `.env` atau secret ke GitHub.

## Referensi integrasi

Panduan SociaBuzz TRIBE Webhook: https://sociabuzz.com/blog/info/tribe-webhook/
Dokumentasi Saweria Webhook: https://saweria.co/docs/webhook
