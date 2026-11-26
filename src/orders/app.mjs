// Logika HTTP Simple Orders: routing, cek kunci API, cek role, dan format respons.
// File ini tidak memanggil AWS langsung. Aksi CRUD disuntikkan lewat buatHandler()
// supaya mudah diuji dengan DynamoDB tiruan.
import { createHash, timingSafeEqual } from 'node:crypto';

// Error yang membawa kode status HTTP. Dilempar oleh aksi (mis. 400, 404).
export class HttpError extends Error {
  constructor(status, pesan) {
    super(pesan);
    this.status = status;
  }
}

// Daftar rute: method, path (untuk pesan), pola path, role yang boleh, dan nama aksi.
const RUTE = [
  { method: 'POST',   path: '/orders',      pola: /^\/orders$/,          role: ['pelanggan'],            aksi: 'buatPesanan' },
  { method: 'GET',    path: '/orders/{id}', pola: /^\/orders\/([^/]+)$/, role: ['pelanggan', 'penjual'], aksi: 'ambilPesanan' },
  { method: 'PUT',    path: '/orders/{id}', pola: /^\/orders\/([^/]+)$/, role: ['penjual'],              aksi: 'ubahPesanan' },
  { method: 'DELETE', path: '/orders/{id}', pola: /^\/orders\/([^/]+)$/, role: ['penjual'],              aksi: 'hapusPesanan' },
];

// Bandingkan dua string tanpa membocorkan info lewat waktu eksekusi (timing attack).
// Di-hash dulu supaya panjangnya selalu sama (syarat timingSafeEqual).
function samaAman(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Tentukan role dari kunci API. Mengembalikan 'pelanggan', 'penjual', atau null.
export function cariRole(kunci, keys) {
  if (!kunci) return null;
  if (keys.pelanggan && samaAman(kunci, keys.pelanggan)) return 'pelanggan';
  if (keys.penjual && samaAman(kunci, keys.penjual)) return 'penjual';
  return null;
}

// Ambil nilai header tanpa peduli huruf besar/kecil.
function ambilHeader(event, nama) {
  const headers = event.headers || {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === nama) return v;
  }
  return undefined;
}

// Ubah body permintaan menjadi objek JSON. Body kosong/rusak -> 400.
export function bacaJson(event) {
  let teks = event.body || '';
  if (event.isBase64Encoded) teks = Buffer.from(teks, 'base64').toString('utf8');
  let data;
  try {
    data = JSON.parse(teks);
  } catch {
    throw new HttpError(400, 'Body harus berupa JSON yang valid');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'Body harus berupa objek JSON');
  }
  return data;
}

function json(status, data) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(data),
  };
}

function halaman(html) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: html,
  };
}

// Proses satu permintaan. Urutan cek:
// 401 kunci salah -> 404 rute tidak ada -> 403 role tidak boleh
// -> 400 input salah -> 404 pesanan tidak ada (dua terakhir dicek di dalam aksi).
async function proses(event, { keys, aksi, html }, info) {
  const method = event.requestContext?.http?.method || 'GET';
  const path = (event.rawPath || '/').replace(/\/+$/, '') || '/';
  info.method = method;
  info.path = path;

  // Halaman web bersifat publik, tidak butuh kunci.
  if (method === 'GET' && path === '/') return halaman(html);

  const role = cariRole(ambilHeader(event, 'x-api-key'), keys);
  if (!role) throw new HttpError(401, 'Kunci API salah atau tidak ada');
  info.role = role;

  const rute = RUTE.find((r) => r.method === method && r.pola.test(path));
  if (!rute) throw new HttpError(404, 'Rute tidak ditemukan');

  if (!rute.role.includes(role)) {
    throw new HttpError(403, `Role ${role} tidak boleh mengakses ${rute.method} ${rute.path}`);
  }

  // Sementara (tahap 2): aksi CRUD belum dibuat.
  if (!aksi[rute.aksi]) throw new HttpError(501, 'Aksi belum dibuat');

  const id = path.match(rute.pola)[1]; // undefined untuk POST /orders
  const hasil = await aksi[rute.aksi]({ id, event });
  return json(hasil.status, hasil.data);
}

// Buat handler Lambda.
// keys: { pelanggan, penjual } - kunci API dari env var
// aksi: { buatPesanan, ambilPesanan, ubahPesanan, hapusPesanan } - fungsi CRUD
// html: isi halaman web untuk GET /
export function buatHandler({ keys, aksi, html }) {
  return async function handler(event) {
    const info = { method: '-', path: '-', role: '-' };
    let res;
    try {
      res = await proses(event, { keys, aksi, html }, info);
    } catch (e) {
      if (e instanceof HttpError) {
        res = json(e.status, { error: e.message });
      } else {
        console.error('Error tak terduga:', e);
        res = json(500, { error: 'Terjadi kesalahan di server' });
      }
    }
    // Satu baris log per permintaan. Kunci API TIDAK pernah dicatat.
    console.log(JSON.stringify({ ...info, status: res.statusCode }));
    return res;
  };
}
