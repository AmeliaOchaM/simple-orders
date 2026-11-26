# Deployment Plan: Simple Orders

Dokumen ini menjelaskan cara memasang, memverifikasi, dan membongkar Simple Orders di AWS Academy Sandbox. Deploy ini **tidak memakai S3 dan tidak memakai Custom Resource**.

## 1. Lingkungan

| Hal | Nilai |
|---|---|
| Akun | AWS Academy Sandbox |
| Region | `us-east-1` |
| Tempat menjalankan skrip | AWS CloudShell (sudah ada `aws`, `zip`, `openssl`, `curl`) |
| Runtime Lambda | Node.js 22 (`nodejs22.x`), AWS SDK v3 bawaan runtime |
| IAM role | `LabRole` (bawaan, tidak bisa membuat role baru) |
| Nama stack | `simple-orders` (bisa diganti dengan env var `STACK`) |

## 2. Daftar resource

| Resource | Dibuat oleh | Fungsi |
|---|---|---|
| `OrdersFn` (Lambda) | CloudFormation | Handler `index.handler`. API pesanan, halaman web, dan pengelola tabel (action). Awalnya berisi kode placeholder inline, lalu kode asli diunggah `deploy.sh`. |
| `OrdersFnUrl` (Function URL) | CloudFormation | Endpoint publik, `AuthType: NONE`. |
| `OrdersFnUrlPermission` | CloudFormation | `lambda:InvokeFunctionUrl` untuk `*` (`FunctionUrlAuthType: NONE`). |
| `OrdersFnInvokePermission` | CloudFormation | `lambda:InvokeFunction` untuk `*`, hanya bila `InvokedViaFunctionUrl: true`. |
| Tabel DynamoDB `orders` | `deploy.sh`, lewat invoke `{"action":"setupDatabase"}` | PK `orderId` (String), mode `PAY_PER_REQUEST`. **Tidak** dikelola CloudFormation. |
| Log group `/aws/lambda/<nama-fungsi>` | Lambda (otomatis) | Log setiap permintaan. |

Parameter template: `KeyPelanggan` dan `KeyPenjual` (`NoEcho`, minimal 16 karakter), yang menjadi env var `KEY_PELANGGAN` dan `KEY_PENJUAL`. Env var `TABLE_NAME` bernilai tetap `orders`.

Output: `FunctionUrl` dan `FunctionName`.

### Mengapa tabel dibuat lewat invoke?

User sandbox tidak boleh `dynamodb:CreateTable`, tapi `LabRole` boleh. Karena itu `deploy.sh` memanggil `OrdersFn` secara langsung:

```bash
aws lambda invoke --function-name <OrdersFn> --cli-binary-format raw-in-base64-out \
  --payload '{"action":"setupDatabase"}' hasil.json
```

`src/index.js` mengenali panggilan ini karena event-nya berisi `action` dan **tidak** punya `requestContext`. Permintaan lewat Function URL selalu punya `requestContext`, jadi jalur ini tidak bisa dipicu dari internet. Invoke langsung juga butuh kredensial AWS, karena izin publik hanya berlaku lewat Function URL.

## 3. Langkah deploy (setiap sesi)

1. Buka AWS Academy, lalu **Start Lab**. Tunggu sampai indikator hijau, lalu buka **AWS Console**.
2. Pastikan region **N. Virginia (us-east-1)**, lalu buka **CloudShell**.
3. Ambil kode. Ini hanya sekali, karena folder home CloudShell tetap tersimpan antarsesi:
   ```bash
   git clone <url-repo> simple-orders   # atau unggah zip lewat Actions > Upload file
   cd simple-orders
   ```
   Di sesi berikutnya cukup `cd simple-orders && git pull`.
4. Deploy:
   ```bash
   bash scripts/deploy.sh
   ```
   Yang dilakukan skrip:
   - **a.** Membuat kunci acak bila belum ada di `.env`.
   - **b.** Menjalankan `aws cloudformation deploy` (fungsi, URL, izin).
   - **c.** Membuat zip `src/` di `build/orders.zip`, menjalankan `aws lambda update-function-code`, lalu `aws lambda wait function-updated`.
   - **d.** Menjalankan `aws lambda invoke` dengan `{"action":"setupDatabase"}`: tabel dibuat, atau dipakai ulang bila sudah ada, lalu ditunggu sampai ACTIVE.
   - **e.** Menyimpan `KEY_PELANGGAN`, `KEY_PENJUAL`, dan `API_URL` ke `.env`.

   Skrip ini aman dijalankan berulang. Kunci lama dipakai lagi, kode diunggah ulang, dan tabel yang sudah ada tidak disentuh. Bila langkah d gagal, skrip berhenti dan menampilkan pesan error dari Lambda.
5. Catat URL yang dicetak. Kunci API tersimpan di `.env` (`cat .env`).

> `.env` berisi kunci rahasia. File ini ada di `.gitignore`. Jangan di-commit atau dibagikan.
> Kalau `.env` hilang, `deploy.sh` berikutnya membuat kunci **baru**, dan kunci lama tidak berlaku lagi.

## 4. Verifikasi

1. **Tes API otomatis** (14 tes, harus `14 OK, 0 GAGAL`):
   ```bash
   bash scripts/test-api.sh
   ```
   Hasilnya tersimpan di `out/hasil-tes-<waktu>.txt`.
2. **Halaman web.** Buka `API_URL` di browser.
   - Role Pelanggan + `KEY_PELANGGAN`: buat pesanan, ID terisi otomatis, lalu tekan **Cek**.
   - Role Penjual + `KEY_PENJUAL`: cari ID itu, tekan **Tandai selesai** (status menjadi Selesai), lalu **Hapus**.
3. **Status stack:**
   ```bash
   aws cloudformation describe-stacks --stack-name simple-orders \
     --query 'Stacks[0].[StackStatus,Outputs]'
   ```
4. **Log CloudWatch.** Setiap permintaan tercatat sebagai satu baris `{"method","path","role","status"}`, tanpa kunci:
   ```bash
   FN=$(aws cloudformation describe-stacks --stack-name simple-orders \
     --query "Stacks[0].Outputs[?OutputKey=='FunctionName'].OutputValue" --output text)
   aws logs tail "/aws/lambda/$FN" --since 15m
   ```
5. **Isi tabel:**
   ```bash
   aws dynamodb scan --table-name orders --select COUNT
   ```

## 5. Rollback bila gagal

| Situasi | Yang terjadi / yang dilakukan |
|---|---|
| `cloudformation deploy` gagal saat update | CloudFormation otomatis kembali ke versi sebelumnya (`UPDATE_ROLLBACK_COMPLETE`). Perbaiki penyebabnya, lalu jalankan `deploy.sh` lagi. |
| Pembuatan stack pertama gagal | Status menjadi `ROLLBACK_COMPLETE`. `deploy.sh` berikutnya otomatis menghapus stack itu lalu membuat ulang. |
| Mencari penyebab di stack | `aws cloudformation describe-stack-events --stack-name simple-orders --max-items 20 --query 'StackEvents[].[LogicalResourceId,ResourceStatus,ResourceStatusReason]' --output table` |
| `update-function-code` gagal | Stack tetap ada dan fungsi masih berisi kode lama (atau placeholder yang membalas 503). Jalankan `deploy.sh` lagi. |
| `setupDatabase` gagal | `deploy.sh` berhenti dan mencetak `errorMessage` dari Lambda. Lihat detailnya dengan `aws logs tail "/aws/lambda/$FN" --since 15m`. |
| Kode baru bermasalah | Unggah kode versi sebelumnya: `git checkout <commit-lama> -- src && bash scripts/deploy.sh`, lalu kembalikan dengan `git checkout HEAD -- src`. Data di tabel tidak terpengaruh. |
| Semua kacau | `RETAIN=true bash scripts/teardown.sh`, lalu `bash scripts/deploy.sh`. Data tetap ada. Tanpa `RETAIN=true`, tabel ikut terhapus. |

## 6. Skenario persistensi

### A. Lambda di-restart: data tetap ada

Data disimpan di DynamoDB, bukan di memori Lambda. Jadi instance Lambda baru (cold start) tidak menghapus pesanan.

```bash
source .env
FN=$(aws cloudformation describe-stacks --stack-name simple-orders \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionName'].OutputValue" --output text)

# 1. Buat pesanan, catat ID-nya
ID=$(curl -s -X POST "$API_URL/orders" -H "X-Api-Key: $KEY_PELANGGAN" \
  -H 'Content-Type: application/json' \
  -d '{"customerName":"Uji","item":"Teh","quantity":1}' | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)
echo "$ID"

# 2. Restart: unggah ulang kode, sehingga semua instance lama dibuang
bash scripts/deploy.sh

# 3. Pesanan masih ada (harap HTTP 200)
curl -s -w '\n%{http_code}\n' "$API_URL/orders/$ID" -H "X-Api-Key: $KEY_PENJUAL"
```

### B. `RETAIN=true` teardown + deploy ulang: data tetap ada

```bash
source .env

# 1. Buat pesanan, catat ID
ID=$(curl -s -X POST "$API_URL/orders" -H "X-Api-Key: $KEY_PELANGGAN" \
  -H 'Content-Type: application/json' \
  -d '{"customerName":"Persisten","item":"Kopi","quantity":1}' | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)
echo "$ID"

# 2. Hapus stack, tapi SIMPAN tabel
RETAIN=true bash scripts/teardown.sh
aws dynamodb describe-table --table-name orders --query Table.TableStatus   # "ACTIVE"

# 3. Deploy ulang. setupDatabase melihat tabel sudah ada dan memakainya lagi.
bash scripts/deploy.sh
source .env   # API_URL baru (Function URL dibuat ulang), kunci tetap sama

# 4. Pesanan lama masih ada (harap HTTP 200)
curl -s -w '\n%{http_code}\n' "$API_URL/orders/$ID" -H "X-Api-Key: $KEY_PENJUAL"
```

Langkah 2 memanggil `describe-table` dengan kredensial user. Bila ditolak oleh sandbox, lewati saja. Langkah 4 tetap membuktikan data selamat.

Bila teardown dijalankan **tanpa** `RETAIN=true`, `teardown.sh` lebih dulu memanggil `{"action":"deleteDatabase"}` sehingga tabel dan datanya hilang. Deploy ulang lalu membuat tabel kosong, dan pesanan lama dibalas 404.

## 7. Batasan sandbox

- **API Gateway dan Cognito diblokir.** Karena itu dipakai Lambda Function URL dengan `AuthType: NONE`, dan autentikasi memakai header `X-Api-Key` yang dicek di kode.
- **Tidak bisa membuat IAM role.** `OrdersFn` memakai `LabRole`, yang hak aksesnya lebih luas dari yang dibutuhkan (tidak *least privilege*), termasuk hak membuat dan menghapus tabel.
- **User tidak boleh `dynamodb:CreateTable`.** Tabel dibuat oleh `OrdersFn` sendiri lewat invoke `setupDatabase`.
- **Tabel di luar CloudFormation.** Menghapus stack tidak menghapus tabel. Tabel dihapus oleh `teardown.sh` (action `deleteDatabase`), kecuali `RETAIN=true`. Bila stack dihapus manual lewat konsol, tabel `orders` tertinggal dan harus dihapus manual.
- **Kode di luar CloudFormation.** Template hanya berisi kode placeholder. Kalau stack di-deploy tanpa `deploy.sh`, URL membalas 503 "Kode belum diunggah".
- **Function URL publik butuh dua izin**: `lambda:InvokeFunctionUrl` dan `lambda:InvokeFunction` (`InvokedViaFunctionUrl`).
- **Kunci API dibagikan per role**, bukan per pengguna. Tidak ada login, dan siapa pun yang tahu kunci bisa memakai role itu.
- **Kredensial sandbox berlaku per sesi.** Bila sesi habis, buka ulang CloudShell dari sesi baru. Resource biasanya tetap ada antarsesi, tapi hilang bila sandbox di-reset. Karena itu, salin `.env` ke tempat aman.
- **Nama tabel `orders` tetap.** Bila tabel `orders` sudah ada sebelumnya, tabel itu dipakai.
- **Tidak ada daftar semua pesanan** (`GET /orders`), sesuai spesifikasi. Pesanan dicari dengan ID.

## 8. Checklist screenshot

- [ ] Output `bash scripts/deploy.sh` sampai baris "Selesai", termasuk hasil `setupDatabase` (jangan tampilkan isi `.env`)
- [ ] CloudFormation: stack `simple-orders` berstatus `CREATE_COMPLETE` / `UPDATE_COMPLETE`, tab **Resources** (4 resource)
- [ ] CloudFormation tab **Parameters**: `KeyPelanggan` dan `KeyPenjual` tampil sebagai `****`
- [ ] Lambda `OrdersFn`: tab **Code** (kode asli, bukan placeholder) dan **Configuration > Function URL** (Auth type NONE)
- [ ] DynamoDB: tabel `orders` (ACTIVE) dan **Explore items** berisi pesanan
- [ ] Halaman web: pelanggan berhasil membuat pesanan (ID tampil)
- [ ] Halaman web: penjual mencari pesanan, status Selesai setelah "Tandai selesai"
- [ ] Halaman web: pesan error, misalnya `Error 401` dengan kunci salah
- [ ] Output `bash scripts/test-api.sh`: `Total: 14 tes, 14 OK, 0 GAGAL`
- [ ] CloudWatch Logs `OrdersFn`: baris log JSON tanpa kunci API
- [ ] Skenario A: HTTP 200 setelah deploy ulang (restart Lambda)
- [ ] Skenario B: output `RETAIN=true bash scripts/teardown.sh`, lalu HTTP 200 setelah deploy ulang
- [ ] Output `bash scripts/teardown.sh` (tabel dan stack terhapus)
