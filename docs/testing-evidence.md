# Testing Evidence: Simple Orders

Bukti pengujian aplikasi yang ter-deploy di AWS Academy Sandbox (`us-east-1`), stack `simple-orders`.
Semua screenshot ada di folder [`docs/evidence/`](evidence/). Tidak ada screenshot yang menampilkan kunci API.

| Bagian | Isi |
|---|---|
| 1 | Deploy dan endpoint aktif |
| 2 | Respons API: 4 operasi CRUD dan error |
| 3 | Tes API otomatis |
| 4 | Persistensi setelah restart |
| 5 | Failure/recovery |
| 6 | Keamanan |
| 7 | Observability (log dan monitoring) |
| 8 | Resource AWS |
| 9 | Cleanup |

## 1. Deploy dan endpoint aktif

`bash scripts/deploy.sh` membuat stack, mengunggah kode, dan membuat tabel `orders`. Deploy kedua aman: tabel dipakai ulang.

![Deploy dari CloudShell](evidence/01-deploy.png)

Tes koneksi: halaman web membalas `200`, API tanpa kunci membalas `401`.

![Tes koneksi dengan curl](evidence/02-koneksi-curl.png)

## 2. Respons API (lewat halaman web)

| No | Aksi | Rute | Hasil |
|---|---|---|---|
| 03 | Buka halaman | `GET /` | Halaman tampil |
| 04 | Kunci salah | `GET /orders/{id}` | `401` |
| 05 | ID bukan UUID | `GET /orders/abc` | `400` |
| 06 | Buat pesanan | `POST /orders` → PutItem | `201` |
| 07 | Lihat pesanan | `GET /orders/{id}` → GetItem | `200` |
| 08 | Tandai diterima | `PUT /orders/{id}` → UpdateItem | `200`, status Selesai |
| 09 | Batalkan pesanan | `DELETE /orders/{id}` → DeleteItem | `200` |
| 10 | Cek pesanan yang dihapus | `GET /orders/{id}` | `404` |

![Halaman web](evidence/03-web.png)
![Error 401](evidence/04-error-401.png)
![Error 400](evidence/05-error-400.png)
![CREATE](evidence/06-create.png)
![READ](evidence/07-read.png)
![UPDATE](evidence/08-update.png)
![DELETE](evidence/09-delete.png)
![Error 404](evidence/10-error-404.png)

## 3. Tes API otomatis

`bash scripts/test-api.sh` menguji endpoint asli dengan curl. Hasil: **10 tes, 10 OK, 0 GAGAL**.

![Output test-api.sh](evidence/11-test-api.png)

## 4. Persistensi setelah restart

`bash scripts/test-persistence.sh` membuat pesanan, me-restart Lambda (unggah ulang kode, `LastModified` berubah), lalu mengambil pesanan yang sama. Hasil: **HASIL: LULUS**. Data aman karena disimpan di DynamoDB, bukan di memori Lambda.

![Output test-persistence.sh](evidence/12-persistensi.png)

## 5. Failure/recovery

Skenario: kode rusak ikut ter-deploy. `bash scripts/test-failure-recovery.sh` menjalankan:

1. Normal: pesanan dibuat (`201`)
2. Failure: kode rusak diunggah, API membalas `502`
3. Deteksi: error `SIMULASI_FAILURE` tercatat di CloudWatch Logs
4. Recovery: `deploy.sh` mengunggah ulang kode yang benar
5. Pulih: pesanan dari langkah 1 kembali `200`, data utuh

![Output test-failure-recovery.sh](evidence/13-failure-recovery.png)
![Log error di CloudWatch](evidence/14-failure-log.png)

## 6. Keamanan

- Kunci API tersimpan sebagai parameter `NoEcho` (tampil `****`) dan tidak ada di Git (`.env` masuk `.gitignore`).
- Semua rute `/orders` menolak permintaan tanpa kunci yang benar (`401`, lihat no. 04 dan tes T1–T2).
- IAM: Lambda memakai `LabRole` bawaan sandbox.

![Parameter NoEcho](evidence/17-cloudformation-parameters.png)
![.env tidak ada di Git](evidence/24-tanpa-rahasia-git.png)

## 7. Observability

Setiap permintaan menghasilkan satu baris log JSON `{"method","path","status"}` tanpa kunci API. Tab Monitor menampilkan jumlah pemanggilan, durasi, dan error.

![CloudWatch Logs](evidence/23-cloudwatch-logs.png)
![Lambda Monitor](evidence/20-lambda-monitor.png)

## 8. Resource AWS

![Stack CloudFormation](evidence/15-cloudformation-stack.png)
![Resource CloudFormation](evidence/16-cloudformation-resources.png)
![Kode Lambda](evidence/18-lambda-code.png)
![Function URL](evidence/19-lambda-function-url.png)
![Tabel DynamoDB](evidence/21-dynamodb-tabel.png)
![Isi tabel DynamoDB](evidence/22-dynamodb-items.png)

## 9. Cleanup

Setelah penilaian selesai, semua resource dihapus dengan `bash scripts/teardown.sh` (tabel dan stack).

![Output teardown.sh](evidence/25-teardown.png)
