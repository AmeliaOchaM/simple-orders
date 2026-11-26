// Validasi input pesanan.
// Fungsi validasi* mengembalikan pesan error (string) bila salah, atau null bila valid.

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Teks wajib 1-100 karakter (dihitung setelah spasi di awal/akhir dibuang).
function cekTeks(nilai, nama) {
  if (typeof nilai !== 'string') return `${nama} harus berupa teks`;
  const panjang = [...nilai.trim()].length; // [...] supaya emoji dihitung 1 karakter
  if (panjang < 1 || panjang > 100) return `${nama} harus 1-100 karakter`;
  return null;
}

// Aturan untuk setiap field yang boleh diisi pengguna.
const ATURAN = {
  customerName: (v) => cekTeks(v, 'customerName'),
  item: (v) => cekTeks(v, 'item'),
  quantity: (v) => (Number.isSafeInteger(v) && v > 0 ? null : 'quantity harus bilangan bulat > 0'),
  status: (v) => (v === 'pending' || v === 'done' ? null : 'status harus "pending" atau "done"'),
};

// Cek field yang tidak dikenal, field wajib, lalu aturan tiap field.
function cekField(data, boleh, wajib) {
  for (const k of Object.keys(data)) {
    if (!boleh.includes(k)) return `Field "${k}" tidak boleh diisi (yang boleh: ${boleh.join(', ')})`;
  }
  for (const k of wajib) {
    if (!(k in data)) return `Field "${k}" wajib diisi`;
  }
  for (const k of Object.keys(data)) {
    const salah = ATURAN[k](data[k]);
    if (salah) return salah;
  }
  return null;
}

// ID pesanan harus UUID (dibuat server saat POST).
function validasiId(id) {
  return POLA_UUID.test(id || '') ? null : 'ID pesanan tidak valid (harus UUID)';
}

// POST /orders: pembeli hanya mengisi nama, item, dan jumlah. Status selalu pending.
function validasiBuat(data) {
  const field = ['customerName', 'item', 'quantity'];
  return cekField(data, field, field);
}

// PUT /orders/{id}: pembeli boleh mengubah sebagian field, minimal satu.
function validasiUbah(data) {
  if (Object.keys(data).length === 0) return 'Minimal satu field harus diubah';
  return cekField(data, ['customerName', 'item', 'quantity', 'status'], []);
}

// Baca body JSON. Hasil: { data } bila berhasil, atau { error } bila rusak / bukan objek.
function bacaJson(event) {
  let isi = event.body || '';
  if (event.isBase64Encoded) isi = Buffer.from(isi, 'base64').toString('utf8');
  try {
    const data = JSON.parse(isi);
    if (data && typeof data === 'object' && !Array.isArray(data)) return { data };
  } catch {
    // jatuh ke pesan error di bawah
  }
  return { error: 'Body harus berupa objek JSON yang valid' };
}

// Buang spasi di awal/akhir teks sebelum disimpan.
function bersihkan(data) {
  const hasil = {};
  for (const [k, v] of Object.entries(data)) hasil[k] = typeof v === 'string' ? v.trim() : v;
  return hasil;
}

module.exports = { validasiId, validasiBuat, validasiUbah, bacaJson, bersihkan };
