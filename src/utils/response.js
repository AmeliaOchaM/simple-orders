// Helper untuk membuat balasan HTTP (format Lambda Function URL).

// Balasan JSON. cache-control no-store supaya data pesanan tidak disimpan browser.
function json(status, data) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(data),
  };
}

// Balasan error dengan bentuk seragam: { "error": "pesan" }.
function gagal(status, pesan) {
  return json(status, { error: pesan });
}

// Balasan teks biasa (dipakai untuk file web: HTML, CSS, JS).
function teks(status, tipe, isi) {
  return { statusCode: status, headers: { 'content-type': tipe }, body: isi };
}

module.exports = { json, gagal, teks };
