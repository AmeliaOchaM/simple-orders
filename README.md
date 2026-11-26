# Simple Orders

Aplikasi web sederhana untuk mencatat pesanan kantin. Pembeli membuat pesanan, mengeceknya dengan ID, menandainya diterima, atau membatalkannya. Dibuat untuk AWS Academy Sandbox dengan Node.js 22, tanpa framework dan tanpa library tambahan selain AWS SDK v3 (sudah tersedia di runtime Lambda).

## Arsitektur

```
Browser ──HTTPS──> Lambda Function URL (auth NONE)
                        │
                        ▼
                   Lambda OrdersFn ───────> DynamoDB tabel "orders"
                   (index.handler)              ▲
                        │                       │ CreateTable / DeleteTable
                        ▼                       │
                   CloudWatch Logs    aws lambda invoke {"action":"setupDatabase"}
                                      (dari deploy.sh / teardown.sh)
```

- **Satu Lambda (`OrdersFn`)** menyajikan halaman web (`GET /`, `/style.css`, `/app.js`) dan API `/orders`. Tidak perlu S3 atau API Gateway.
- **Tanpa S3 dan tanpa Custom Resource.** CloudFormation hanya membuat fungsi (kode placeholder), Function URL, dan izin. `deploy.sh` mengunggah kode dengan `aws lambda update-function-code`, lalu membuat tabel dengan memanggil `OrdersFn` langsung (`{"action":"setupDatabase"}`). Cara ini dipakai karena user sandbox tidak boleh `CreateTable`, sedangkan `LabRole` boleh.
- **Action tabel hanya lewat invoke langsung.** Event yang punya `requestContext` (dari Function URL) selalu diproses sebagai HTTP, jadi action tidak bisa dipicu dari internet.
- **Autentikasi** memakai header `X-Api-Key` dengan satu kunci pembeli (`KEY_PEMBELI`). Kunci ini dikirim sebagai parameter CloudFormation `NoEcho` dan tidak pernah dicetak ke log. Tidak ada role: siapa pun yang memegang kunci boleh memakai semua rute.

## API

Semua rute `/orders` wajib memakai header `X-Api-Key`. Balasan berupa JSON, dan error berbentuk `{"error": "pesan"}`.

| Method | Path | Kunci | Sukses |
|---|---|:-:|---|
| `POST` | `/orders` | wajib | `201` pesanan baru |
| `GET` | `/orders/{id}` | wajib | `200` pesanan |
| `PUT` | `/orders/{id}` | wajib | `200` pesanan setelah diubah (misalnya `{"status":"done"}` = diterima) |
| `DELETE` | `/orders/{id}` | wajib | `200` `{"message","orderId"}` (pesanan dibatalkan) |
| `GET` | `/`, `/style.css`, `/app.js` | tidak | halaman web |

Selain rute HTTP, `OrdersFn` menerima dua action lewat `aws lambda invoke` (butuh kredensial AWS): `{"action":"setupDatabase"}` untuk membuat tabel (atau memakai ulang), dan `{"action":"deleteDatabase"}` untuk menghapus tabel.

Urutan pengecekan:

1. `401`: kunci tidak ada atau salah
2. `404`: rute tidak ada
3. `400`: input salah (JSON rusak, field tidak valid, ID bukan UUID)
4. `404`: pesanan tidak ditemukan

Error tak terduga dibalas `500` dengan pesan umum. Detailnya hanya ada di log.

Contoh:

```bash
source .env
curl -X POST "$API_URL/orders" -H "X-Api-Key: $KEY_PEMBELI" \
  -H 'Content-Type: application/json' \
  -d '{"customerName":"Budi","item":"Nasi goreng","quantity":2}'

curl -X PUT "$API_URL/orders/<orderId>" -H "X-Api-Key: $KEY_PEMBELI" \
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
  index.js                  handler OrdersFn: routing, cek kunci, sajikan web/
  handlers/
    createOrder.js          POST /orders
    getOrder.js             GET /orders/{id}
    updateOrder.js          PUT /orders/{id}
    deleteOrder.js          DELETE /orders/{id}
    setupDatabase.js        action setupDatabase / deleteDatabase (buat/hapus tabel)
  utils/
    auth.js                 cek X-Api-Key (kunciBenar)
    dynamodb.js             DynamoDB client + DocumentClient + TABLE_NAME
    validate.js             validasi input pesanan
    response.js             helper balasan JSON
  web/
    index.html, style.css, app.js   halaman web (HTML + JS biasa)
infra/template.yaml         CloudFormation: OrdersFn (placeholder), Function URL, 2 izin
scripts/
  deploy.sh                 cloudformation deploy -> update-function-code -> setupDatabase -> .env
  test-api.sh               tes end-to-end dengan curl (10 tes)
  teardown.sh               deleteDatabase (kecuali RETAIN=true) -> hapus stack
tests/orders.test.js        unit test (node:test + DynamoDB tiruan)
docs/deployment-plan.md     rencana deploy, verifikasi, rollback, persistensi
```

## Deploy (AWS CloudShell, us-east-1)

```bash
git clone <url-repo> simple-orders && cd simple-orders
bash scripts/deploy.sh               # aman dijalankan berulang
bash scripts/test-api.sh             # harap: 10 OK, 0 GAGAL
cat .env                             # API_URL dan KEY_PEMBELI
```

Buka `API_URL` di browser lalu tempel `KEY_PEMBELI`.

Untuk membongkar:

```bash
bash scripts/teardown.sh               # hapus tabel (beserta data) + stack
RETAIN=true bash scripts/teardown.sh   # simpan tabel; deploy ulang -> data tetap ada
```

Detail langkah, verifikasi, rollback, dan skenario persistensi ada di [docs/deployment-plan.md](docs/deployment-plan.md).

## Tes lokal

Butuh Node.js 22 atau lebih baru. **Tidak perlu `npm install`.** Test mengganti modul `src/utils/dynamodb.js` dengan DynamoDB tiruan berbasis `Map`, jadi tidak ada panggilan ke AWS.

```bash
npm test
```

Yang diuji:

- `401` tanpa kunci atau kunci salah, dan `404` rute
- Alur `201`/`200`, `400` validasi, `404` pesanan tidak ada, dan `500` saat DynamoDB gagal
- Urutan pengecekan
- Kunci API tidak pernah muncul di log
- Action `setupDatabase` / `deleteDatabase` (termasuk aman diulang), dan action yang dikirim lewat URL diabaikan
