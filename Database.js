/**
 * ============================================================
 *  * KAYA v1.0.0 (Public Release) - DATABASE & CACHE MANAGER (E-MONEY SUPPORT)
 * ============================================================
 * initDatabase() hanya MEMBUAT sheet yang belum ada (lengkap dengan isi default).
 * Sheet yang sudah ada tidak ditimpa; paling banyak kolom header yang kurang ditambahkan di akhir.
 */

const DB_SCHEMA = {
  'Transaksi': {
    headers: ['ID', 'Tanggal', 'Keterangan', 'Kategori', 'Tipe', 'Nominal', 'Sumber', 'Akun'],
    defaults: []
  },
  'Kategori': {
    headers: ['Grup', 'Kategori', 'Budget Bulanan'],
    defaults: [
      ['PENGHASILAN', 'Gaji', 0], ['PENGHASILAN', 'Bonus', 0], ['PENGHASILAN', 'Penghasilan Lain', 0],
      ['KEBUTUHAN', 'Makanan', 0], ['KEBUTUHAN', 'Minuman', 0], ['KEBUTUHAN', 'Rumah Tangga', 0], ['KEBUTUHAN', 'Tagihan & Utilitas', 0], ['KEBUTUHAN', 'Transportasi', 0], ['KEBUTUHAN', 'Kesehatan', 0],
      ['KEINGINAN', 'Hiburan', 0], ['KEINGINAN', 'Belanja', 0], ['KEINGINAN', 'Langganan', 0], ['KEINGINAN', 'Perjalanan', 0], ['KEINGINAN', 'Lifestyle', 0],
      ['KELUARGA & SOSIAL', 'Keluarga', 0], ['KELUARGA & SOSIAL', 'Hadiah', 0], ['KELUARGA & SOSIAL', 'Donasi', 0],
      ['PENGEMBANGAN DIRI', 'Pendidikan', 0],
      ['MASA DEPAN', 'Tabungan', 0], ['MASA DEPAN', 'Dana Darurat', 0], ['MASA DEPAN', 'Investasi', 0],
      ['KEWAJIBAN KEUANGAN', 'Cicilan', 0], ['KEWAJIBAN KEUANGAN', 'Biaya Bank', 0], ['KEWAJIBAN KEUANGAN', 'Pembayaran CC', 0], ['KEWAJIBAN KEUANGAN', 'Hutang Piutang', 0],
      ['NON-SPENDING', 'Transfer Antar Rekening', 0], ['NON-SPENDING', 'Refund', 0],
      ['LAINNYA', 'Lainnya', 0]
    ]
  },
  'Budget Grup': {
    headers: ['Grup Kategori', 'Budget Bulanan'],
    defaults: [
      ['KEBUTUHAN', 3500000], ['KEINGINAN', 1500000], ['KELUARGA & SOSIAL', 500000],
      ['PENGEMBANGAN DIRI', 300000], ['MASA DEPAN', 0], ['KEWAJIBAN KEUANGAN', 0], ['LAINNYA', 0]
    ]
  },
  'Kata Kunci': {
    headers: ['Kata Kunci', 'Kategori'],
    defaults: [
      ['restoran', 'Makanan'], ['warung', 'Makanan'], ['makan siang', 'Makanan'], ['makan malam', 'Makanan'],
      ['kopi', 'Minuman'], ['kenangan', 'Minuman'], ['starbucks', 'Minuman'], ['teh', 'Minuman'],
      ['indomaret', 'Rumah Tangga'], ['alfamart', 'Rumah Tangga'], ['galon', 'Rumah Tangga'], ['sabun', 'Rumah Tangga'],
      ['pln', 'Tagihan & Utilitas'], ['listrik', 'Tagihan & Utilitas'], ['indihome', 'Tagihan & Utilitas'], ['wifi', 'Tagihan & Utilitas'], ['pdam', 'Tagihan & Utilitas'],
      ['grab', 'Transportasi'], ['gojek', 'Transportasi'], ['bensin', 'Transportasi'], ['kai', 'Transportasi'], ['parkir', 'Transportasi'], ['tol', 'Transportasi'],
      ['apotek', 'Kesehatan'], ['dokter', 'Kesehatan'], ['rumah sakit', 'Kesehatan'], ['obat', 'Kesehatan'],
      ['bioskop', 'Hiburan'], ['netflix', 'Langganan'], ['spotify', 'Langganan'], ['youtube premium', 'Langganan'],
      ['tokopedia', 'Belanja'], ['shopee', 'Belanja'], ['zalora', 'Belanja'],
      ['hotel', 'Perjalanan'], ['tiket pesawat', 'Perjalanan'], ['tiket kereta', 'Perjalanan'],
      ['sekolah', 'Pendidikan'], ['kursus', 'Pendidikan'], ['kuliah', 'Pendidikan'], ['buku', 'Pendidikan'],
      ['zakat', 'Donasi'], ['sedekah', 'Donasi'], ['infaq', 'Donasi'],
      ['gaji', 'Gaji'], ['payroll', 'Gaji'], ['bonus', 'Bonus'], ['thr', 'Bonus']
    ]
  },
  // Akun awal yang netral. Ganti nama dan tambah akun sesuai punyamu lewat menu Pengaturan di aplikasi.
  // Tipe: 'Aset' (rekening, dompet digital, tunai), 'E-money' (kartu e-toll/uang elektronik; tidak bisa
  // jadi sumber transfer), 'Kredit' (kartu kredit/paylater; saldonya = tagihan berjalan).
  // CATATAN: fitur catat otomatis dari notifikasi (Code.gs) mencocokkan NAMA AKUN. Pastikan nama akun
  // di sini sama persis dengan yang dikirim iPhone Shortcuts di field "account".
  'Akun': { 
    headers: ['Nama Akun', 'Saldo Awal', 'Tipe', 'Limit', 'No Rekening', 'Atas Nama'], 
    defaults: [
      ['Tunai', 0, 'Aset', 0], 
      ['Rekening Bank', 0, 'Aset', 0],
      ['E-Wallet', 0, 'Aset', 0],
      ['Kartu Kredit', 0, 'Kredit', 10000000]
    ] 
  },
  'Hutang Piutang': { headers: ['ID', 'Nama', 'Tipe', 'Jumlah Total', 'Terbayar', 'Tanggal', 'Jatuh Tempo', 'Catatan', 'Status', 'Akun Terhubung'], defaults: [] },
  'Tabungan': { headers: ['ID', 'Nama Target', 'Target Jumlah', 'Terkumpul', 'Tanggal Target', 'Catatan'], defaults: [] },
  'Transaksi Berulang': { headers: ['ID', 'Keterangan', 'Kategori', 'Tipe', 'Nominal', 'Akun', 'Frekuensi', 'Tanggal Berikutnya', 'Aktif'], defaults: [] },
  'Cicilan': { headers: ['ID', 'Nama', 'Pemberi', 'Jenis', 'Tenor', 'Jumlah Per Cicilan', 'Akun', 'Jatuh Tempo Berikutnya', 'Cicilan Ke', 'Auto Pay', 'Status', 'Akun CC'], defaults: [] },
  // Investasi dimulai kosong. Tambahkan lewat tombol "Tambah Investasi Baru" di tab Dompet.
  'Investasi': { 
    headers: ['ID', 'Nama', 'Jenis', 'Modal Awal', 'Nilai Sekarang', 'Akun Sumber', 'Tanggal Mulai'], 
    defaults: [] 
  },
  'Import Staging': { headers: ['Keterangan'], defaults: [['(Opsional) Tempel data CSV mentah di sini kalau mau import manual lewat menu.']] },
  // Diisi otomatis oleh webhook (catatLogNotif_ di Code.gs): notifikasi yang ditolak / tidak dikenali / diabaikan.
  // Tidak dibaca oleh getData(), jadi tidak memengaruhi saldo maupun statistik.
  // Kolom ID, Status, Akun dipakai antrean "Perlu Diperiksa" di aplikasi (lihat HEADER_LOG di Code.gs).
  'Log Notifikasi': { headers: ['Waktu', 'Hasil', 'Alasan', 'App', 'Judul', 'Teks', 'ID', 'Status', 'Akun'], defaults: [] }
};

const CACHE_KEY = 'KAYA_DATA_CACHE';

function clearCache() {
  CacheService.getUserCache().remove(CACHE_KEY);
}

function formatDateForClient_(val) {
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone() || 'GMT+7', 'yyyy-MM-dd');
  return String(val);
}

function initDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const sheetName in DB_SCHEMA) {
    let sh = ss.getSheetByName(sheetName);
    const schema = DB_SCHEMA[sheetName];
    if (!sh) {
      sh = ss.insertSheet(sheetName);
      sh.appendRow(schema.headers);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, schema.headers.length)
        .setFontWeight('bold')
        .setBackground('#12332A')
        .setFontColor('white');
      if (schema.defaults.length > 0) {
        sh.getRange(2, 1, schema.defaults.length, schema.defaults[0].length).setValues(schema.defaults);
      }
    } else {
      const existingHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      if (existingHeaders.length < schema.headers.length) {
        for (let i = existingHeaders.length; i < schema.headers.length; i++) {
          sh.getRange(1, i + 1).setValue(schema.headers[i])
            .setFontWeight('bold')
            .setBackground('#12332A')
            .setFontColor('white');
        }
      }
    }
  }
}

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  const range = sh.getDataRange();
  const data = range.getValues();
  return data.length > 1 ? data.slice(1) : []; 
}

function deleteById(sheetName, id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return { success: false, error: 'Sheet tidak ditemukan' };
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sh.deleteRow(i + 1);
      clearCache();
      return { success: true };
    }
  }
  return { success: false, error: 'ID tidak ditemukan' };
}
