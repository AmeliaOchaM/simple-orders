# Simple Orders

Aplikasi web sederhana untuk mencatat pesanan kantin. Pelanggan membuat dan mengecek pesanan, sedangkan penjual menandai pesanan selesai atau menghapusnya. Dibuat untuk AWS Academy Sandbox dengan Node.js 22, tanpa framework dan tanpa library tambahan selain AWS SDK v3 (sudah tersedia di runtime Lambda).

## Arsitektur

```
Browser ──HTTPS──> Lambda Function URL (auth NONE)
                        │
                        ▼
                   Lambda OrdersFn ───────> DynamoDB tabel "orders"
                   (index.handler)              ▲
                        │                       │ CreateTable (saat deploy)
                        ▼                       │
                   CloudWatch Logs        Lambda TableCreatorFn
                                          (Custom Resource CloudFormation)
```

- **Satu Lambda (`OrdersFn`)** menyajikan halaman web (`GET /`, `/style.css`, `/app.js`) dan API `/orders`. Tidak perlu S3 website atau API Gateway.
- **`TableCreatorFn`** membuat tabel lewat CloudFormation Custom Resource, karena user sandbox tidak boleh `CreateTable`.
- **Autentikasi** memakai header `X-Api-Key`. Ada satu kunci per role (`KEY_PELANGGAN`, `KEY_PENJUAL`), dikirim sebagai parameter CloudFormation `NoEcho`, dan tidak pernah dicetak ke log.

## API

Semua rute `/orders` wajib memakai header `X-Api-Key`. Balasan berupa JSON, dan error berbentuk `{"error": "pesan"}`.

| Method | Path | Pelanggan | Penjual | Sukses |
|---|---|:-:|:-:|---|
| `POST` | `/orders` | ✅ | ❌ | `201` pesanan baru |
| `GET` | `/orders/{id}` | ✅ | ✅ | `200` pesanan |
| `PUT` | `/orders/{id}` | ❌ | ✅ | `200` pesanan setelah diubah |
| `DELETE` | `/orders/{id}` | ❌ | ✅ | `200` `{"message","orderId"}` |
| `GET` | `/`, `/style.css`, `/app.js` | publik | publik | halaman web |

Urutan pengecekan:

1. `401`: kunci tidak ada atau salah
2. `404`: rute tidak ada
3. `403`: role tidak boleh memakai rute ini
4. `400`: input salah (JSON rusak, field tidak valid, ID bukan UUID)
5. `404`: pesanan tidak ditemukan

Error tak terduga dibalas `500` dengan pesan umum. Detailnya hanya ada di log.

Contoh:

```bash
source .env
curl -X POST "$API_URL/orders" -H "X-Api-Key: $KEY_PELANGGAN" \
  -H 'Content-Type: application/json' \
  -d '{"customerName":"Budi","item":"Nasi goreng","quantity":2}'

curl -X PUT "$API_URL/orders/<orderId>" -H "X-Api-Key: $KEY_PENJUAL" \
  -H 'Content-Type: application/json' -d '{"status":"done"}'
```

## Data pesanan

| Field | Tipe | Aturan |
|---|---|---|
| `orderId` | String (PK) | UUID, dibuat server |
| `customerName` | String | 1–100 karakter (spasi di awal/akhir dibuang) |
| `item` | String | 1–100 karakter |
| `quantity` | Number | bilangan bulat > 0 |
| `status` | String | `pending` atau `done`. Selalu `pending` saat dibuat. |
| `createdAt` | String | waktu ISO 8601 UTC, dibuat server |

- `POST` hanya menerima `customerName`, `item`, dan `quantity`.
- `PUT` menerima sebagian dari `customerName`, `item`, `quantity`, dan `status` (minimal satu).
- Field lain ditolak dengan `400`.

## Struktur folder

```
src/
  index.js                  handler OrdersFn: routing, cek kunci & role, sajikan web/
  handlers/
    createOrder.js          POST /orders
    getOrder.js             GET /orders/{id}
    updateOrder.js          PUT /orders/{id}
    deleteOrder.js          DELETE /orders/{id}
    setupDatabase.js        Custom Resource TableCreator (buat/hapus tabel)
  utils/
    auth.js                 cek X-Api-Key + matriks role
    dynamodb.js             DynamoDBDocumentClient + TABLE_NAME
    validate.js             validasi input pesanan
    response.js             helper balasan JSON
  web/
    index.html, style.css, app.js   halaman web (HTML + JS biasa)
infra/template.yaml         CloudFormation: kedua Lambda, tabel, Function URL, izin
scripts/
  deploy.sh                 zip src/ -> S3 -> cloudformation deploy -> .env
  test-api.sh               tes end-to-end dengan curl (14 tes)
  teardown.sh               hapus stack dan bucket kode
tests/orders.test.js        unit test (node:test + DynamoDB tiruan)
docs/deployment-plan.md     rencana deploy, verifikasi, rollback, persistensi
```

## Deploy (AWS CloudShell, us-east-1)

```bash
git clone <url-repo> simple-orders && cd simple-orders
bash scripts/deploy.sh               # atau: RETAIN=true bash scripts/deploy.sh
bash scripts/test-api.sh             # harap: 14 OK, 0 GAGAL
cat .env                             # API_URL dan kedua kunci API
```

Buka `API_URL` di browser, pilih role, lalu tempel kuncinya.

Untuk membongkar: `bash scripts/teardown.sh`. Tabel ikut terhapus, kecuali deploy terakhir memakai `RETAIN=true`.

Detail langkah, verifikasi, rollback, dan skenario persistensi ada di [docs/deployment-plan.md](docs/deployment-plan.md).

## Tes lokal

Butuh Node.js 22 atau lebih baru. **Tidak perlu `npm install`.** Test mengganti modul `src/utils/dynamodb.js` dengan DynamoDB tiruan berbasis `Map`, jadi tidak ada panggilan ke AWS.

```bash
npm test
```

Yang diuji:

- `401` tanpa kunci atau kunci salah, `404` rute, `403` (penjual POST, pelanggan PUT/DELETE)
- Alur `201`/`200`, `400` validasi, `404` pesanan tidak ada, dan `500` saat DynamoDB gagal
- Urutan pengecekan
- Kunci API tidak pernah muncul di log
