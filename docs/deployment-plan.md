# Deployment Plan: Simple Orders

Dokumen ini menjelaskan cara memasang, memverifikasi, dan membongkar Simple Orders di AWS Academy Sandbox.

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

Semua resource dibuat oleh `infra/template.yaml`, kecuali bucket kode yang dibuat oleh `deploy.sh`.

| Resource | Tipe | Fungsi |
|---|---|---|
| `simple-orders-code-<akun>` | S3 bucket | Menyimpan zip kode (`orders-<hash>.zip`). Dibuat `deploy.sh`, dihapus `teardown.sh`. |
| `TableCreatorFn` | Lambda | Handler `handlers/setupDatabase.handler`. Membuat dan menghapus tabel karena user tidak boleh `CreateTable`. |
| `OrdersTable` | Custom Resource | Meminta `TableCreatorFn` membuat tabel `orders`. |
| `orders` | DynamoDB table | PK `orderId` (String), mode `PAY_PER_REQUEST`. |
| `OrdersFn` | Lambda | Handler `index.handler`. API pesanan dan halaman web. |
| `OrdersFnUrl` | Lambda Function URL | Endpoint publik, `AuthType: NONE`. |
| `OrdersFnUrlPermission` | Lambda Permission | `lambda:InvokeFunctionUrl` untuk `*` (`FunctionUrlAuthType: NONE`). |
| `OrdersFnInvokePermission` | Lambda Permission | `lambda:InvokeFunction` untuk `*`, hanya bila `InvokedViaFunctionUrl: true`. |
| `/aws/lambda/<nama-fungsi>` | CloudWatch Log Group | Dibuat otomatis oleh Lambda saat pertama kali dipanggil. |

Parameter template:

| Parameter | Diisi oleh | Keterangan |
|---|---|---|
| `CodeBucket`, `CodeKey` | `deploy.sh` | Lokasi zip kode di S3. Dipakai kedua Lambda. |
| `KeyPelanggan`, `KeyPenjual` | `deploy.sh` (dari `.env` atau acak) | `NoEcho`, minimal 16 karakter. Menjadi env var `KEY_PELANGGAN` dan `KEY_PENJUAL`. |
| `RetainTableOnDelete` | `deploy.sh` (`RETAIN=true/false`) | `true` berarti tabel tidak ikut terhapus saat stack dihapus. |
| `TableName` | default `orders` | Nama tabel. |

Output: `FunctionUrl`, `TableName`, `TableArn`.

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
   bash scripts/deploy.sh               # biasa
   RETAIN=true bash scripts/deploy.sh   # bila tabel harus selamat saat stack dihapus
   ```
   Skrip ini aman dijalankan berulang kali. Bila kode tidak berubah, CloudFormation menampilkan "No changes to deploy".
5. Catat URL yang dicetak. Kunci API tersimpan di `.env` (`cat .env`).

> `.env` berisi kunci rahasia. File ini ada di `.gitignore`. Jangan di-commit atau dibagikan.
> Kalau `.env` hilang, `deploy.sh` berikutnya membuat kunci **baru**, dan kunci lama tidak berlaku lagi.

## 4. Verifikasi

1. **Tes API otomatis** (14 tes, harus `14 OK, 0 GAGAL`):
   ```bash
   bash scripts/test-api.sh
   ```
   Hasilnya tersimpan di `out/hasil-tes-<waktu>.txt`.
2. **Halaman web.** Buka URL dari `.env` (`API_URL`) di browser.
   - Role Pelanggan + `KEY_PELANGGAN`: buat pesanan, ID terisi otomatis, lalu tekan **Cek**.
   - Role Penjual + `KEY_PENJUAL`: cari ID itu, tekan **Tandai selesai** (status menjadi Selesai), lalu **Hapus**.
3. **Status stack:**
   ```bash
   aws cloudformation describe-stacks --stack-name simple-orders \
     --query 'Stacks[0].[StackStatus,Outputs]'
   ```
4. **Log CloudWatch.** Setiap permintaan tercatat sebagai satu baris `{"method","path","role","status"}`, tanpa kunci:
   ```bash
   FN=$(aws cloudformation describe-stack-resource --stack-name simple-orders \
     --logical-resource-id OrdersFn --query StackResourceDetail.PhysicalResourceId --output text)
   aws logs tail "/aws/lambda/$FN" --since 15m
   ```
5. **Isi tabel:**
   ```bash
   aws dynamodb scan --table-name orders --select COUNT
   ```

## 5. Rollback bila gagal

| Situasi | Yang terjadi / yang dilakukan |
|---|---|
| Update stack gagal | CloudFormation otomatis kembali ke versi sebelumnya (`UPDATE_ROLLBACK_COMPLETE`). Aplikasi lama tetap jalan. Perbaiki penyebabnya, lalu jalankan `deploy.sh` lagi. |
| Pembuatan stack pertama gagal | Status menjadi `ROLLBACK_COMPLETE`. `deploy.sh` berikutnya otomatis menghapus stack itu lalu membuat ulang. |
| Mencari penyebab | `aws cloudformation describe-stack-events --stack-name simple-orders --max-items 20 --query 'StackEvents[].[LogicalResourceId,ResourceStatus,ResourceStatusReason]' --output table` |
| Tabel gagal dibuat | Lihat log `TableCreatorFn` (`aws logs tail /aws/lambda/<nama TableCreatorFn> --since 30m`). Pesan error ikut tampil di event stack. |
| Kode baru bermasalah, tapi deploy sukses | Kembalikan kode ke commit sebelumnya, lalu deploy ulang. Zip lama punya hash yang sama, jadi Lambda kembali ke versi itu: `git checkout <commit-lama> -- src && bash scripts/deploy.sh`, lalu `git checkout HEAD -- src`. |
| Semua kacau | `bash scripts/teardown.sh`, lalu `bash scripts/deploy.sh`. Data hilang kecuali deploy terakhir memakai `RETAIN=true`. |

## 6. Skenario persistensi

### A. Lambda di-restart: data tetap ada

Data disimpan di DynamoDB, bukan di memori Lambda. Jadi cold start baru tidak menghapus pesanan.

```bash
source .env
# 1. Buat pesanan, catat ID-nya
ID=$(curl -s -X POST "$API_URL/orders" -H "X-Api-Key: $KEY_PELANGGAN" \
  -H 'Content-Type: application/json' \
  -d '{"customerName":"Uji","item":"Teh","quantity":1}' | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)
echo "$ID"

# 2. Paksa cold start: ubah konfigurasi fungsi, sehingga semua instance lama dibuang
FN=$(aws cloudformation describe-stack-resource --stack-name simple-orders \
  --logical-resource-id OrdersFn --query StackResourceDetail.PhysicalResourceId --output text)
aws lambda update-function-configuration --function-name "$FN" --description "restart $(date +%s)" >/dev/null
aws lambda wait function-updated --function-name "$FN"

# 3. Pesanan masih ada (harap HTTP 200)
curl -s -w '\n%{http_code}\n' "$API_URL/orders/$ID" -H "X-Api-Key: $KEY_PENJUAL"
```

Langkah 2 mengubah `Description` di luar CloudFormation (*drift*). Ini tidak berbahaya, dan nilainya kembali sesuai template setelah stack dibuat ulang (teardown + deploy).

### B. `RETAIN=true` + teardown + deploy ulang: data kembali

```bash
# 1. Deploy dengan RETAIN=true (harus deploy TERAKHIR sebelum teardown)
RETAIN=true bash scripts/deploy.sh
source .env

# 2. Buat pesanan, catat ID
ID=$(curl -s -X POST "$API_URL/orders" -H "X-Api-Key: $KEY_PELANGGAN" \
  -H 'Content-Type: application/json' \
  -d '{"customerName":"Persisten","item":"Kopi","quantity":1}' | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)
echo "$ID"

# 3. Bongkar semuanya. Tabel harus tetap ada.
bash scripts/teardown.sh
aws dynamodb describe-table --table-name orders --query Table.TableStatus   # "ACTIVE"

# 4. Deploy ulang. TableCreator melihat tabel sudah ada dan memakainya lagi.
RETAIN=true bash scripts/deploy.sh
source .env   # API_URL baru (Function URL dibuat ulang), kunci tetap sama

# 5. Pesanan lama kembali (harap HTTP 200)
curl -s -w '\n%{http_code}\n' "$API_URL/orders/$ID" -H "X-Api-Key: $KEY_PENJUAL"
```

Untuk membersihkan tabel yang disimpan, deploy sekali lagi tanpa `RETAIN` (`bash scripts/deploy.sh`), lalu `bash scripts/teardown.sh`.

## 7. Batasan sandbox

- **API Gateway dan Cognito diblokir.** Karena itu dipakai Lambda Function URL dengan `AuthType: NONE`, dan autentikasi memakai header `X-Api-Key` yang dicek di kode.
- **Tidak bisa membuat IAM role.** Kedua Lambda memakai `LabRole`, yang hak aksesnya lebih luas dari yang dibutuhkan (tidak *least privilege*).
- **User tidak boleh `dynamodb:CreateTable`.** Tabel dibuat oleh `TableCreatorFn` (Custom Resource) yang berjalan dengan `LabRole`.
- **Function URL publik butuh dua izin**: `lambda:InvokeFunctionUrl` dan `lambda:InvokeFunction` (`InvokedViaFunctionUrl`).
- **Kunci API dibagikan per role**, bukan per pengguna. Tidak ada login, dan siapa pun yang tahu kunci bisa memakai role itu.
- **Kredensial sandbox berlaku per sesi.** Bila sesi habis, buka ulang CloudShell dari sesi baru. Resource biasanya tetap ada antarsesi, tapi hilang bila sandbox di-reset. Karena itu, salin `.env` ke tempat aman.
- **Nama tabel `orders` tetap.** Bila tabel `orders` sudah ada sebelumnya, tabel itu dipakai, dan ikut terhapus saat teardown tanpa `RETAIN=true`.
- **Tidak ada daftar semua pesanan** (`GET /orders`), sesuai spesifikasi. Pesanan dicari dengan ID.

## 8. Checklist screenshot

- [ ] Output `bash scripts/deploy.sh` sampai baris "Selesai" dan URL aplikasi (jangan tampilkan isi `.env`)
- [ ] CloudFormation: stack `simple-orders` berstatus `CREATE_COMPLETE` / `UPDATE_COMPLETE`, tab **Resources**
- [ ] CloudFormation tab **Parameters**: `KeyPelanggan` dan `KeyPenjual` tampil sebagai `****`
- [ ] Lambda `OrdersFn`: tab **Configuration > Function URL** (Auth type NONE)
- [ ] DynamoDB: tabel `orders` (ACTIVE) dan **Explore items** berisi pesanan
- [ ] Halaman web: pelanggan berhasil membuat pesanan (ID tampil)
- [ ] Halaman web: penjual mencari pesanan, status Selesai setelah "Tandai selesai"
- [ ] Halaman web: pesan error, misalnya `Error 401` dengan kunci salah
- [ ] Output `bash scripts/test-api.sh`: `Total: 14 tes, 14 OK, 0 GAGAL`
- [ ] CloudWatch Logs `OrdersFn`: baris log JSON tanpa kunci API
- [ ] Skenario A: HTTP 200 setelah restart Lambda
- [ ] Skenario B: `describe-table` ACTIVE setelah teardown, dan HTTP 200 setelah deploy ulang
- [ ] Output `bash scripts/teardown.sh`
