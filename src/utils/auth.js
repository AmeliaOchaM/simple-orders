// Cek kunci API (header X-Api-Key) dan matriks role.
// Kunci dibaca dari env var KEY_PELANGGAN dan KEY_PENJUAL. Jangan pernah dicetak ke log.
const { createHash, timingSafeEqual } = require('node:crypto');

// Matriks role: rute -> role yang boleh mengakses.
const MATRIKS = {
  'POST /orders': ['pelanggan'],
  'GET /orders/{id}': ['pelanggan', 'penjual'],
  'PUT /orders/{id}': ['penjual'],
  'DELETE /orders/{id}': ['penjual'],
};

// Bandingkan dua string dengan waktu konstan (mencegah timing attack).
// Di-hash dulu supaya panjangnya selalu sama, syarat timingSafeEqual.
function samaAman(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Tentukan role dari header. Hasil: 'pelanggan', 'penjual', atau null (kunci salah/kosong).
function cariRole(headers = {}) {
  const pasangan = Object.entries(headers).find(([k]) => k.toLowerCase() === 'x-api-key');
  const kunci = pasangan && pasangan[1];
  if (!kunci) return null;

  const { KEY_PELANGGAN, KEY_PENJUAL } = process.env;
  if (KEY_PELANGGAN && samaAman(kunci, KEY_PELANGGAN)) return 'pelanggan';
  if (KEY_PENJUAL && samaAman(kunci, KEY_PENJUAL)) return 'penjual';
  return null;
}

// Apakah role boleh mengakses rute ini (mis. 'PUT /orders/{id}')?
function bolehAkses(role, rute) {
  return (MATRIKS[rute] || []).includes(role);
}

module.exports = { MATRIKS, cariRole, bolehAkses };
