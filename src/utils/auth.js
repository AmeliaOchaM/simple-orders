// Cek kunci API (header X-Api-Key).
// Kunci dibaca dari env var KEY_PEMBELI. Jangan pernah dicetak ke log.
const { createHash, timingSafeEqual } = require('node:crypto');

// Bandingkan dua string dengan waktu konstan (mencegah timing attack).
// Di-hash dulu supaya panjangnya selalu sama, syarat timingSafeEqual.
function samaAman(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// true bila header X-Api-Key sama dengan KEY_PEMBELI. Kunci kosong selalu ditolak.
function kunciBenar(headers = {}) {
  const pasangan = Object.entries(headers).find(([k]) => k.toLowerCase() === 'x-api-key');
  const kunci = pasangan && pasangan[1];
  const { KEY_PEMBELI } = process.env;
  return Boolean(kunci && KEY_PEMBELI && samaAman(kunci, KEY_PEMBELI));
}

module.exports = { kunciBenar };
