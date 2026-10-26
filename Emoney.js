/**
 * ============================================================
 * KAYA - SINKRON SALDO E-MONEY DARI FILE eChis (backend)
 * ============================================================
 * File baru, tidak mengubah Code.gs / Database.gs / Titip.gs.
 * Memakai helper yang sudah ada: getSheetData, formatDateForClient_, clearCache.
 *
 * Cara kerja:
 * 1. emoneyBacaFile  : xlsx dari eChis diubah sementara jadi Google Sheet (Drive), dibaca, lalu dibuang.
 *                      Hasilnya dicocokkan dengan saldo E-Money di KAYA ("titik jangkar"):
 *                      baris riwayat kartu yang saldo setelahnya SAMA dengan saldo KAYA = sudah tercatat.
 *                      Baris yang lebih baru = belum tercatat.
 * 2. emoneyTerapkan  : menulis baris yang dipilih pengguna ke sheet Transaksi (Sumber = Import),
 *                      plus (opsional) satu baris Balancing untuk sisa selisih.
 */
const EMONEY_KAT_TOLAK_ = ['Transfer Antar Rekening', 'Pembayaran CC', 'Hutang Piutang'];

// Saldo akun non-kredit di KAYA: saldo awal + Masuk - Keluar (sama dengan accountBalance di frontend)
function emoneySaldoKaya_(nama) {
  const acc = getSheetData('Akun').filter(r => String(r[0]) === String(nama))[0];
  if (!acc) return null;
  let bal = Number(acc[1]) || 0;
  getSheetData('Transaksi').forEach(r => {
    if (String(r[7] || 'Tunai') !== String(nama)) return;
    bal += r[4] === 'Masuk' ? Number(r[5]) : -Number(r[5]);
  });
  return Math.round(bal);
}

function emoneyAkunValid_(nama) {
  return getSheetData('Akun').some(r => String(r[0]) === String(nama) && String(r[2]) === 'E-money');
}

// Arah transaksi dari kolom Type eChis. Kosong = tidak dikenal (diputuskan dari perubahan saldo).
function emoneyArah_(type) {
  const t = String(type || '').toLowerCase();
  if (/purchase|payment|debit|belanja/.test(t)) return 'Keluar';
  if (/top\s*-?\s*up|reload|deposit|refund|credit|isi/.test(t)) return 'Masuk';
  return '';
}

function emoneyBacaFile(base64Data, mimeType, fileName, akun) {
  let tempId = null;
  try {
    if (!emoneyAkunValid_(akun)) return { success: false, error: 'Akun E-money tidak ditemukan' };

    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName || 'echis.xlsx'
    );
    const f = Drive.Files.insert({ title: 'KAYA_EMONEY_TEMP_' + new Date().getTime() }, blob, { convert: true });
    tempId = f.id;
    const ss = SpreadsheetApp.openById(tempId);
    const tz = ss.getSpreadsheetTimeZone() || 'GMT+7';
    const sh = ss.getSheetByName('Card Logs') || ss.getSheets()[0];
    const vals = sh.getDataRange().getValues();

    // Cari baris header tabel ("No | Date | Type | Amount | Balance | MID | Location")
    // dan teks "<nomor kartu> , Balance 22,919" (saldo kartu saat ini)
    let hdr = -1, cardNo = '', saldoKartu = null;
    for (let i = 0; i < vals.length; i++) {
      const r = vals[i];
      if (hdr < 0 && String(r[0]).trim() === 'No' && /date/i.test(String(r[1]))) hdr = i;
      for (let j = 0; j < r.length; j++) {
        const m = String(r[j]).match(/(\d{10,})\s*,\s*Balance\s+([\d.,]+)/i);
        if (m && saldoKartu === null) {
          cardNo = m[1];
          saldoKartu = parseInt(m[2].replace(/[^0-9]/g, ''), 10);
        }
      }
    }
    if (hdr < 0) return { success: false, error: 'Tabel "Card Logs" tidak ditemukan di file ini' };

    const raw = [];
    for (let i = hdr + 1; i < vals.length; i++) {
      const r = vals[i];
      const no = Number(r[0]);
      let d = r[1];
      if (!(d instanceof Date)) d = new Date(d);
      const amt = Number(r[3]), bal = Number(r[4]);
      if (!no || isNaN(d.getTime()) || !(amt > 0) || isNaN(bal)) continue;
      raw.push({
        no: no,
        date: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
        time: Utilities.formatDate(d, tz, 'HH:mm'),
        type: String(r[2] || ''),
        amount: Math.round(amt),
        balance: Math.round(bal),
        mid: String(r[5] || '')
      });
    }
    raw.sort((a, b) => a.no - b.no);
    if (raw.length === 0) return { success: false, error: 'Tidak ada baris transaksi di file ini' };
    if (raw.length > 100) raw.splice(0, raw.length - 100);

    // Kolom Balance = saldo SETELAH transaksi. Arah: dari Type; kalau tipe asing, dari naik/turunnya saldo.
    raw.forEach((x, i) => {
      let dir = emoneyArah_(x.type);
      if (!dir && i > 0) dir = x.balance >= raw[i - 1].balance ? 'Masuk' : 'Keluar';
      x.dir = dir || 'Keluar';
    });
    if (saldoKartu === null) saldoKartu = raw[raw.length - 1].balance;

    // Titik jangkar: baris terbaru yang saldo setelahnya sama dengan saldo E-Money di KAYA
    const saldoKaya = emoneySaldoKaya_(akun);
    let anchorIdx = -1;
    raw.forEach((x, i) => { if (x.balance === saldoKaya) anchorIdx = i; });

    // Penanda "mirip transaksi yang sudah ada" (tanggal + nominal + arah sama) untuk akun ini
    const kaya = getSheetData('Transaksi')
      .filter(r => String(r[7] || 'Tunai') === String(akun))
      .map(r => ({ d: formatDateForClient_(r[1]), t: r[4], a: Math.round(Number(r[5])) }));
    let lastDate = '';
    kaya.forEach(k => { if (k.d > lastDate) lastDate = k.d; });

    raw.forEach((x, i) => {
      x.mirip = kaya.some(k => k.d === x.date && k.t === x.dir && k.a === x.amount);
      // Top-up (Masuk) tidak dicentang otomatis: sumber dananya tidak diketahui
      x.pilih = x.dir === 'Keluar' && (anchorIdx >= 0 ? i > anchorIdx : (!x.mirip && x.date >= lastDate));
    });

    return {
      success: true,
      akun: akun,
      cardNo: cardNo,
      saldoKartu: saldoKartu,
      saldoKaya: saldoKaya,
      anchorNo: anchorIdx >= 0 ? raw[anchorIdx].no : 0,
      rows: raw.slice().reverse() // terbaru di atas
    };
  } catch (err) {
    return { success: false, error: 'Gagal membaca file: ' + String(err && err.message || err) };
  } finally {
    if (tempId) try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) {}
  }
}

// picked: [{ date, dir, amount, mid }]; balancing: true = tambah 1 baris Balancing untuk sisa selisih
function emoneyTerapkan(akun, picked, kategori, balancing, saldoKartu) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!emoneyAkunValid_(akun)) return { success: false, error: 'Akun E-money tidak ditemukan' };
    picked = Array.isArray(picked) ? picked : [];
    if (picked.length > 100) return { success: false, error: 'Terlalu banyak baris' };

    const valid = {};
    getSheetData('Kategori').forEach(k => { if (k[1]) valid[String(k[1])] = true; });
    const kat = valid[kategori] ? String(kategori) : 'Lainnya';
    if (EMONEY_KAT_TOLAK_.indexOf(kat) !== -1) return { success: false, error: 'Kategori ini tidak boleh dipakai' };

    const rows = [];
    let net = 0;
    for (let i = 0; i < picked.length; i++) {
      const p = picked[i] || {};
      const amount = Math.round(Number(p.amount));
      if (p.dir !== 'Keluar' && p.dir !== 'Masuk') return { success: false, error: 'Arah transaksi tidak valid' };
      if (!(amount > 0) || amount > 10000000) return { success: false, error: 'Nominal tidak valid' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date))) return { success: false, error: 'Tanggal tidak valid' };
      const mid = String(p.mid || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 16);
      const desc = (p.dir === 'Keluar' ? 'Pembayaran e-money' : 'Top-up e-money') + (mid ? ' (MID ' + mid + ')' : '');
      rows.push([Utilities.getUuid(), String(p.date), desc, p.dir === 'Keluar' ? kat : 'Lainnya', p.dir, amount, 'Import', akun]);
      net += p.dir === 'Masuk' ? amount : -amount;
    }

    const saldoKaya = emoneySaldoKaya_(akun);
    if (balancing) {
      const selisih = Math.round(Number(saldoKartu)) - (saldoKaya + net);
      if (selisih !== 0) {
        const today = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
        rows.push([Utilities.getUuid(), today, 'Balancing', 'Lainnya', selisih < 0 ? 'Keluar' : 'Masuk', Math.abs(selisih), 'App', akun]);
      }
    }
    if (rows.length === 0) return { success: false, error: 'Tidak ada transaksi untuk disimpan' };

    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transaksi');
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
    SpreadsheetApp.flush();
    clearCache();
    return { success: true, count: rows.length, saldoSetelah: emoneySaldoKaya_(akun) };
  } finally {
    lock.releaseLock();
  }
}
