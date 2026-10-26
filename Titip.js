/**
 * ============================================================
 * KAYA - TITIPAN & SPLIT BILL (backend)
 * ============================================================
 * Dipanggil dari halaman "Titipan & Split Bill" (JS_Titip.html).
 * Satu transaksi Keluar dipecah: bagian saya tetap di transaksi asli,
 * bagian teman jadi Piutang (+ baris "Pinjamkan ke X" dari akun sumber).
 * Kalau teman sudah membayar balik, ditambah baris "Terima piutang: X"
 * ke akun pengembalian dan piutang langsung Lunas.
 * Memakai helper di API.gs: cariBarisById_, getSheetData, formatDateForClient_, clearCache.
 */
const TITIP_TOLAK_ = ['Transfer Antar Rekening', 'Pembayaran CC', 'Hutang Piutang', 'Cicilan', 'Refund'];

// friends: [{ name, amount, paid, payAccount }]
function splitBillTransaksi(txId, friends) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!Array.isArray(friends) || friends.length < 1 || friends.length > 10) {
      return { success: false, error: 'Tambahkan 1 sampai 10 teman' };
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Transaksi');
    const hp = ss.getSheetByName('Hutang Piutang');
    if (!sh || !hp) return { success: false, error: 'Sheet tidak ditemukan' };

    const row = cariBarisById_(sh, txId);
    if (!row) return { success: false, error: 'Transaksi tidak ditemukan' };

    const r = sh.getRange(row, 1, 1, 8).getValues()[0]; // ID, Tanggal, Keterangan, Kategori, Tipe, Nominal, Sumber, Akun
    if (r[4] !== 'Keluar') return { success: false, error: 'Hanya untuk transaksi Keluar' };
    if (TITIP_TOLAK_.indexOf(String(r[3])) !== -1 || String(r[6]) === 'Transfer') {
      return { success: false, error: 'Transaksi jenis ini tidak bisa dijadikan titipan' };
    }

    const jenisAkun = {};
    getSheetData('Akun').forEach(a => { if (a[0]) jenisAkun[String(a[0])] = String(a[2] || 'Aset'); });

    const total = Math.round(Number(r[5]));
    let sum = 0;
    const clean = [];
    for (let i = 0; i < friends.length; i++) {
      const f = friends[i] || {};
      const name = String(f.name || '').trim().slice(0, 60);
      const amount = Math.round(Number(f.amount));
      const paid = !!f.paid;
      const payAccount = String(f.payAccount || '');
      if (!name) return { success: false, error: 'Nama teman belum diisi' };
      if (!(amount > 0)) return { success: false, error: 'Nominal tiap teman harus lebih dari 0' };
      if (paid && (!jenisAkun[payAccount] || jenisAkun[payAccount] === 'Kredit')) {
        return { success: false, error: 'Akun pengembalian untuk ' + name + ' tidak valid' };
      }
      sum += amount;
      clean.push({ name: name, amount: amount, paid: paid, payAccount: payAccount });
    }
    if (sum > total) return { success: false, error: 'Total bagian teman (' + sum + ') melebihi nominal transaksi (' + total + ')' };
    const own = total - sum;

    const date = formatDateForClient_(r[1]);
    const akun = String(r[7] || 'Tunai');
    const desc = String(r[2] || '');
    const today = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');

    const hpRows = [], txRows = [];
    clean.forEach(f => {
      // Hutang Piutang: ID, Nama, Tipe, Jumlah Total, Terbayar, Tanggal, Jatuh Tempo, Catatan, Status, Akun Terhubung
      hpRows.push([Utilities.getUuid(), f.name, 'Piutang', f.amount, f.paid ? f.amount : 0, date, '', 'Titip: ' + desc, f.paid ? 'Lunas' : 'Aktif', akun]);
      txRows.push([Utilities.getUuid(), date, 'Pinjamkan ke ' + f.name, 'Hutang Piutang', 'Keluar', f.amount, 'App', akun]);
      if (f.paid) txRows.push([Utilities.getUuid(), today, 'Terima piutang: ' + f.name, 'Hutang Piutang', 'Masuk', f.amount, 'App', f.payAccount]);
    });

    // Tambah baris baru dulu; baris asli diubah terakhir supaya kegagalan di tengah tidak menghilangkan data
    hp.getRange(hp.getLastRow() + 1, 1, hpRows.length, hpRows[0].length).setValues(hpRows);
    sh.getRange(sh.getLastRow() + 1, 1, txRows.length, 8).setValues(txRows);
    if (own > 0) sh.getRange(row, 6).setValue(own);
    else sh.deleteRow(row);

    clearCache();
    return { success: true, own: own, count: clean.length };
  } finally {
    lock.releaseLock();
  }
}
