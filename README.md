# KAYA — Financial Tracker

Pencatat keuangan pribadi berbasis **Google Sheets + Google Apps Script**. Datamu tersimpan di Google Sheets milikmu sendiri, tanpa server pihak ketiga. Tampilan mobile-first (bisa dipasang sebagai PWA), bahasa Indonesia.

> Versi: **v1.0.0 (Public Release)** · by Abidzi

## Fitur

- Catat pemasukan dan pengeluaran, transfer antar rekening, kategori dan budget bulanan
- Banyak akun: Aset, E-money, dan Kartu Kredit (tagihan, limit, siklus tagihan)
- Hutang/piutang, tabungan target, cicilan (termasuk cicilan kartu kredit), transaksi berulang + auto-pay
- Investasi (nilai sekarang, modal, jual)
- Split kategori, split bill, dan titipan
- Pencatatan otomatis dari notifikasi iPhone (iPhone Shortcuts + webhook), antrean "Perlu Diperiksa" untuk notifikasi yang tidak pasti
- Sinkron saldo E-Money dari file eChis
- Import transaksi dari file/gambar (OCR)

## Cara pasang (±10 menit)

1. Buat Google Sheet baru, lalu buka **Extensions → Apps Script**.
2. Salin semua file `.js` ke project sebagai file Script (`Code`, `Database`, `Emoney`, `Titip`) dan semua file `.html` sebagai file HTML (`Index`, `JS_Core`, `JS_Logo`, dst). **Nama file harus sama persis** (tanpa ekstensi), karena `Index.html` memanggilnya lewat `include_('JS_Core')` dan seterusnya.
3. Tampilkan `appsscript.json` (Project Settings → *Show "appsscript.json" manifest file*) lalu isi dengan file `appsscript.json` dari repo ini. Pastikan layanan lanjutan **Drive API (v2)** aktif (Services → Drive API), karena dipakai untuk OCR dan sinkron E-Money.
4. Muat ulang Google Sheet. Menu **💰 KAYA** akan muncul. Pilih **Setup Awal**, lalu izinkan akses saat diminta. Setup membuat semua sheet, trigger harian (01:00), dan **token webhook acak** yang ditampilkan sekali di layar.
5. Di editor Apps Script: **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (wajib agar webhook iPhone Shortcuts bisa masuk)
6. Buka URL `/exec` hasil deploy. Itu aplikasimu. Di iPhone: Share → *Add to Home Screen*.

Setelah mengubah kode, deploy ulang lewat **Manage deployments → Edit → New version** agar URL tidak berubah.

### Opsional: bungkus dengan Cloudflare Worker (PWA, nama dan ikon sendiri)

Isi `GAS_URL` di `worker.js` dengan URL `/exec` milikmu, lalu deploy ke Cloudflare Workers. Worker hanya menampilkan aplikasi di dalam iframe dan menyediakan manifest + ikon. Tidak ada logika bisnis atau rahasia di Worker. Atur `UI_SCALE` kalau tampilan terasa terlalu besar atau kecil.

### Opsional: pencatatan otomatis dari notifikasi (iPhone Shortcuts)

Buat Automation tipe *Notification* per aplikasi, lalu aksi *Get Contents of URL*:

- URL: URL `/exec` aplikasimu
- Method: `POST`, Request Body: **JSON**

```json
{
  "token": "<token dari menu KAYA → Lihat Token Webhook>",
  "app": "Gopay",
  "account": "E-Wallet",
  "title": "<Notification Title>",
  "text": "<Notification Body>"
}
```

`account` harus sama dengan nama akun di sheet **Akun**. Notifikasi yang tidak dikenali masuk ke sheet **Log Notifikasi** dan muncul di antrean **Perlu Diperiksa**. Tambahkan kata kunci merchant di sheet **Kata Kunci** supaya kategori terisi otomatis (baris paling atas yang cocok dipakai).

## Keamanan — baca ini

- Web app harus berakses **Anyone** agar webhook bisa masuk. Artinya **siapa pun yang tahu URL `/exec`-mu bisa membuka aplikasi dan melihat datamu**. Jangan bagikan URL itu, jangan unggah ke tempat publik, dan jangan masukkan ke screenshot yang disebar.
- Token webhook disimpan di **Script Properties**, bukan di kode. Jangan bagikan token. Kalau bocor: menu **KAYA → Buat Ulang Token Webhook**, lalu perbarui semua Shortcuts.
- Jangan pernah commit `.clasp.json`, spreadsheet, atau ekspor data keuanganmu ke repo.
- Setiap pengguna memakai Google Sheet, deployment, dan token **miliknya sendiri**. Tidak ada data yang dikirim ke pengembang.

## Logo akun (opsional)

Secara bawaan semua akun memakai ikon Lucide. Untuk memakai logo bank/e-wallet milikmu, isi `JS_LogoSaya.html` (petunjuk ada di dalam file). Logo merek dagang tidak disertakan di repo ini.

## Struktur repo

| File | Fungsi |
|---|---|
| `Code.js` | Backend: `doGet`, `doPost` (webhook), `getData`, CRUD, auto-pay, import, menu |
| `Database.js` | Skema sheet, `initDatabase()`, cache |
| `Emoney.js` | Sinkron saldo E-Money dari file eChis |
| `Titip.js` | Split bill dan titipan |
| `Index.html` + `JS_*.html` | Frontend (HTML, CSS, JavaScript murni) |
| `worker.js` | Cloudflare Worker (opsional) |
| `appsscript.json` | Manifest Apps Script |

## Catatan teknis

- Stack: Apps Script + Google Sheets + JavaScript murni (tanpa framework/build step). Ikon: Lucide (CDN, versi dikunci). Font: Google Fonts.
- Kode membaca sheet berdasarkan **urutan kolom**. Jangan mengubah urutan kolom atau nama sheet secara manual.
- Kategori `Transfer Antar Rekening`, `Pembayaran CC`, dan `Hutang Piutang` tidak dihitung sebagai pemasukan/pengeluaran di statistik.

## Disclaimer

KAYA adalah alat pencatat, bukan nasihat keuangan. Gunakan dengan risiko sendiri (lihat `LICENSE`). Cadangkan Google Sheet-mu secara berkala (File → Make a copy).

## Lisensi

[MIT](LICENSE)
