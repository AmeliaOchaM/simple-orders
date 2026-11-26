# Naskah Video Demo (3–5 menit)

Urutan wajib: **live endpoint → CRUD → data tersimpan → resource AWS → bukti tes**, ditutup penjelasan arsitektur dan trade-off.

## Persiapan sebelum merekam

1. Start Lab di AWS Academy, buka CloudShell, lalu jalankan:
   ```bash
   cd ~/simple-orders && git pull && bash scripts/deploy.sh
   ```
2. Salin kunci (`grep KEY_PEMBELI .env`) ke Notepad, lalu **tutup** Notepad sebelum merekam. Kunci cukup ada di clipboard.
3. Buka tab browser berurutan:
   1. Halaman aplikasi (`API_URL`)
   2. DynamoDB → `orders` → Explore table items
   3. CloudFormation → `simple-orders` → Resources
   4. Lambda → `OrdersFn` → Monitor
   5. CloudWatch → log group `/aws/lambda/simple-orders-OrdersFn-...`
   6. CloudShell
4. Jangan pernah membuka halaman Lambda **Environment variables** atau `cat .env` saat merekam.

## Naskah

| Waktu | Tampilkan | Katakan |
|---|---|---|
| 0:00–0:30 | README di GitHub, bagian diagram arsitektur | "Simple Orders adalah aplikasi pencatatan pesanan kantin dengan Track C Serverless. Browser memanggil Lambda Function URL, Lambda OrdersFn menjalankan CRUD ke DynamoDB, dan log masuk ke CloudWatch. Semua resource dibangun ulang dengan CloudFormation." |
| 0:30–0:50 | Tab halaman aplikasi | "Ini endpoint yang sedang aktif di AWS. Halaman web dan API dilayani oleh satu Lambda." Tempel kunci. |
| 0:50–1:00 | Isi kunci asal, Cek ID `abc` | "Tanpa kunci yang benar, API menolak dengan 401." Lalu tempel kunci benar. |
| 1:00–2:00 | Buat pesanan → Cek → Tandai diterima → Batalkan → Cek lagi | Sebut tiap operasi: "Create, POST, PutItem... Read, GET, GetItem... Update, PUT, UpdateItem... Delete, DELETE, DeleteItem. Setelah dihapus, pesanan tidak ditemukan, 404." Sebelum Batalkan, **buat satu pesanan lagi** dan biarkan. |
| 2:00–2:30 | DynamoDB → Explore items → Run | "Data benar-benar tersimpan di DynamoDB. Pesanan yang tadi dibuat ada di sini, sedangkan yang dibatalkan sudah hilang." |
| 2:30–3:10 | CloudFormation Resources → Parameters → Lambda Monitor → CloudWatch Logs | "Stack berisi empat resource: fungsi, Function URL, dan dua izin. Kunci API disimpan NoEcho, tampil bintang-bintang. Di CloudWatch, setiap permintaan tercatat satu baris berisi method, path, dan status, tanpa kunci." |
| 3:10–4:10 | CloudShell: `bash scripts/test-api.sh`, lalu tunjukkan output `out/` dari `test-persistence.sh` dan `test-failure-recovery.sh` | "Tes otomatis: 10 dari 10 lulus. Tes persistensi: data tetap ada setelah Lambda di-restart. Skenario failure: kode rusak membuat API 502, error terlihat di log, lalu deploy ulang memulihkan layanan tanpa kehilangan data." |
| 4:10–4:50 | README bagian "Batasan dan trade-off" | "Karena keterbatasan sandbox, saya memakai Function URL sebagai pengganti API Gateway, satu kunci API karena Cognito tidak tersedia dan penggunanya hanya pembeli, dan tabel dibuat lewat Lambda karena user tidak boleh CreateTable. Trade-off-nya: tidak ada throttling bawaan, tidak ada login per orang, dan LabRole lebih luas dari least privilege." |

Agar video tetap di bawah 5 menit, jalankan `test-persistence.sh` dan `test-failure-recovery.sh` **sebelum** merekam (masing-masing ±1–2 menit), lalu di video cukup tampilkan hasilnya:

```bash
cat out/persistensi-*.txt | tail -3
cat out/failure-recovery-*.txt | tail -12
```

## Setelah merekam

```bash
bash scripts/teardown.sh   # hapus tabel dan stack (bersihkan resource)
```

Screenshot output teardown untuk `docs/evidence/25-teardown.png`.
