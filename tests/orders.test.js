// Unit test OrdersFn dengan node:test dan DynamoDB tiruan (tanpa library tambahan).
// Modul src/utils/dynamodb.js diganti lewat require.cache sebelum handler dimuat,
// jadi AWS SDK tidak perlu dipasang dan tidak ada panggilan ke AWS.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---------- DynamoDB tiruan (disimpan di Map) ----------

const tabel = new Map();
let errorBerikutnya = null; // untuk mensimulasikan DynamoDB gagal

class Perintah {
  constructor(input) {
    this.input = input;
  }
}
class GetCommand extends Perintah {}
class PutCommand extends Perintah {}
class UpdateCommand extends Perintah {}
class DeleteCommand extends Perintah {}

function errorKondisi() {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

const db = {
  async send(cmd) {
    if (errorBerikutnya) {
      const e = errorBerikutnya;
      errorBerikutnya = null;
      throw e;
    }
    const { input } = cmd;
    if (cmd instanceof PutCommand) {
      if (input.ConditionExpression && tabel.has(input.Item.orderId)) throw errorKondisi();
      tabel.set(input.Item.orderId, structuredClone(input.Item));
      return {};
    }
    const id = input.Key.orderId;
    if (cmd instanceof GetCommand) {
      return { Item: tabel.has(id) ? structuredClone(tabel.get(id)) : undefined };
    }
    if (cmd instanceof DeleteCommand) {
      if (input.ConditionExpression && !tabel.has(id)) throw errorKondisi();
      tabel.delete(id);
      return {};
    }
    if (cmd instanceof UpdateCommand) {
      if (input.ConditionExpression && !tabel.has(id)) throw errorKondisi();
      const item = tabel.get(id);
      // Terapkan "SET #a = :a, #b = :b"
      for (const bagian of input.UpdateExpression.replace(/^SET /, '').split(',')) {
        const [nama, nilai] = bagian.split('=').map((s) => s.trim());
        item[input.ExpressionAttributeNames[nama]] = input.ExpressionAttributeValues[nilai];
      }
      return { Attributes: structuredClone(item) };
    }
    throw new Error('Perintah tidak dikenal');
  },
};

const ROOT = path.join(__dirname, '..');
require.cache[path.join(ROOT, 'src/utils/dynamodb.js')] = {
  exports: { db, TABLE_NAME: 'orders', GetCommand, PutCommand, UpdateCommand, DeleteCommand },
};

// ---------- Siapkan handler ----------

const KUNCI_PELANGGAN = 'kunci-pelanggan-rahasia-111';
const KUNCI_PENJUAL = 'kunci-penjual-rahasia-222';
process.env.KEY_PELANGGAN = KUNCI_PELANGGAN;
process.env.KEY_PENJUAL = KUNCI_PENJUAL;

const { handler } = require(path.join(ROOT, 'src/index.js'));

// Buat event seperti yang dikirim Lambda Function URL.
function permintaan(method, rawPath, kunci, body) {
  return {
    rawPath,
    requestContext: { http: { method } },
    headers: kunci ? { 'x-api-key': kunci } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

// Panggil handler, kembalikan { status, data }.
async function panggil(...args) {
  const res = await handler(permintaan(...args));
  let data = res.body;
  if (res.headers['content-type'].startsWith('application/json')) data = JSON.parse(res.body);
  return { status: res.statusCode, data, headers: res.headers };
}

const PESANAN = { customerName: 'Budi', item: 'Nasi goreng', quantity: 2 };
const ID_TIDAK_ADA = '00000000-0000-4000-8000-000000000000';

async function buatPesanan() {
  const { data } = await panggil('POST', '/orders', KUNCI_PELANGGAN, PESANAN);
  return data.orderId;
}

// Log CloudWatch tidak perlu tampil saat tes; disimpan untuk diperiksa.
let log = [];
beforeEach((t) => {
  tabel.clear();
  errorBerikutnya = null;
  log = [];
  const simpan = (...args) => log.push(args.map(String).join(' '));
  t.mock.method(console, 'log', simpan);
  t.mock.method(console, 'error', simpan);
});

// ---------- Halaman web ----------

test('GET /, /style.css, /app.js disajikan tanpa kunci', async () => {
  for (const [p, tipe] of [['/', 'text/html'], ['/style.css', 'text/css'], ['/app.js', 'text/javascript']]) {
    const r = await panggil('GET', p);
    assert.equal(r.status, 200, p);
    assert.ok(r.headers['content-type'].startsWith(tipe), p);
  }
});

// ---------- 401 ----------

test('401 tanpa kunci', async () => {
  const r = await panggil('GET', `/orders/${ID_TIDAK_ADA}`);
  assert.equal(r.status, 401);
  assert.match(r.data.error, /Kunci API/);
});

test('401 kunci salah', async () => {
  const r = await panggil('POST', '/orders', 'kunci-ngawur', PESANAN);
  assert.equal(r.status, 401);
});

test('401 didahulukan sebelum 404 rute', async () => {
  const r = await panggil('GET', '/tidak-ada', 'kunci-ngawur');
  assert.equal(r.status, 401);
});

test('header X-Api-Key tidak peka huruf besar/kecil', async () => {
  const ev = permintaan('GET', `/orders/${ID_TIDAK_ADA}`);
  ev.headers = { 'X-API-KEY': KUNCI_PENJUAL };
  const res = await handler(ev);
  assert.equal(res.statusCode, 404);
});

// ---------- 404 rute ----------

test('404 rute tidak ada', async () => {
  assert.equal((await panggil('GET', '/menu', KUNCI_PENJUAL)).status, 404);
  assert.equal((await panggil('PATCH', `/orders/${ID_TIDAK_ADA}`, KUNCI_PENJUAL)).status, 404);
  assert.equal((await panggil('GET', '/orders', KUNCI_PENJUAL)).status, 404);
});

// ---------- 403 ----------

test('403 penjual tidak boleh POST', async () => {
  const r = await panggil('POST', '/orders', KUNCI_PENJUAL, PESANAN);
  assert.equal(r.status, 403);
  assert.equal(tabel.size, 0);
});

test('403 pelanggan tidak boleh PUT dan DELETE', async () => {
  const id = await buatPesanan();
  assert.equal((await panggil('PUT', `/orders/${id}`, KUNCI_PELANGGAN, { status: 'done' })).status, 403);
  assert.equal((await panggil('DELETE', `/orders/${id}`, KUNCI_PELANGGAN)).status, 403);
  assert.equal(tabel.get(id).status, 'pending'); // tidak berubah
});

test('403 didahulukan sebelum 400 (body rusak)', async () => {
  const r = await panggil('POST', '/orders', KUNCI_PENJUAL, '{rusak');
  assert.equal(r.status, 403);
});

// ---------- Alur utama ----------

test('201 pelanggan membuat pesanan: field server terisi', async () => {
  const r = await panggil('POST', '/orders', KUNCI_PELANGGAN, { customerName: '  Budi  ', item: 'Es teh', quantity: 3 });
  assert.equal(r.status, 201);
  assert.match(r.data.orderId, /^[0-9a-f-]{36}$/);
  assert.equal(r.data.customerName, 'Budi'); // spasi dibuang
  assert.equal(r.data.status, 'pending');
  assert.equal(new Date(r.data.createdAt).toISOString(), r.data.createdAt); // ISO UTC
  assert.deepEqual(tabel.get(r.data.orderId), r.data);
});

test('200 pelanggan dan penjual bisa GET pesanan', async () => {
  const id = await buatPesanan();
  for (const kunci of [KUNCI_PELANGGAN, KUNCI_PENJUAL]) {
    const r = await panggil('GET', `/orders/${id}`, kunci);
    assert.equal(r.status, 200);
    assert.equal(r.data.orderId, id);
  }
});

test('200 penjual menandai selesai dan mengubah isi', async () => {
  const id = await buatPesanan();
  const r = await panggil('PUT', `/orders/${id}`, KUNCI_PENJUAL, { status: 'done', quantity: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'done');
  assert.equal(r.data.quantity, 5);
  assert.equal(r.data.item, PESANAN.item); // field lain tetap
});

test('200 penjual menghapus pesanan, lalu GET jadi 404', async () => {
  const id = await buatPesanan();
  const r = await panggil('DELETE', `/orders/${id}`, KUNCI_PENJUAL);
  assert.equal(r.status, 200);
  assert.equal(r.data.orderId, id);
  assert.equal((await panggil('GET', `/orders/${id}`, KUNCI_PENJUAL)).status, 404);
});

// ---------- 400 validasi ----------

test('400 validasi POST', async () => {
  const kasus = [
    ['{rusak', /JSON/],
    [[1, 2], /objek JSON/],
    [{ item: 'Es teh', quantity: 1 }, /customerName.*wajib/],
    [{ ...PESANAN, customerName: '' }, /customerName harus 1-100/],
    [{ ...PESANAN, customerName: '   ' }, /customerName harus 1-100/],
    [{ ...PESANAN, item: 'x'.repeat(101) }, /item harus 1-100/],
    [{ ...PESANAN, item: 123 }, /item harus berupa teks/],
    [{ ...PESANAN, quantity: 0 }, /quantity/],
    [{ ...PESANAN, quantity: -1 }, /quantity/],
    [{ ...PESANAN, quantity: 1.5 }, /quantity/],
    [{ ...PESANAN, quantity: '2' }, /quantity/],
    [{ ...PESANAN, status: 'done' }, /status.*tidak boleh/],
    [{ ...PESANAN, orderId: ID_TIDAK_ADA }, /orderId.*tidak boleh/],
  ];
  for (const [body, pesan] of kasus) {
    const r = await panggil('POST', '/orders', KUNCI_PELANGGAN, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.data.error, pesan, JSON.stringify(body));
  }
  assert.equal(tabel.size, 0);
});

test('batas panjang teks: 100 karakter boleh', async () => {
  const r = await panggil('POST', '/orders', KUNCI_PELANGGAN, { ...PESANAN, item: 'x'.repeat(100) });
  assert.equal(r.status, 201);
});

test('400 validasi PUT', async () => {
  const id = await buatPesanan();
  const kasus = [
    [{}, /Minimal satu field/],
    [{ status: 'selesai' }, /status harus/],
    [{ quantity: 0 }, /quantity/],
    [{ createdAt: '2020-01-01T00:00:00.000Z' }, /createdAt.*tidak boleh/],
    [{ orderId: ID_TIDAK_ADA }, /orderId.*tidak boleh/],
  ];
  for (const [body, pesan] of kasus) {
    const r = await panggil('PUT', `/orders/${id}`, KUNCI_PENJUAL, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.data.error, pesan, JSON.stringify(body));
  }
  assert.equal(tabel.get(id).status, 'pending');
});

test('400 ID bukan UUID (GET, PUT, DELETE)', async () => {
  assert.equal((await panggil('GET', '/orders/abc', KUNCI_PELANGGAN)).status, 400);
  assert.equal((await panggil('PUT', '/orders/abc', KUNCI_PENJUAL, { status: 'done' })).status, 400);
  assert.equal((await panggil('DELETE', '/orders/abc', KUNCI_PENJUAL)).status, 400);
});

test('400 didahulukan sebelum 404 pesanan', async () => {
  const r = await panggil('PUT', `/orders/${ID_TIDAK_ADA}`, KUNCI_PENJUAL, { status: 'salah' });
  assert.equal(r.status, 400);
});

// ---------- 404 pesanan tidak ada ----------

test('404 pesanan tidak ada (GET, PUT, DELETE)', async () => {
  assert.equal((await panggil('GET', `/orders/${ID_TIDAK_ADA}`, KUNCI_PELANGGAN)).status, 404);
  assert.equal((await panggil('PUT', `/orders/${ID_TIDAK_ADA}`, KUNCI_PENJUAL, { status: 'done' })).status, 404);
  assert.equal((await panggil('DELETE', `/orders/${ID_TIDAK_ADA}`, KUNCI_PENJUAL)).status, 404);
  assert.equal(tabel.size, 0); // PUT tidak membuat pesanan baru
});

// ---------- Error server & log ----------

test('500 bila DynamoDB gagal, tanpa membocorkan detail', async () => {
  errorBerikutnya = new Error('koneksi terputus');
  const r = await panggil('GET', `/orders/${ID_TIDAK_ADA}`, KUNCI_PELANGGAN);
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.data.error, /koneksi/);
});

test('kunci API tidak pernah tercetak di log', async () => {
  const id = await buatPesanan();
  await panggil('GET', `/orders/${id}`, KUNCI_PENJUAL);
  await panggil('PUT', `/orders/${id}`, KUNCI_PELANGGAN, { status: 'done' });
  await panggil('GET', '/tidak-ada', 'kunci-salah-xyz');
  errorBerikutnya = new Error('gagal');
  await panggil('DELETE', `/orders/${id}`, KUNCI_PENJUAL);

  assert.ok(log.length >= 5, 'setiap permintaan harus tercatat di log');
  const semua = log.join('\n');
  for (const kunci of [KUNCI_PELANGGAN, KUNCI_PENJUAL, 'kunci-salah-xyz']) {
    assert.ok(!semua.includes(kunci), `kunci "${kunci}" bocor ke log`);
  }
  // Log tetap berguna: berisi method, path, role, dan status.
  assert.match(semua, /"method":"PUT".*"role":"pelanggan".*"status":403/);
});
