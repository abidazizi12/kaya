/**
 * ============================================================
 *  * KAYA v1.0.0 (Public Release) - API & BACKEND LOGIC (E-MONEY + WEBHOOK NOTIFIKASI)
 * ============================================================
 * CARA PAKAI:
 * 1. Ganti seluruh isi file Code.gs di project Apps Script dengan isi file ini.
 * 2. Muat ulang spreadsheet, lalu pilih menu KAYA > Setup Awal.
 *    Setup membuat token webhook acak dan menampilkannya SEKALI di layar.
 *    Token disimpan di Script Properties (bukan di kode), jadi aman dibagikan lewat GitHub.
 * 3. Salin token itu ke field "token" di iPhone Shortcuts.
 * 4. Simpan, lalu Deploy > Manage deployments > edit > New version > Deploy.
 *
 * PENGATURAN RAHASIA (Script Properties):
 * - WEBHOOK_TOKEN : dibuat otomatis oleh Setup Awal. Lihat/buat ulang lewat menu KAYA.
 * - GOPAY_VA      : (opsional) nomor BRIVA top-up Gopay milikmu, diisi lewat menu KAYA.
 *
 * PERUBAHAN TERBARU: notifikasi GoPay (merchant, tanpa nominal) + Jago (nominal, tanpa merchant)
 * dipasangkan jadi satu transaksi. Lihat catatSisiJagoGopay_ dan blok "0." di doPost.
 */

// Header sheet "Log Notifikasi". Kolom ID, Status, Akun ditambahkan di akhir (data lama tetap valid).
// Status kosong + Hasil PERIKSA = menunggu validasi di aplikasi; diisi "Dicatat" atau "Bukan transaksi" setelah divalidasi.
const HEADER_LOG = ['Waktu', 'Hasil', 'Alasan', 'App', 'Judul', 'Teks', 'ID', 'Status', 'Akun'];

// Nama akun kartu kredit Tokopedia Card di sheet "Akun" (harus sama persis)
const AKUN_TOKPED_CARD = 'Tokopedia Card';

// Pemetaan 4 digit terakhir rekening tujuan -> nama akun KAYA, khusus rekening MILIKMU sendiri.
// Transfer BRImo ke rekening ini dicatat sebagai transfer antar akun. Rekening lain = pengeluaran.
// Contoh: { '1234': 'BCA' }
const REKENING_SENDIRI = {};

// Batas waktu memasangkan notifikasi QRIS BRImo + Gopay (detik). Selisih normalnya hanya beberapa detik.
const JENDELA_QRIS_DETIK = 60;

// Batas waktu memasangkan notifikasi GoPay (merchant, tanpa nominal) + Jago (nominal, tanpa merchant), dalam detik
const JENDELA_JAGO_DETIK = 120;
// Pembayaran lewat GoPay Tabungan (Jago) memotong saldo akun ini di KAYA
const AKUN_GOPAY_JAGO = 'Gopay';

// ====== PENGATURAN RAHASIA: disimpan di Script Properties, tidak ada di kode ======

function getWebhookToken_() {
  return PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN') || '';
}

// Nomor BRIVA top-up Gopay (opsional). Dipakai untuk mengenali top-up via VA di notifikasi BRImo.
function getGopayVa_() {
  return PropertiesService.getScriptProperties().getProperty('GOPAY_VA') || '';
}

function buatTokenBaru_() {
  const token = 'kaya-' + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('WEBHOOK_TOKEN', token);
  return token;
}

// Pakai token yang sudah ada; kalau belum ada, buat baru
function pastikanTokenWebhook_() {
  return getWebhookToken_() || buatTokenBaru_();
}

// Menu: tampilkan token supaya bisa disalin ke iPhone Shortcuts
function lihatTokenWebhook() {
  const ui = SpreadsheetApp.getUi();
  const token = pastikanTokenWebhook_();
  ui.alert('Token Webhook',
    'Salin token ini ke field "token" di iPhone Shortcuts:\n\n' + token + '\n\nJangan dibagikan ke orang lain.',
    ui.ButtonSet.OK);
}

// Menu: buat token baru (token lama langsung tidak berlaku, Shortcuts harus diperbarui)
function buatUlangTokenWebhook() {
  const ui = SpreadsheetApp.getUi();
  const jawab = ui.alert('Buat ulang token?',
    'Token lama langsung tidak berlaku. Semua iPhone Shortcuts harus diperbarui dengan token baru. Lanjutkan?',
    ui.ButtonSet.YES_NO);
  if (jawab !== ui.Button.YES) return;
  const token = buatTokenBaru_();
  ui.alert('Token baru', 'Salin ke field "token" di iPhone Shortcuts:\n\n' + token, ui.ButtonSet.OK);
}

// Menu: atur nomor BRIVA top-up Gopay (opsional)
function aturGopayVa() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const sekarang = props.getProperty('GOPAY_VA') || '(belum diatur)';
  const r = ui.prompt('BRIVA Top-up Gopay',
    'Masukkan nomor BRIVA top-up Gopay milikmu (angka saja).\nKosongkan lalu tekan OK untuk menghapus.\n\nSaat ini: ' + sekarang,
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const v = String(r.getResponseText() || '').replace(/[^0-9]/g, '');
  if (v) props.setProperty('GOPAY_VA', v); else props.deleteProperty('GOPAY_VA');
  ui.alert(v ? 'Tersimpan.' : 'BRIVA dihapus. Top-up via VA tidak akan dikenali otomatis.');
}

function doGet(e) {
  // Index.html memuat 4 file JavaScript lewat include_ (JS_Core, JS_Halaman, JS_Fitur, JS_Periksa)
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('KAYA — Financial Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // wajib agar bisa dibuka di iframe (workers.dev)
}

// Dipakai oleh Index.html untuk menyisipkan isi file HTML lain (private, tidak bisa dipanggil dari klien)
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ====== WEBHOOK: menerima notifikasi Gopay & BRImo dari iPhone Shortcuts ======
// Prinsip: hanya pola yang dikenali yang dicatat. Selain itu diabaikan (tidak ditebak).
function doPost(e) {
  // ctx: bahan untuk sheet "Log Notifikasi". Log baru aktif setelah token terbukti benar,
  // supaya kiriman asing tidak bisa memenuhi sheet.
  const ctx = { logAktif: false, app: '', akun: '', title: '', text: '' };
  const out = (o) => {
    if (ctx.logAktif && o && o.success === false) catatLogNotif_(o.error, ctx);
    return ContentService.createTextOutput(JSON.stringify(o))
      .setMimeType(ContentService.MimeType.JSON);
  };
  try {
    const body = JSON.parse(e.postData.contents);
    const tokenBenar = getWebhookToken_();
    if (!tokenBenar) return out({ success: false, error: 'token webhook belum diatur (jalankan menu KAYA > Setup Awal)' });
    if (body.token !== tokenBenar) return out({ success: false, error: 'unauthorized' });

    const title = bersihkanNotif_(body.title);
    const text = bersihkanNotif_(body.text);
    ctx.logAktif = true;
    ctx.app = String(body.app || body.account || '');
    ctx.akun = String(body.account || '');
    ctx.title = title;
    ctx.text = text;
    // PERBAIKAN: 'all' harus dideklarasikan SEBELUM dipakai (sebelumnya memicu ReferenceError)
    const all = (title + ' ' + text).trim();
    if (!all) return out({ success: false, error: 'teks notifikasi kosong (uji manual?), diabaikan' });
    const cache = CacheService.getScriptCache();
    const abaikan = (alasan) => out({ success: false, error: alasan });

    // ---- A. BRImo (uang KELUAR dari BRI) ----
    if (/brimo/i.test(String(body.app || '')) || /^brimo$/i.test(title)) {
      if (!/berhasil/i.test(text)) return abaikan('BRImo: bukan transaksi berhasil, diabaikan');
      const nominal = ambilNominal_(text);
      if (!nominal) return out({ success: false, error: 'nominal tidak ditemukan', text: text });

      const mVa = text.match(/BRIVA\s+(\d{8,})/i);
      // Top-up Gopay lewat VA milikmu (diatur lewat menu KAYA > Atur BRIVA Gopay) = transfer BRI -> Gopay
      const gopayVa = getGopayVa_();
      if (mVa && gopayVa && mVa[1] === gopayVa) {
        return out(catatTransferNotif_('BRI', 'Gopay', nominal, 'Top-up via VA', 'topup'));
      }
      // Transfer dari BRI ke rekening lain: "Transfer dari XXXX3507 dengan nomor rekening tujuan XXXX0509 sebesar Rp31.000,00 BERHASIL"
      const mTf = text.match(/Transfer\s+dari\s+\S+\s+dengan\s+nomor\s+rekening\s+tujuan\s+(\S+)/i);
      if (mTf) {
        const tujuan = mTf[1];
        const akunSendiri = REKENING_SENDIRI[tujuan.slice(-4)];
        if (akunSendiri && akunSendiri !== 'BRI') {
          return out(catatTransferNotif_('BRI', akunSendiri, nominal, 'Transfer via BRImo', 'tfbri'));
        }
        const kTf = ['notif', 'tfbri', tujuan, nominal].join('|');
        if (cache.get(kTf)) return abaikan('duplikat');
        cache.put(kTf, '1', 120);
        const descTf = 'Transfer BRImo ke rekening ...' + tujuan.slice(-4);
        catatNotifTx_(descTf, 'Lainnya', 'Keluar', nominal, 'BRI');
        return out({ success: true, desc: descTf, amount: nominal, category: 'Lainnya' });
      }
      // Belanja QRIS dari BRI: dipasangkan dengan "QRIS diterima" Gopay
      if (/pembelian\s+QRIS/i.test(text)) {
        return out(catatQrisSisi_('bri', nominal, 'Belanja QRIS (BRImo)', 'Lainnya', 'BRI'));
      }
      // BRIVA ke pihak lain = pengeluaran biasa
      if (mVa) {
        const k = ['notif', 'briva', mVa[1], nominal].join('|');
        if (cache.get(k)) return abaikan('duplikat');
        cache.put(k, '1', 120);
        const descVa = 'Pembayaran BRIVA ' + mVa[1];
        catatNotifTx_(descVa, 'Lainnya', 'Keluar', nominal, 'BRI');
        return out({ success: true, desc: descVa, amount: nominal, category: 'Lainnya' });
      }
      return abaikan('BRImo: format tidak dikenali');
    }

    // ---- A2. Tokopedia Card (kartu kredit BRI) ----
    // Hanya notifikasi transaksi KARTU yang dicatat (Keluar di akun kartu kredit = tagihan naik).
    // Notifikasi pesanan/promo Tokopedia diabaikan supaya belanja tidak tercatat dobel.
    if (/tokopedia/i.test(String(body.app || ''))) {
      const mTc = text.match(/transaksi\s+pakai\s+Tokopedia\s+Card.*?senilai\s+Rp\.?\s?([\d.]+(?:,\d+)?)\s+di\s+(.+?)\s+pada\s+(\d{1,2})\/(\d{1,2})/i);
      if (!mTc) {
        if (/tokopedia\s+card|kartu\s+kredit/i.test(all)) return out({ success: false, error: 'format Tokopedia Card tidak dikenali', text: text });
        return abaikan('Tokopedia: bukan transaksi kartu (pesanan/promo), diabaikan');
      }
      const nominalT = Number(mTc[1].replace(/\./g, '').replace(',', '.'));
      if (!nominalT || nominalT <= 0) return out({ success: false, error: 'nominal tidak valid' });
      const descT = mTc[2].trim();
      const akunT = body.account || AKUN_TOKPED_CARD;

      // Notifikasi hanya memuat hari/bulan. Tahun diambil dari hari ini (WIB); kalau hasilnya
      // lebih dari 2 hari ke depan (mis. transaksi Desember, notifikasi Januari), pakai tahun lalu.
      const sekarang = new Date();
      const tahun = Number(Utilities.formatDate(sekarang, 'GMT+7', 'yyyy'));
      let tgl = new Date(Date.UTC(tahun, Number(mTc[4]) - 1, Number(mTc[3])));
      if (tgl.getTime() > sekarang.getTime() + 2 * 86400000) tgl = new Date(Date.UTC(tahun - 1, Number(mTc[4]) - 1, Number(mTc[3])));
      const tanggalT = Utilities.formatDate(tgl, 'UTC', 'yyyy-MM-dd');

      const kT = ['notif', akunT, nominalT, descT].join('|').slice(0, 240);
      if (cache.get(kT)) return abaikan('duplikat');
      cache.put(kT, '1', 120);

      const catT = categorizeValid_(descT);
      catatNotifTx_(descT, catT, 'Keluar', nominalT, akunT, tanggalT);
      return out({ success: true, desc: descT, amount: nominalT, category: catT, date: tanggalT });
    }

    // ---- B. Gopay ----
    const account = body.account || 'Gopay';

    // 0. Pasangan notifikasi: Jago ("You've paid Rp... with GoPay", ada nominal tanpa merchant)
    //    + GoPay ("berhasil membayar transaksimu di X", ada merchant tanpa nominal).
    //    Harus dicek SEBELUM aturan "notifikasi aplikasi Jago" di bawah supaya tidak keburu diabaikan.
    const mJago = all.match(/you'?ve\s+paid\s+Rp\.?\s?([\d.]+(?:,\d+)?)\s+with\s+GoPay/i);
    if (mJago) {
      const nomJ = Number(mJago[1].replace(/\./g, '').replace(',', '.'));
      if (!nomJ || nomJ <= 0) return out({ success: false, error: 'nominal tidak valid' });
      return out(catatSisiJagoGopay_('jago', nomJ, ctx));
    }
    const mGp = text.match(/berhasil\s+membayar\s+transaksimu\s+di\s+(.+?)(?:\s+-\s+gopay)?\s*[!.]?$/i);
    if (mGp && !/Rp\.?\s?\d/i.test(text)) {
      return out(catatSisiJagoGopay_('gopay', mGp[1].trim(), ctx));
    }

    // 1. Notifikasi non-uang / perantara / aplikasi Jago
    if (/lagi\s+memproses\s+pengiriman|berhasil\s+transfer\s+ke\s+TABUNGAN\s+BY\s+JAGO|BRI\s+Virtual\s+Account/i.test(all)) {
      return abaikan('notifikasi perantara top-up, diabaikan');
    }
    if (/you'?ve\s+received|tanya\s+jago/i.test(all)) return abaikan('notifikasi aplikasi Jago, diabaikan');
    if (/gopay\s+coins/i.test(all) && !/bayar/i.test(all)) return abaikan('notifikasi coins, diabaikan');

    // 2. QRIS diterima: Masuk ke Gopay, dipasangkan dengan "Pembelian QRIS" BRImo
    const isQris = /qris.*dite/i.test(all) || (!title && /^Rp\.?\s?[\d.,]+\s+di\s+\S/i.test(text));
    if (isQris) {
      const nominalQ = ambilNominal_(text);
      if (!nominalQ) return out({ success: false, error: 'nominal tidak ditemukan', text: text });
      const mDi = text.match(/\sdi\s+(.+?)\.?$/i);
      const descQ = 'QRIS diterima' + (mDi ? ': ' + mDi[1] : '');
      return out(catatQrisSisi_('gopay', nominalQ, descQ, 'Penghasilan Lain', account));
    }

    // 3. Saldo masuk Gopay (jejak internal): dicatat dari notifikasi sumbernya (BRImo / QRIS)
    if (/menerima\s+GoPay\s+sebanyak|menerima\s+Tabungan\s+by\s+Jago/i.test(all)) {
      return abaikan('saldo masuk Gopay: dicatat dari BRImo/QRIS, diabaikan');
    }

    // 4. Pencairan dana: Jago bagian dari Gopay, jadi umumnya pindah saldo internal.
    //    Hanya dicatat kalau teksnya menyebut nama akun lain di KAYA.
    if (/pencairan\s+dana/i.test(all)) {
      const tujuan = deteksiAkunDariTeks_(text, account);
      if (!tujuan) return abaikan('pencairan dana = pindah saldo internal Gopay, diabaikan');
      if (!/berhasil|selesai/i.test(all)) return abaikan('pencairan belum berhasil, diabaikan');
      return out(catatTransferNotif_(account, tujuan, ambilNominal_(text), 'Pencairan dana', 'pencairan'));
    }

    // 5. Pembayaran: "...bayar Rp12.000 ke X." atau "...bayar Rp37.000 ke X pake GoPay Tabungan by Jago."
    let amount, desc;
    const m = text.match(/bayar\s+Rp\.?\s?([\d.]+(?:,\d+)?)\s+ke\s+(.+?)(?:\s+pake\s+.+?)?\.?$/i);
    if (m) {
      amount = Number(m[1].replace(/\./g, '').replace(',', '.'));
      desc = m[2].trim();
    } else if (adalahPromo_(all)) {
      // Promo/info (check-in, klaim hadiah, bonus, dst.) = pasti bukan transaksi
      return abaikan('notifikasi promo/info, diabaikan');
    } else if (/\b(bayar|pembayaran|dibayar)\b/i.test(all) && !/terima|menerima|pencairan|refund|dikembalikan/i.test(all)) {
      // Cadangan terbatas: hanya jika jelas kata "bayar", dan bukan notifikasi penerimaan
      amount = ambilNominal_(text);
      desc = text.slice(0, 60);
    } else {
      // Tanpa nominal "Rp<angka>" = promo/info biasa, bukan transaksi
      if (!/Rp\.?\s?\d/i.test(text)) return abaikan('tanpa nominal, bukan transaksi, diabaikan');
      return out({ success: false, error: 'format notifikasi tidak dikenali', text: text });
    }
    if (!amount || amount <= 0) return out({ success: false, error: 'nominal tidak valid' });

    // Notifikasi "Pembayaran" selalu pengeluaran. Masuk hanya jika Shortcuts mengirim type = Masuk.
    const type = body.type === 'Masuk' ? 'Masuk' : 'Keluar';

    // Cegah kiriman ganda dalam 2 menit
    const key = ['notif', account, amount, desc].join('|').slice(0, 240);
    if (cache.get(key)) return abaikan('duplikat');
    cache.put(key, '1', 120);

    // Kategori: kalau tidak ketemu, otomatis "Lainnya" (tetap tercatat)
    const category = type === 'Masuk' ? 'Penghasilan Lain' : categorizeValid_(desc);
    catatNotifTx_(desc, category, type, amount, account);
    // Tandai nominal ini sudah tercatat, supaya notifikasi Jago untuk transaksi yang sama tidak dicatat dobel
    if (type === 'Keluar') tandaiBayarBernominal_(amount);
    return out({ success: true, desc: desc, amount: amount, category: category });
  } catch (err) {
    return out({ success: false, error: String(err) });
  }
}

// Bersihkan entity HTML (&amp; dst.) dan spasi ganda dari teks notifikasi
function bersihkanNotif_(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}

// Notifikasi promo/info (check-in, klaim hadiah, bonus, dst.) = pasti bukan transaksi.
// Hanya dicek kalau pola "bayar Rp... ke ..." TIDAK cocok, jadi pembayaran asli tidak ikut terabaikan.
function adalahPromo_(all) {
  return /check[\s-]?in|klaim|hadiah|bonus|cashback|voucher|promo|diskon|gratis|S&K|paket\s+data|aktifkan|ambil\s+coins|dapetin|jangan\s+sampai|beli\s+sekarang/i.test(String(all || ''));
}

// Catat notifikasi yang tidak menghasilkan transaksi ke sheet "Log Notifikasi".
// Hasil: PERIKSA = format tidak dikenali / error (perlu ditambah pola), Diabaikan = sengaja diabaikan,
// Duplikat = kiriman ganda. Sheet dibuat otomatis. Kegagalan log tidak boleh mengganggu webhook.
// Mengembalikan ID baris log (dipakai untuk menandai baris saat pasangan notifikasi datang), '' jika gagal.
function catatLogNotif_(alasan, ctx) {
  try {
    const alasanStr = String(alasan || '');
    const hasil = /duplikat/i.test(alasanStr) ? 'Duplikat' : (/diabaikan/i.test(alasanStr) ? 'Diabaikan' : 'PERIKSA');
    const sh = siapkanSheetLog_();
    const idLog = Utilities.getUuid();
    sh.appendRow([
      Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss'),
      hasil,
      alasanStr.slice(0, 200),
      String(ctx.app || '').slice(0, 50),
      String(ctx.title || '').slice(0, 200),
      String(ctx.text || '').slice(0, 500),
      idLog,
      '',
      String(ctx.akun || '').slice(0, 50)
    ]);
    // Jaga ukuran sheet: buang 200 baris terlama jika lebih dari 1000 baris
    if (sh.getLastRow() > 1000) sh.deleteRows(2, 200);
    return idLog;
  } catch (err) { return ''; }
}

// ====== ANTREAN "PERLU DIPERIKSA": notifikasi berstatus PERIKSA yang divalidasi dari aplikasi ======

// Ambil sheet "Log Notifikasi"; buat jika belum ada, lengkapi header jika masih versi lama (6 kolom).
function siapkanSheetLog_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Log Notifikasi');
  if (!sh) {
    sh = ss.insertSheet('Log Notifikasi');
    sh.appendRow(HEADER_LOG);
    sh.setFrozenRows(1);
    return sh;
  }
  if (sh.getLastColumn() < HEADER_LOG.length) {
    sh.getRange(1, 1, 1, HEADER_LOG.length).setValues([HEADER_LOG]);
  }
  return sh;
}

// Waktu di sheet bisa terbaca sebagai Date; ubah ke teks (Date tidak bisa dikirim ke klien).
function formatWaktuLog_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+7', 'yyyy-MM-dd HH:mm:ss');
  return String(v || '');
}

function cariBarisLog_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 7, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

// Tandai satu baris Log Notifikasi (kolom Status) berdasarkan ID log. Kegagalan diabaikan.
function tandaiLogById_(idLog, status) {
  try {
    if (!idLog) return;
    const sh = siapkanSheetLog_();
    const row = cariBarisLog_(sh, idLog);
    if (row) sh.getRange(row, 8).setValue(status);
  } catch (err) {}
}

// Tebakan isian form dari teks notifikasi. Hanya saran; pengguna yang memutuskan.
function saranDariLog_(r) {
  const text = String(r[5] || '');
  const app = String(r[3] || '');
  const waktu = formatWaktuLog_(r[0]);
  let akun = String(r[8] || '');
  if (!akun) {
    if (/brimo/i.test(app)) akun = 'BRI';
    else if (/tokopedia/i.test(app)) akun = AKUN_TOKPED_CARD;
    else akun = app || 'Gopay';
  }
  const type = /terima|menerima|diterima|refund|dikembalikan|masuk/i.test(text) ? 'Masuk' : 'Keluar';
  // Keterangan: pakai nama merchant kalau polanya "bayar Rp... ke X", selain itu 60 karakter pertama
  let desc = text.slice(0, 60);
  const mB = text.match(/bayar\s+Rp\.?\s?[\d.]+(?:,\d+)?\s+ke\s+(.+?)(?:\s+pake\s+.+?)?\.?$/i);
  if (mB) desc = mB[1].trim();
  return {
    date: waktu.slice(0, 10),
    desc: desc,
    category: type === 'Masuk' ? 'Penghasilan Lain' : categorizeValid_(desc),
    type: type,
    amount: ambilNominal_(text),
    account: akun
  };
}

// Daftar notifikasi yang menunggu validasi (terbaru di atas). Dipanggil dari aplikasi.
function getLogPeriksa() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = siapkanSheetLog_();
    const last = sh.getLastRow();
    if (last < 2) return { success: true, items: [] };
    const rows = sh.getRange(2, 1, last - 1, HEADER_LOG.length).getValues();
    const items = [];
    rows.forEach((r, i) => {
      if (r[1] !== 'PERIKSA' || r[7]) return; // hanya PERIKSA yang belum divalidasi
      if (!r[6]) { // baris log lama belum punya ID
        r[6] = Utilities.getUuid();
        sh.getRange(i + 2, 7).setValue(r[6]);
      }
      items.push({
        id: String(r[6]),
        time: formatWaktuLog_(r[0]),
        reason: String(r[2] || ''),
        app: String(r[3] || ''),
        title: String(r[4] || ''),
        text: String(r[5] || ''),
        suggestion: saranDariLog_(r)
      });
    });
    return { success: true, items: items.reverse() };
  } finally {
    lock.releaseLock();
  }
}

// Pengguna menyatakan "ini transaksi": catat ke Transaksi (Sumber = Notifikasi) lalu tandai log "Dicatat".
// tx: { date, desc, category, type, amount, account } dari form validasi.
function validasiLogNotif(id, tx) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = siapkanSheetLog_();
    const row = cariBarisLog_(sh, id);
    if (!row) return { success: false, error: 'Log tidak ditemukan' };
    if (sh.getRange(row, 8).getValue()) return { success: false, error: 'Notifikasi ini sudah divalidasi' };

    const amount = Number(tx && tx.amount);
    if (!tx || !tx.date || !tx.desc || !tx.category || !tx.account || !(amount > 0) ||
        (tx.type !== 'Masuk' && tx.type !== 'Keluar')) {
      return { success: false, error: 'Data transaksi belum lengkap' };
    }
    const txSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
    const idTx = Utilities.getUuid();
    txSh.appendRow([idTx, tx.date, tx.desc, tx.category, tx.type, amount, 'Notifikasi', tx.account]);
    sh.getRange(row, 8).setValue('Dicatat');
    clearCache();
    return { success: true, id: idTx };
  } finally {
    lock.releaseLock();
  }
}

// Pengguna menyatakan "bukan transaksi": tandai log, tidak mencatat apa pun.
function abaikanLogNotif(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = siapkanSheetLog_();
    const row = cariBarisLog_(sh, id);
    if (!row) return { success: false, error: 'Log tidak ditemukan' };
    if (sh.getRange(row, 8).getValue()) return { success: false, error: 'Notifikasi ini sudah divalidasi' };
    sh.getRange(row, 8).setValue('Bukan transaksi');
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// Tulis satu transaksi dari notifikasi (Sumber = Notifikasi), bersihkan cache, kembalikan ID barisnya
function catatNotifTx_(desc, category, type, amount, account, tanggal) {
  const date = tanggal || Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
  const id = Utilities.getUuid();
  sh.appendRow([id, date, desc, category, type, amount, 'Notifikasi', account]);
  clearCache();
  return id;
}

// Cari nomor baris (1-based) di sheet Transaksi berdasarkan ID. Mengembalikan 0 jika tidak ada.
function cariBarisById_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

// Pasangkan notifikasi QRIS dari 2 aplikasi.
// sisi 'bri'   = BRImo "Pembelian QRIS"  -> Keluar dari BRI
// sisi 'gopay' = Gopay "QRIS diterima"   -> Masuk ke Gopay
// Datang pertama: dicatat biasa + ditandai di cache.
// Datang kedua dengan nominal sama (dalam JENDELA_QRIS_DETIK): baris pertama diubah jadi
// Transfer Antar Rekening dan baris pasangannya ditambahkan.
function catatQrisSisi_(sisi, amount, desc, kategori, akun) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000); // dua notifikasi bisa tiba hampir bersamaan
  try {
    const cache = CacheService.getScriptCache();
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
    const tipe = sisi === 'bri' ? 'Keluar' : 'Masuk';
    const lawan = sisi === 'bri' ? 'gopay' : 'bri';

    // Cegah kiriman ganda dari notifikasi yang sama
    const keyDup = 'qrisdup|' + sisi + '|' + amount;
    if (cache.get(keyDup)) return { success: false, error: 'duplikat' };
    cache.put(keyDup, '1', 120);

    const keyLawan = 'qris|' + lawan + '|' + amount;
    const idLawan = cache.get(keyLawan);
    const rowLawan = idLawan ? cariBarisById_(sh, idLawan) : 0;

    if (rowLawan) {
      cache.remove(keyLawan);
      const akunLawan = String(sh.getRange(rowLawan, 8).getValue());
      const akunBri = sisi === 'bri' ? akun : akunLawan;
      const akunGopay = sisi === 'bri' ? akunLawan : akun;
      const cat = 'Transfer Antar Rekening';
      const descKeluar = 'Transfer ke ' + akunGopay + ' - Top-up via QRIS';
      const descMasuk = 'Transfer dari ' + akunBri + ' - Top-up via QRIS';
      const date = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');

      // Baris yang sudah ada -> jadi transfer (tipe, nominal, akun tetap)
      sh.getRange(rowLawan, 3, 1, 2).setValues([[sisi === 'bri' ? descMasuk : descKeluar, cat]]);
      // Baris pasangan
      sh.appendRow([Utilities.getUuid(), date, sisi === 'bri' ? descKeluar : descMasuk, cat, tipe, amount, 'Notifikasi', akun]);
      clearCache();
      return { success: true, status: 'dipasangkan jadi transfer', amount: amount };
    }

    // Belum ada pasangan: catat biasa dan tunggu
    const id = catatNotifTx_(desc, kategori, tipe, amount, akun);
    cache.put('qris|' + sisi + '|' + amount, id, JENDELA_QRIS_DETIK);
    return { success: true, status: 'menunggu pasangan', desc: desc, amount: amount, category: kategori };
  } finally {
    lock.releaseLock();
  }
}

// Pasangkan notifikasi Jago + GoPay untuk pembayaran lewat GoPay Tabungan.
// sisi 'jago'  : isi = nominal (angka)  -> dari "You've paid Rp... with GoPay Tabungan Transaction"
// sisi 'gopay' : isi = nama merchant    -> dari "kamu berhasil membayar transaksimu di X - gopay!"
// Sisi pertama disimpan di cache + dicatat di Log Notifikasi (PERIKSA) sebagai cadangan.
// Kalau sisi lawan datang dalam JENDELA_JAGO_DETIK: dicatat 1 transaksi Keluar (akun AKUN_GOPAY_JAGO)
// dan log cadangan ditandai "Dicatat". Kalau pasangan tidak pernah datang, baris tetap di antrean
// "Perlu Diperiksa" supaya bisa dicatat manual.
function catatSisiJagoGopay_(sisi, isi, ctx) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000); // dua notifikasi bisa tiba hampir bersamaan
  try {
    const cache = CacheService.getScriptCache();
    const lawan = sisi === 'gopay' ? 'jago' : 'gopay';

    // Cegah kiriman ganda dari notifikasi yang sama
    const keyDup = ('jgdup|' + sisi + '|' + isi).slice(0, 240);
    if (cache.get(keyDup)) return { success: false, error: 'duplikat' };
    cache.put(keyDup, '1', JENDELA_JAGO_DETIK);

    // Jago untuk pembayaran yang sudah tercatat dari notifikasi GoPay bernominal = abaikan
    if (sisi === 'jago' && cache.get('jgamt|' + isi)) {
      return { success: false, error: 'Jago: pembayaran sudah tercatat dari notifikasi GoPay, diabaikan' };
    }

    const raw = cache.get('jgpend|' + lawan);
    if (raw) {
      const p = JSON.parse(raw);
      cache.remove('jgpend|' + lawan);
      const merchant = sisi === 'gopay' ? String(isi) : String(p.isi);
      const nominal = sisi === 'jago' ? Number(isi) : Number(p.isi);
      const cat = categorizeValid_(merchant);
      catatNotifTx_(merchant, cat, 'Keluar', nominal, AKUN_GOPAY_JAGO);
      tandaiLogById_(p.logId, 'Dicatat');
      return { success: true, status: 'dipasangkan Jago + GoPay', desc: merchant, amount: nominal, category: cat };
    }

    // Belum ada pasangan: simpan di cache dan catat di log sebagai cadangan
    const ket = sisi === 'gopay'
      ? 'GoPay tanpa nominal, menunggu notifikasi Jago'
      : 'Jago tanpa merchant, menunggu notifikasi GoPay';
    const logId = catatLogNotif_(ket, ctx);
    cache.put('jgpend|' + sisi, JSON.stringify({ isi: isi, logId: logId }), JENDELA_JAGO_DETIK);
    return { success: true, status: 'menunggu pasangan' };
  } finally {
    lock.releaseLock();
  }
}

// Dipanggil setelah pembayaran GoPay bernominal dicatat: tandai nominalnya supaya notifikasi Jago
// untuk transaksi yang sama tidak dicatat dua kali (baik datang sesudah maupun sebelumnya).
function tandaiBayarBernominal_(amount) {
  try {
    const cache = CacheService.getScriptCache();
    cache.put('jgamt|' + amount, '1', JENDELA_JAGO_DETIK);
    const raw = cache.get('jgpend|jago');
    if (raw) {
      const p = JSON.parse(raw);
      if (Number(p.isi) === Number(amount)) {
        cache.remove('jgpend|jago');
        tandaiLogById_(p.logId, 'Duplikat');
      }
    }
  } catch (err) {}
}

// Ambil nominal pertama "Rp..." dari teks. Mengembalikan 0 jika tidak ada.
function ambilNominal_(text) {
  const g = String(text || '').match(/Rp\.?\s?([\d.]+(?:,\d+)?)/i);
  if (!g) return 0;
  return Number(g[1].replace(/\./g, '').replace(',', '.')) || 0;
}

// Helper bersama: catat transfer 2 baris dari notifikasi
// (Keluar dari akun asal, Masuk ke akun tujuan), kategori Transfer Antar Rekening.
function catatTransferNotif_(from, to, amount, ket, keyPrefix) {
  if (!amount || amount <= 0) return { success: false, error: 'nominal tidak valid' };
  if (!from || !to || from === to) return { success: false, error: 'akun asal dan tujuan sama' };

  // Cegah kiriman ganda dalam 2 menit
  const cache = CacheService.getScriptCache();
  const key = [keyPrefix, from, to, amount].join('|').slice(0, 240);
  if (cache.get(key)) return { success: false, error: 'duplikat' };
  cache.put(key, '1', 120);

  const date = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
  const rows = [
    [Utilities.getUuid(), date, 'Transfer ke ' + to + ' - ' + ket, 'Transfer Antar Rekening', 'Keluar', amount, 'Notifikasi', from],
    [Utilities.getUuid(), date, 'Transfer dari ' + from + ' - ' + ket, 'Transfer Antar Rekening', 'Masuk', amount, 'Notifikasi', to]
  ];
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  clearCache();
  return { success: true, jenis: ket, from: from, to: to, amount: amount };
}

// (Tidak dipanggil lagi oleh doPost; dibiarkan agar tidak ada referensi yang putus)
// Top-up Gopay dari BRI lewat VA: BRI (Keluar) -> Gopay (Masuk).
function catatTopupBRI_(body, text) {
  const amount = ambilNominal_(text);
  if (!amount) return { success: false, error: 'nominal tidak ditemukan', text: text };
  const from = body.fromAccount || 'BRI';
  const to = body.account || 'Gopay';
  return catatTransferNotif_(from, to, amount, 'Top-up via VA', 'topup');
}

// (Tidak dipanggil lagi oleh doPost; dibiarkan agar tidak ada referensi yang putus)
// Notifikasi "Pencairan dana berhasil": transfer dari akun sumber ke rekening tujuan.
function catatPencairanDana_(body, text) {
  const amount = ambilNominal_(text);
  if (!amount) return { success: false, error: 'nominal tidak ditemukan', text: text };
  const from = body.account || 'Gopay';
  // Tujuan: nama akun yang disebut di teks > field toAccount dari Shortcuts > BRI
  const to = deteksiAkunDariTeks_(text, from) || body.toAccount || 'BRI';
  return catatTransferNotif_(from, to, amount, 'Pencairan dana', 'pencairan');
}

// Cari nama akun (non-Kredit, selain akun sumber) yang disebut di teks notifikasi.
// Nama terpanjang dicek dulu supaya tidak salah cocok.
function deteksiAkunDariTeks_(text, excludeName) {
  const lower = String(text || '').toLowerCase();
  const names = getSheetData('Akun')
    .filter(r => r[0] && String(r[2] || '') !== 'Kredit' && String(r[0]) !== String(excludeName))
    .map(r => String(r[0]))
    .sort((a, b) => b.length - a.length);
  for (let i = 0; i < names.length; i++) {
    if (lower.indexOf(names[i].toLowerCase()) !== -1) return names[i];
  }
  return '';
}

// Cari kategori dari sheet "Kata Kunci". Hanya kategori yang benar-benar ada di
// sheet "Kategori" yang dipakai; selain itu jatuh ke "Lainnya".
function categorizeValid_(desc) {
  const validNames = {};
  getSheetData('Kategori').forEach(r => { if (r[1]) validNames[String(r[1])] = true; });
  const text = String(desc || '').toLowerCase();
  const kw = getSheetData('Kata Kunci');
  for (let i = 0; i < kw.length; i++) {
    const k = String(kw[i][0] || '').toLowerCase().trim();
    const cat = String(kw[i][1] || '').trim();
    if (k && validNames[cat] && text.indexOf(k) !== -1) return cat;
  }
  return 'Lainnya';
}

// Jalankan SEKALI dari editor (pilih fungsi ini lalu klik Run) untuk mengganti
// isi sheet "Kata Kunci" dengan daftar baru yang kategorinya sesuai sheet "Kategori".
// Urutan penting: kata kunci yang lebih dulu cocok akan dipakai.
// PERINGATAN: fungsi ini MENIMPA seluruh isi sheet "Kata Kunci".
function perbaikiKataKunci() {
  const map = {
    'Minuman': ['es kelapa','kelapa','es teh','es jeruk','es campur','es krim','jus','kopi','kenangan','starbucks','janji jiwa','tomoro',
                'teh','teazzi','boost','cranberry','air mineral','aqua','le minerale','minum','whipcream','yogurt','susu','chatime','mixue'],
    'Makanan': ['gofood','grabfood','shopeefood','nasi','nasduk','nasgor','warteg','warung','ketoprak','bubur','mie','bakmi','soto','sate','ayam',
                'geprek','geperek','bakso','batagor','siomay','cilok','cilor','mendoan','tahu','tempe','kripik','kerupuk','snack','roti','donat',
                'pukis','martabak','seblak','gorengan','coto','yamin','karage','fried chicken','chicken','burger','pizza','kfc','mcd',
                'mcdonald','hokben','richeese','dunkin','pecel','gado','lontong','kupat','padang','resto','restoran','cafe','makan',
                'alfamart','alfa','indomaret','family mart','familymart','lawson','circle k'],
    'Transportasi': ['spbu','pertamina','pertalite','pertamax','bensin','shell','parkir','tol','e-money','emoney','tapcash','gojek','goride','gocar',
                     'grab','maxim','indrive','transjakarta','mrt','krl','commuter','kereta api','kai access','cuci motor','cuci mobil','bengkel'],
    'Tagihan & Utilitas': ['pln','listrik','token','indihome','wifi','pdam','pulsa','telkomsel','indosat','xl axiata','paket data','bpjs'],
    'Kesehatan': ['apotek','kimia farma','guardian','century','klinik','dokter','rumah sakit','rsud','rsia','obat','vitamin','magnesium','selsun',
                  'cukur','barber','potong rambut','salon'],
    'Rumah Tangga': ['laundry','galon','sabun','deterjen','gas elpiji','elpiji','tisu'],
    'Donasi': ['masjid','kotak amal','amal','infaq','sedekah','zakat','takziah','donasi'],
    'Hadiah': ['kado','hadiah','wedding','kondangan','angpao'],
    'Langganan': ['netflix','spotify','youtube','disney','vidio','icloud','google one','apple.com'],
    'Hiburan': ['bioskop','cgv','xxi','steam','game','konser','tiket wahana'],
    'Perjalanan': ['hotel','tiket pesawat','tiket kereta','traveloka','tiket.com','tiketcom','agoda','airbnb','bandara'],
    'Pendidikan': ['sekolah','kursus','kuliah','buku','udemy','coursera'],
    'Biaya Bank': ['biaya admin','admin fee','e-statement','e-statment','materai'],
    'Belanja': ['tokopedia','shopee','lazada','blibli','tiktok shop','toko','resleting','sol sepatu','laundry bag','casing','bunga','baju'],
    'Gaji': ['gaji','payroll'],
    'Bonus': ['bonus','thr']
  };
  const rows = [];
  Object.keys(map).forEach(cat => map[cat].forEach(k => rows.push([k, cat])));

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Kata Kunci');
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, Math.max(2, sh.getLastColumn())).clearContent();
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  clearCache();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💰 KAYA')
    .addItem('🛠️ Setup Awal (jalankan pertama kali)', 'setupAwal')
    .addItem('⚙️ Paksa Proses Cicilan/Berulang Sekarang', 'processRecurringTransactions')
    .addItem('🌐 Buka Web App', 'showWebAppUrl_')
    .addSeparator()
    .addItem('Lihat Token Webhook', 'lihatTokenWebhook')
    .addItem('Buat Ulang Token Webhook', 'buatUlangTokenWebhook')
    .addItem('Atur BRIVA Gopay (opsional)', 'aturGopayVa')
    .addToUi();
}

function setupAwal() {
  initDatabase();
  ensureRecurringTrigger_();
  const token = pastikanTokenWebhook_();
  SpreadsheetApp.getUi().alert('Setup selesai!\n\n' +
    'Token webhook kamu (salin ke field "token" di iPhone Shortcuts):\n' + token + '\n\n' +
    'Token bisa dilihat lagi lewat menu KAYA > Lihat Token Webhook.\n\n' +
    'Untuk membuka aplikasi: Extensions > Apps Script, lalu Deploy > New deployment > Web app.');
}

function showWebAppUrl_() {
  SpreadsheetApp.getUi().alert('Buka menu: Extensions > Apps Script.\nLalu klik tombol "Deploy" di sudut kanan atas > "Manage deployments", klik URL yang ada di bawah tulisan "Web app".');
}

function ensureRecurringTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processRecurringTransactions') {
       ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('processRecurringTransactions').timeBased().everyDays(1).atHour(1).create();
}

function getData() {
  const cache = CacheService.getUserCache();
  const cachedData = cache.get(CACHE_KEY);
  if (cachedData) return JSON.parse(cachedData);

  const txData = getSheetData('Transaksi');
  const catData = getSheetData('Kategori');
  const groupData = getSheetData('Budget Grup');
  const kwData = getSheetData('Kata Kunci');
  const accData = getSheetData('Akun');
  const hutangData = getSheetData('Hutang Piutang');
  const tabData = getSheetData('Tabungan');
  const berulangData = getSheetData('Transaksi Berulang');
  const cicilanData = getSheetData('Cicilan');
  const invData = getSheetData('Investasi');

  const payload = {
    transactions: txData.map(r => ({ id: String(r[0]), date: formatDateForClient_(r[1]), desc: r[2], category: r[3], type: r[4], amount: r[5], account: r[7] || 'Tunai'})).filter(t => t.id),
    categories: catData.filter(r => r[1]).map(r => ({ group: r[0] || 'LAINNYA', name: r[1], budget: r[2] || 0 })),
    groupBudgets: Object.fromEntries(groupData.filter(r => r[0]).map(r => [r[0], Number(r[1]) || 0])),
    keywords: kwData.filter(r => r[0]).map(r => ({ keyword: String(r[0]).toLowerCase(), category: r[1] })),
    accounts: accData.filter(r => r[0]).map(r => ({ name: r[0], initial: r[1] || 0, type: r[2] || 'Aset', limit: r[3] || 0, noRek: String(r[4] || ''), atasNama: String(r[5] || '') })),
    hutang: hutangData.filter(r => r[0]).map(r => ({ id: String(r[0]), name: r[1], type: r[2], total: r[3] || 0, paid: r[4] || 0, date: formatDateForClient_(r[5]), dueDate: r[6] ? formatDateForClient_(r[6]) : '', note: r[7] || '', status: r[8] || 'Aktif', linkAccount: r[9] || '' })),
    tabungan: tabData.filter(r => r[0]).map(r => ({ id: String(r[0]), name: r[1], target: r[2] || 0, collected: r[3] || 0, targetDate: r[4] ? formatDateForClient_(r[4]) : '', note: r[5] || '' })),
    berulang: berulangData.filter(r => r[0]).map(r => ({ id: String(r[0]), desc: r[1], category: r[2], type: r[3], amount: r[4] || 0, account: r[5] || 'Tunai', frequency: r[6], nextDate: formatDateForClient_(r[7]), active: String(r[8]).toLowerCase() === 'true' || r[8] === true || r[8] === 'Aktif' })),
    cicilan: cicilanData.filter(r => r[0]).map(r => ({ id: String(r[0]), name: r[1], provider: r[2], type: r[3], tenor: r[4] || 0, amountPerInstallment: r[5] || 0, account: r[6] || 'Tunai', nextDue: formatDateForClient_(r[7]), installmentNo: r[8] || 0, autoPay: String(r[9]).toLowerCase() === 'true' || r[9] === true, status: r[10] || 'Aktif', ccAccount: r[11] || '' })),
    investasi: invData.filter(r => r[0]).map(r => ({ id: String(r[0]), name: r[1], type: r[2], modal: Number(r[3]) || 0, currentValue: Number(r[4]) || 0, account: r[5], date: formatDateForClient_(r[6]) }))
  };

  try { cache.put(CACHE_KEY, JSON.stringify(payload), 1800); } catch(e){} 
  return payload;
}

function addTransaction(tx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Transaksi');
  const id = Utilities.getUuid();
  sh.appendRow([id, tx.date, tx.desc, tx.category, tx.type, tx.amount, 'App', tx.account || 'Tunai']);
  clearCache();
  return { success: true, id: id };
}

function deleteTransaction(id) { return deleteById('Transaksi', id); }

function updateTransaction(tx) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(tx.id)) {
      // Kolom B-F: Tanggal, Keterangan, Kategori, Tipe, Nominal. Kolom G (Sumber) tidak diubah.
      sh.getRange(i + 1, 2, 1, 5).setValues([[tx.date, tx.desc, tx.category, tx.type, Number(tx.amount)]]);
      sh.getRange(i + 1, 8).setValue(tx.account || 'Tunai');
      clearCache();
      return { success: true };
    }
  }
  return { success: false, error: 'ID tidak ditemukan' };
}
// Pisah satu transaksi KELUAR menjadi beberapa baris per kategori.
// parts: [{ category: 'Makanan', amount: 30000 }, { category: 'Minuman', amount: 12000 }, ...]
// Baris asli dipakai untuk bagian pertama, sisanya ditambahkan sebagai baris baru (tanggal, akun, sumber sama).
function splitTransaction(id, parts) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!Array.isArray(parts) || parts.length < 2 || parts.length > 20) {
      return { success: false, error: 'Minimal 2 bagian kategori' };
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Transaksi');
    const row = cariBarisById_(sh, id);
    if (!row) return { success: false, error: 'Transaksi tidak ditemukan' };

    const r = sh.getRange(row, 1, 1, 8).getValues()[0]; // ID, Tanggal, Keterangan, Kategori, Tipe, Nominal, Sumber, Akun
    const TIDAK_BOLEH = ['Transfer Antar Rekening', 'Pembayaran CC', 'Hutang Piutang', 'Cicilan', 'Refund'];
    if (r[4] !== 'Keluar') return { success: false, error: 'Split hanya untuk transaksi Keluar' };
    if (TIDAK_BOLEH.indexOf(String(r[3])) !== -1 || String(r[6]) === 'Transfer') {
      return { success: false, error: 'Transaksi jenis ini tidak bisa dipisah' };
    }

    const validNames = {};
    getSheetData('Kategori').forEach(k => { if (k[1]) validNames[String(k[1])] = true; });

    const total = Number(r[5]);
    let sum = 0;
    const clean = [];
    for (let i = 0; i < parts.length; i++) {
      const cat = String(parts[i].category || '').trim();
      const amt = Math.round(Number(parts[i].amount));
      if (!validNames[cat]) return { success: false, error: 'Kategori tidak valid: ' + cat };
      if (TIDAK_BOLEH.indexOf(cat) !== -1) return { success: false, error: 'Kategori ' + cat + ' tidak boleh dipakai untuk split' };
      if (!(amt > 0)) return { success: false, error: 'Nominal tiap bagian harus lebih dari 0' };
      sum += amt;
      clean.push({ category: cat, amount: amt });
    }
    if (sum !== total) return { success: false, error: 'Total bagian (' + sum + ') harus sama dengan nominal asli (' + total + ')' };

    const desc = String(r[2] || '');
    // Bagian pertama: timpa baris asli (Keterangan, Kategori, Tipe, Nominal)
    sh.getRange(row, 3, 1, 4).setValues([[desc + ' (' + clean[0].category + ')', clean[0].category, 'Keluar', clean[0].amount]]);
    // Bagian sisanya: baris baru, satu kali setValues
    const rows = clean.slice(1).map(p => [Utilities.getUuid(), r[1], desc + ' (' + p.category + ')', p.category, 'Keluar', p.amount, r[6], r[7]]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 8).setValues(rows);

    clearCache();
    return { success: true, count: clean.length };
  } finally {
    lock.releaseLock();
  }
}
function updateGroupBudget(groupName, budget) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Budget Grup');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === groupName) {
      sh.getRange(i + 1, 2).setValue(budget);
      clearCache();
      return { success: true };
    }
  }
  sh.appendRow([groupName, budget]);
  clearCache();
  return { success: true };
}

function addAccount(name, initial, type, limit) {
  const data = getSheetData('Akun');
  if (data.some(r => String(r[0]).toLowerCase() === String(name).toLowerCase())) return { success: false, error: 'Akun sudah ada' };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Akun');
  sh.appendRow([name, initial || 0, type || 'Aset', limit || 0]);
  clearCache();
  return { success: true };
}

function updateAccountInitial(name, initial) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Akun');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === name) {
      sh.getRange(i + 1, 2).setValue(initial);
      clearCache();
      return { success: true };
    }
  }
  sh.appendRow([name, initial || 0, 'Aset', 0]);
  clearCache();
  return { success: true };
}

function updateAccountLimit(name, limit) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Akun');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === name) {
      sh.getRange(i + 1, 4).setValue(limit);
      clearCache();
      return { success: true };
    }
  }
  return { success: false };
}

// Simpan nomor rekening & atas nama akun (kolom E-F). Format teks agar angka 0 di depan (mis. nomor HP) tidak hilang.
function updateAccountInfo(name, noRek, atasNama) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Akun');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === name) {
      const rg = sh.getRange(i + 1, 5, 1, 2);
      rg.setNumberFormat('@');
      rg.setValues([[String(noRek || '').trim().slice(0, 40), String(atasNama || '').trim().slice(0, 60)]]);
      clearCache();
      return { success: true };
    }
  }
  return { success: false, error: 'Akun tidak ditemukan' };
}

function addTransfer(fromAccount, toAccount, amount, fee, dateStr, notes) {
  if (fromAccount === toAccount) return { success: false, error: 'Akun asal dan tujuan tidak boleh sama' };
  const txSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
  const accSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Akun');
  
  let isToCreditCard = false;
  let isFromEmoney = false;
  
  const accData = accSh.getDataRange().getValues();
  for(let i=1; i<accData.length; i++) {
      if(accData[i][0] === fromAccount && accData[i][2] === 'E-money') {
          isFromEmoney = true;
      }
      if(accData[i][0] === toAccount && accData[i][2] === 'Kredit') {
          isToCreditCard = true;
      }
  }

  // BLOKIR TRANSFER DARI E-MONEY
  if (isFromEmoney) {
      return { success: false, error: 'Akun E-money tidak bisa digunakan untuk transfer ke akun lain.' };
  }

  const date = dateStr || new Date().toISOString().slice(0, 10);
  const note = notes ? ' - ' + notes : '';
  const rows = [];
  
  if (isToCreditCard) {
      rows.push([Utilities.getUuid(), date, 'Pembayaran Kartu Kredit ' + toAccount + note, 'Pembayaran CC', 'Keluar', amount, 'Transfer', fromAccount]);
      rows.push([Utilities.getUuid(), date, 'Pembayaran Masuk ' + note, 'Pembayaran CC', 'Masuk', amount, 'Transfer', toAccount]);
  } else {
      rows.push([Utilities.getUuid(), date, 'Transfer ke ' + toAccount + note, 'Transfer Antar Rekening', 'Keluar', amount, 'Transfer', fromAccount]);
      rows.push([Utilities.getUuid(), date, 'Transfer dari ' + fromAccount + note, 'Transfer Antar Rekening', 'Masuk', amount, 'Transfer', toAccount]);
  }
  
  if (fee && fee > 0) rows.push([Utilities.getUuid(), date, 'Biaya admin transfer ke ' + toAccount, 'Biaya Bank', 'Keluar', fee, 'Transfer', fromAccount]);
  
  txSh.getRange(txSh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  clearCache();
  return { success: true };
}

function addHutang(item) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Hutang Piutang');
  const id = Utilities.getUuid();
  sh.appendRow([id, item.name, item.type, item.total, 0, item.date, item.dueDate || '', item.note || '', 'Aktif', item.linkAccount || '']);
  
  if (item.linkAccount) {
    const isHutang = item.type === 'Utang';
    const accSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Akun');
    const accData = accSh.getDataRange().getValues();
    let isCreditAccount = false;
    for(let i=1; i<accData.length; i++) {
       if(accData[i][0] === item.linkAccount && accData[i][2] === 'Kredit') isCreditAccount = true;
    }

    if (isCreditAccount && !isHutang) {
       addTransaction({
         date: item.date, 
         desc: 'Pinjaman CC untuk: ' + item.name,
         category: 'Hutang Piutang', type: 'Keluar',
         amount: item.total, account: item.linkAccount
       });
    } else {
       addTransaction({
         date: item.date, 
         desc: (isHutang ? 'Terima pinjaman dari ' : 'Pinjamkan ke ') + item.name,
         category: 'Hutang Piutang', type: isHutang ? 'Masuk' : 'Keluar',
         amount: item.total, account: item.linkAccount
       });
    }
  }
  clearCache();
  return { success: true, id: id };
}

function deleteHutang(id) { return deleteById('Hutang Piutang', id); }

function addHutangPayment(id, amount, account, date) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Hutang Piutang');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const type = data[i][2];
      const total = data[i][3] || 0;
      const paidAfter = (data[i][4] || 0) + amount;
      sh.getRange(i + 1, 5).setValue(paidAfter);
      if (paidAfter >= total) sh.getRange(i + 1, 9).setValue('Lunas');

      const isUtang = type === 'Utang';
      
      addTransaction({
        date: date,
        desc: isUtang ? ('Bayar hutang: ' + data[i][1]) : ('Terima piutang: ' + data[i][1]),
        category: 'Hutang Piutang', type: isUtang ? 'Keluar' : 'Masuk',
        amount: amount, account: account
      });

      return { success: true, paid: paidAfter, lunas: paidAfter >= total };
    }
  }
  return { success: false, error: 'ID tidak ditemukan' };
}

function addTabungan(item) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tabungan');
  const id = Utilities.getUuid();
  sh.appendRow([id, item.name, item.target, 0, item.targetDate || '', item.note || '']);
  clearCache();
  return { success: true, id: id };
}

function deleteTabungan(id) { return deleteById('Tabungan', id); }

function addTabunganSetoran(id, amount, account, date) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tabungan');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const collectedAfter = (data[i][3] || 0) + amount;
      sh.getRange(i + 1, 4).setValue(collectedAfter);

      const isSetor = amount > 0;
      addTransaction({
        date: date,
        desc: isSetor ? ('Setor tabungan: ' + data[i][1]) : ('Tarik tabungan: ' + data[i][1]),
        category: 'Tabungan', type: isSetor ? 'Keluar' : 'Masuk',
        amount: Math.abs(amount), account: account
      });
      return { success: true, collected: collectedAfter };
    }
  }
  return { success: false, error: 'ID tidak ditemukan' };
}

function addBerulang(item) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi Berulang');
  const id = Utilities.getUuid();
  sh.appendRow([id, item.desc, item.category, item.type, item.amount, item.account, item.frequency, item.startDate, true]);
  clearCache();
  return { success: true, id: id };
}

function deleteBerulang(id) { return deleteById('Transaksi Berulang', id); }

function toggleBerulang(id, active) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi Berulang');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sh.getRange(i + 1, 9).setValue(active);
      clearCache();
      return { success: true };
    }
  }
  return { success: false, error: 'ID tidak ditemukan' };
}

function computeNextDate_(date, frequency) {
  const d = new Date(date);
  if (frequency === 'Harian') d.setDate(d.getDate() + 1);
  else if (frequency === 'Mingguan') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function processRecurringTransactions() {
  let cacheCleared = false;
  if (processCicilanAutoPay_()) cacheCleared = true;
  
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi Berulang');
  const txSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
  const data = sh.getDataRange().getValues();
  
  if (data.length > 1) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      for (let i = 1; i < data.length; i++) {
        const active = data[i][8] === true || String(data[i][8]).toLowerCase() === 'true' || data[i][8] === 'Aktif';
        if (!active) continue;
        
        let nextDate = data[i][7];
        if (!(nextDate instanceof Date)) nextDate = new Date(nextDate);
        nextDate.setHours(0, 0, 0, 0);

        let guard = 0;
        let rowsToInsert = [];
        while (nextDate <= today && guard < 60) {
          const dateStr = Utilities.formatDate(nextDate, Session.getScriptTimeZone() || 'GMT+7', 'yyyy-MM-dd');
          rowsToInsert.push([
            Utilities.getUuid(), dateStr,
            data[i][1], data[i][2], data[i][3], data[i][4], 'Berulang', data[i][5]
          ]);
          nextDate = computeNextDate_(nextDate, data[i][6]);
          guard++;
          cacheCleared = true;
        }
        if (rowsToInsert.length > 0) {
            txSh.getRange(txSh.getLastRow() + 1, 1, rowsToInsert.length, rowsToInsert[0].length).setValues(rowsToInsert);
        }
        sh.getRange(i + 1, 8).setValue(nextDate);
      }
  }
  if (cacheCleared) clearCache();
}

function deleteCicilan(id) { return deleteById('Cicilan', id); }

function payOneCicilanRow_(sh, rowIndex, rowData) {
  const txSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
  const name = rowData[1], tenor = rowData[4], amount = rowData[5], account = rowData[6] || 'Tunai';
  const ccAccount = rowData[11] || '';
  let nextDue = rowData[7];
  if (!(nextDue instanceof Date)) nextDue = new Date(nextDue);
  
  const currentInstallment = (rowData[8] || 0) + 1;
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+7', 'yyyy-MM-dd');
  
  if (ccAccount) {
      txSh.appendRow([Utilities.getUuid(), dateStr, 'Cicilan ' + name + ' (ke-' + currentInstallment + '/' + tenor + ')', 'Cicilan', 'Keluar', amount, 'App', account]);
      txSh.appendRow([Utilities.getUuid(), dateStr, 'Pemulihan Limit CC: Cicilan ' + name, 'Pembayaran CC', 'Masuk', amount, 'App', ccAccount]);
  } else {
      txSh.appendRow([Utilities.getUuid(), dateStr, 'Cicilan ' + name + ' (ke-' + currentInstallment + '/' + tenor + ')', 'Cicilan', 'Keluar', amount, 'App', account]);
  }

  const newNextDue = computeNextDate_(nextDue, 'Bulanan');
  const lunas = currentInstallment >= tenor;
  
  sh.getRange(rowIndex, 9).setValue(currentInstallment);
  sh.getRange(rowIndex, 8).setValue(lunas ? nextDue : newNextDue);
  sh.getRange(rowIndex, 11).setValue(lunas ? 'Lunas' : 'Aktif');
}

function payCicilanInstallment(id) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Cicilan');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      if (data[i][10] === 'Lunas') return { success: false, error: 'Cicilan sudah lunas' };
      payOneCicilanRow_(sh, i + 1, data[i]);
      clearCache();
      return { success: true };
    }
  }
  return { success: false, error: 'ID tidak ditemukan' };
}

function processCicilanAutoPay_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Cicilan');
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  let updated = false;
  for (let i = 1; i < data.length; i++) {
    const status = data[i][10];
    const autoPay = data[i][9] === true || String(data[i][9]).toLowerCase() === 'true';
    if (status === 'Lunas' || !autoPay) continue;
    
    let nextDue = data[i][7];
    if (!(nextDue instanceof Date)) nextDue = new Date(nextDue);
    nextDue.setHours(0, 0, 0, 0);
    
    let guard = 0;
    while (nextDue <= today && data[i][10] !== 'Lunas' && guard < 60) {
        payOneCicilanRow_(sh, i + 1, data[i]);
        data[i] = sh.getRange(i+1, 1, 1, sh.getLastColumn()).getValues()[0];
        nextDue = data[i][7];
        if (!(nextDue instanceof Date)) nextDue = new Date(nextDue);
        nextDue.setHours(0, 0, 0, 0);
        guard++;
        updated = true;
    }
  }
  return updated;
}

function addCicilan(item) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Cicilan');
  const id = Utilities.getUuid();
  sh.appendRow([id, item.name, item.provider, item.type, item.tenor, item.amountPerInstallment, item.account, item.startDate, 0, !!item.autoPay, 'Aktif', item.ccAccount || '']);
  
  if (item.ccAccount) {
      const totalAmount = item.tenor * item.amountPerInstallment;
      addTransaction({
          date: new Date().toISOString().slice(0,10),
          desc: 'Pembelian Cicilan: ' + item.name + ' (' + item.provider + ')',
          category: 'Hutang Piutang', type: 'Keluar', amount: totalAmount, account: item.ccAccount
      });
  }
  
  clearCache();
  return { success: true, id: id };
}

// Investasi baru dari tombol "Tambah Investasi Baru" (JS_Halaman: submitInvestasiBaru).
// Modal awal (opsional) mengurangi saldo akun sumber lewat satu transaksi "Beli investasi: ...".
function addInvestasi(item) {
  const nama = String(item && item.name || '').trim().slice(0, 80);
  if (!nama) return { success: false, error: 'Nama investasi belum diisi' };
  const modal = Math.max(0, Math.round(Number(item.modal) || 0));
  const jenis = String(item.type || 'Lainnya').trim().slice(0, 40);
  const akun = String(item.account || 'Tunai');
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ''))
    ? String(item.date)
    : Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Investasi');
  const id = Utilities.getUuid();
  // Investasi: ID, Nama, Jenis, Modal Awal, Nilai Sekarang, Akun Sumber, Tanggal Mulai
  sh.appendRow([id, nama, jenis, modal, modal, akun, tanggal]);

  if (modal > 0) {
    addTransaction({
      date: tanggal, desc: 'Beli investasi: ' + nama,
      category: 'Investasi', type: 'Keluar', amount: modal, account: akun
    });
  }
  clearCache();
  return { success: true, id: id };
}

function deleteInvestasi(id) { return deleteById('Investasi', id); }

function addInvestasiSetoran(id, amount, account, date) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Investasi');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const currentModal = Number(data[i][3]) || 0;
      const currentValue = Number(data[i][4]) || 0;
      sh.getRange(i + 1, 4).setValue(currentModal + amount);
      sh.getRange(i + 1, 5).setValue(currentValue + amount);

      addTransaction({
        date: date, desc: 'Setor investasi: ' + data[i][1],
        category: 'Investasi', type: 'Keluar', amount: amount, account: account
      });
      return { success: true };
    }
  }
  return { success: false, error: 'ID tidak ditemukan' };
}

function updateInvestasiValue(id, value) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Investasi');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sh.getRange(i + 1, 5).setValue(value);
      clearCache();
      return { success: true };
    }
  }
  return { success: false, error: 'ID tidak ditemukan' };
}

function sellInvestasi(id, amount, account, date) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Investasi');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const currentModal = Number(data[i][3]) || 0;
      const currentValue = Number(data[i][4]) || 0;
      const newModal = Math.max(0, currentModal - amount);
      const newValue = Math.max(0, currentValue - amount);
      sh.getRange(i + 1, 4).setValue(newModal);
      sh.getRange(i + 1, 5).setValue(newValue);

      addTransaction({
        date: date, desc: 'Pencairan investasi: ' + data[i][1],
        category: 'Investasi', type: 'Masuk', amount: amount, account: account
      });
      return { success: true };
    }
  }
  return { success: false, error: 'ID tidak ditemukan' };
}

function importBulk(list) {
  const txSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
  const kwData = getSheetData('Kata Kunci');
  const keywords = kwData.filter(r => r[0]).map(r => ({ keyword: String(r[0]).toLowerCase(), category: r[1] }));
  
  const autoCategorize = (desc) => {
    const text = String(desc || '').toLowerCase();
    for (const k of keywords) {
      if (k.keyword && text.includes(k.keyword)) return k.category;
    }
    return 'Lainnya';
  };

  const rows = list.map(tx => {
    const category = tx.category || autoCategorize(tx.desc);
    return [Utilities.getUuid(), tx.date, tx.desc, category, tx.type, tx.amount, 'Import', tx.account || 'Tunai'];
  });
  
  if (rows.length > 0) {
    txSh.getRange(txSh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    clearCache();
  }
  return { success: true, count: rows.length };
}

// Butuh layanan lanjutan "Drive" (Services > Drive API) aktif di project Apps Script.
function importFromFile(base64Data, mimeType, fileName) {
  var tempDocId = null;
  try {
    const bytes = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(bytes, mimeType, fileName || 'statement');
    const file = Drive.Files.insert({ title: 'KAYA_OCR_TEMP_' + new Date().getTime() }, blob, { ocr: true, ocrLanguage: 'id', convert: true });
    tempDocId = file.id;
    return { success: true, text: DocumentApp.openById(tempDocId).getBody().getText() };
  } catch (err) {
    return { success: false, error: 'Gagal memproses dokumen' };
  } finally {
    if (tempDocId) try { DriveApp.getFileById(tempDocId).setTrashed(true); } catch (e) {}
  }
}
