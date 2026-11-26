#!/usr/bin/env bash
# Tes persistensi: data tetap ada setelah Lambda di-restart.
#
# Pakai (setelah deploy.sh): bash scripts/test-persistence.sh
#
# Alur: buat pesanan -> restart Lambda (unggah ulang kode, semua instance lama
# dibuang) -> ambil pesanan yang sama -> harus 200 dengan data yang sama.
# Hasil dicetak ke layar dan disimpan ke out/persistensi-<waktu>.txt. Kunci tidak dicetak.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

STACK="${STACK:-simple-orders}"
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"

if [[ ! -f .env ]]; then
  echo "File .env tidak ada. Jalankan dulu: bash scripts/deploy.sh" >&2
  exit 1
fi
# shellcheck disable=SC1091
source .env
: "${API_URL:?API_URL kosong di .env}" "${KEY_PEMBELI:?KEY_PEMBELI kosong di .env}"

FN="$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionName'].OutputValue" --output text)"

mkdir -p out build
OUT="out/persistensi-$(date +%Y%m%d-%H%M%S).txt"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
catat() { echo "$*" | tee -a "$OUT"; }

# panggil <method> <path> [body-json] -> cetak kode HTTP, isi balasan ada di $BODY
panggil() {
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$1" "$API_URL$2" -H "X-Api-Key: $KEY_PEMBELI")
  [[ -n "${3:-}" ]] && args+=(-H 'Content-Type: application/json' -d "$3")
  curl "${args[@]}"
}

info_fungsi() {
  aws lambda get-function-configuration --function-name "$FN" \
    --query '[LastModified, CodeSha256]' --output text
}

catat "Tes persistensi Simple Orders - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
catat "Fungsi: $FN"
catat ""

# 1. Buat pesanan
KODE="$(panggil POST /orders '{"customerName":"Uji Persistensi","item":"Teh manis","quantity":1}')"
ID="$(grep -o '"orderId":"[^"]*"' "$BODY" | cut -d'"' -f4)"
catat "1. POST /orders                -> HTTP $KODE"
catat "   $(cat "$BODY")"
if [[ "$KODE" != "201" || -z "$ID" ]]; then
  catat "GAGAL: pesanan tidak bisa dibuat."
  exit 1
fi
# Urutan field bisa beda antara balasan POST dan GET, jadi yang dibandingkan
# adalah nilai createdAt (dibuat server, unik per pesanan).
ambil() { grep -o "\"$1\":\"[^\"]*\"" "$BODY" | cut -d'"' -f4; }
DIBUAT="$(ambil createdAt)"

# 2. Restart Lambda: unggah ulang kode -> Lambda membuat instance baru (cold start)
catat ""
catat "2. Restart Lambda (update-function-code)"
catat "   sebelum : $(info_fungsi)"
rm -f build/orders.zip
(cd src && zip -qr ../build/orders.zip .)
aws lambda update-function-code --function-name "$FN" \
  --zip-file fileb://build/orders.zip >/dev/null
aws lambda wait function-updated --function-name "$FN"
catat "   sesudah : $(info_fungsi)"

# 3. Ambil pesanan yang sama
catat ""
KODE="$(panggil GET "/orders/$ID")"
catat "3. GET /orders/$ID -> HTTP $KODE"
catat "   $(cat "$BODY")"

catat ""
if [[ "$KODE" == "200" && "$(ambil orderId)" == "$ID" && "$(ambil createdAt)" == "$DIBUAT" ]]; then
  catat "HASIL: LULUS - pesanan yang sama (orderId dan createdAt sama) tetap ada setelah Lambda di-restart (disimpan di DynamoDB)."
  echo "Hasil disimpan di $OUT"
  exit 0
fi
catat "HASIL: GAGAL - data berbeda atau tidak ditemukan setelah restart."
echo "Hasil disimpan di $OUT"
exit 1
