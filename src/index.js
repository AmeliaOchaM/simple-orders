// Handler utama OrdersFn (handler: index.handler).
// - GET /, /style.css, /app.js -> file halaman web (publik, tanpa kunci)
// - /orders...                  -> API, diteruskan ke handlers/
// - {"action": ...} via invoke  -> kelola tabel (handlers/setupDatabase.js)
const fs = require('node:fs');
const path = require('node:path');
const { kunciBenar } = require('./utils/auth');
const { gagal, teks } = require('./utils/response');
const setupDatabase = require('./handlers/setupDatabase');

// Daftar rute API.
const RUTE = [
  { method: 'POST', pola: /^\/orders$/, fn: require('./handlers/createOrder') },
  { method: 'GET', pola: /^\/orders\/([^/]+)$/, fn: require('./handlers/getOrder') },
  { method: 'PUT', pola: /^\/orders\/([^/]+)$/, fn: require('./handlers/updateOrder') },
  { method: 'DELETE', pola: /^\/orders\/([^/]+)$/, fn: require('./handlers/deleteOrder') },
];

// File web dibaca sekali saat cold start, lalu disimpan di memori.
const WEB = {};
for (const [url, file, tipe] of [
  ['/', 'index.html', 'text/html'],
  ['/style.css', 'style.css', 'text/css'],
  ['/app.js', 'app.js', 'text/javascript'],
]) {
  WEB[url] = { tipe: `${tipe}; charset=utf-8`, isi: fs.readFileSync(path.join(__dirname, 'web', file), 'utf8') };
}

// Urutan cek: 401 kunci salah -> 404 rute tidak ada -> 400 input salah
// -> 404 pesanan tidak ada (dua terakhir di dalam handlers/).
async function proses(event, log) {
  const method = event.requestContext?.http?.method || 'GET';
  const p = (event.rawPath || '/').replace(/\/+$/, '') || '/';
  log.method = method;
  log.path = p;

  if (method === 'GET' && WEB[p]) return teks(200, WEB[p].tipe, WEB[p].isi);

  if (!kunciBenar(event.headers)) return gagal(401, 'Kunci API salah atau tidak ada');

  const rute = RUTE.find((r) => r.method === method && r.pola.test(p));
  if (!rute) return gagal(404, 'Rute tidak ditemukan');

  const id = p.match(rute.pola)[1]; // undefined untuk POST /orders
  return rute.fn(event, id);
}

exports.handler = async (event) => {
  // Dipanggil langsung lewat "aws lambda invoke" (tanpa requestContext, jadi bukan
  // lewat Function URL): kelola tabel. Permintaan dari URL selalu punya requestContext,
  // sehingga jalur ini tidak bisa dipicu dari internet.
  if (event && event.action && !event.requestContext) return setupDatabase.handler(event);

  const log = { method: '-', path: '-' };
  let res;
  try {
    res = await proses(event, log);
  } catch (e) {
    console.error('Error tak terduga:', e.name, e.message);
    res = gagal(500, 'Terjadi kesalahan di server');
  }
  // Satu baris log per permintaan ke CloudWatch. Kunci API TIDAK pernah dicatat.
  console.log(JSON.stringify({ ...log, status: res.statusCode }));
  return res;
};
