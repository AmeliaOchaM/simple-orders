#!/usr/bin/env bash
# Skenario failure/recovery: kode Lambda rusak ter-deploy, lalu dipulihkan.
#
# Pakai (setelah deploy.sh): bash scripts/test-failure-recovery.sh
#
# Alur:
#   1. Buat pesanan (kondisi normal)              -> 201
#   2. FAILURE : unggah kode rusak ke Lambda      -> API membalas 5xx (502)
#   3. Deteksi : error terlihat di CloudWatch Logs
#   4. RECOVERY: jalankan deploy.sh (kode benar)  -> API kembali 200
#   5. Data pesanan dari langkah 1 masih utuh (DynamoDB tidak terpengaruh)
# Bila skrip berhenti di tengah, kode benar diunggah ulang otomatis (trap).
# Hasil disimpan ke out/failure-recovery-<waktu>.txt. Kunci tidak dicetak.
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
OUT="out/failure-recovery-$(date +%Y%m%d-%H%M%S).txt"
BODY="$(mktemp)"
RUSAK_DIR="$(mktemp -d)"
KODE_RUSAK_AKTIF=false

# shellcheck disable=SC2329  # dipanggil lewat trap
pulihkan_darurat() {
  rm -rf "$BODY" "$RUSAK_DIR"
  if [[ "$KODE_RUSAK_AKTIF" == "true" ]]; then
    echo "Skrip berhenti saat kode rusak aktif. Memulihkan dengan deploy.sh..." >&2
    bash scripts/deploy.sh >/dev/null && echo "Kode benar sudah diunggah ulang." >&2
  fi
}
trap pulihkan_darurat EXIT

catat() { echo "$*" | tee -a "$OUT"; }

panggil() {
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$1" "$API_URL$2" -H "X-Api-Key: $KEY_PEMBELI")
  [[ -n "${3:-}" ]] && args+=(-H 'Content-Type: application/json' -d "$3")
  curl "${args[@]}"
}

catat "Skenario failure/recovery Simple Orders - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
catat "Fungsi: $FN"
catat ""

# 1. Kondisi normal
KODE="$(panggil POST /orders '{"customerName":"Uji Recovery","item":"Kopi","quantity":1}')"
ID="$(grep -o '"orderId":"[^"]*"' "$BODY" | cut -d'"' -f4)"
catat "1. NORMAL   POST /orders        -> HTTP $KODE (orderId $ID)"
if [[ "$KODE" != "201" || -z "$ID" ]]; then
  catat "GAGAL: kondisi awal tidak normal, skenario dibatalkan."
  exit 1
fi

# 2. Failure: unggah kode rusak (setiap permintaan melempar error)
cat > "$RUSAK_DIR/index.js" <<'EOF'
exports.handler = async () => {
  throw new Error('SIMULASI_FAILURE: kode rusak ter-deploy');
};
EOF
ZIP_RUSAK="$PWD/build/rusak.zip"
rm -f "$ZIP_RUSAK"
(cd "$RUSAK_DIR" && zip -q "$ZIP_RUSAK" index.js)
aws lambda update-function-code --function-name "$FN" \
  --zip-file fileb://"$ZIP_RUSAK" >/dev/null
KODE_RUSAK_AKTIF=true
aws lambda wait function-updated --function-name "$FN"

KODE="$(panggil GET "/orders/$ID")"
catat "2. FAILURE  kode rusak diunggah"
catat "           GET /orders/{id}    -> HTTP $KODE (harap 5xx) $(head -c 100 "$BODY")"
GAGAL_TERDETEKSI=false
[[ "$KODE" == 5* ]] && GAGAL_TERDETEKSI=true

# 3. Deteksi di CloudWatch Logs (log butuh beberapa detik untuk muncul)
catat "3. DETEKSI  CloudWatch Logs (filter SIMULASI_FAILURE):"
sleep 15
LOG="$(aws logs tail "/aws/lambda/$FN" --since 5m --filter-pattern SIMULASI_FAILURE \
  --format short 2>/dev/null | head -n 3)"
if [[ -n "$LOG" ]]; then
  while IFS= read -r baris; do catat "           ${baris:0:160}"; done <<< "$LOG"
else
  catat "           (log belum muncul, cek manual di CloudWatch dengan filter SIMULASI_FAILURE)"
fi

# 4. Recovery: deploy ulang kode yang benar
catat "4. RECOVERY bash scripts/deploy.sh"
if bash scripts/deploy.sh >/dev/null; then
  KODE_RUSAK_AKTIF=false
  catat "           deploy selesai"
else
  catat "           deploy GAGAL, lihat output deploy.sh"
  exit 1
fi

# 5. Layanan pulih dan data tetap utuh
KODE="$(panggil GET "/orders/$ID")"
catat "5. PULIH    GET /orders/{id}    -> HTTP $KODE"
catat "           $(cat "$BODY")"

catat ""
if [[ "$GAGAL_TERDETEKSI" == "true" && "$KODE" == "200" ]]; then
  catat "HASIL: LULUS - kegagalan terdeteksi (5xx + log), layanan pulih (200), dan data pesanan tidak hilang."
  echo "Hasil disimpan di $OUT"
  exit 0
fi
catat "HASIL: GAGAL - periksa langkah di atas."
echo "Hasil disimpan di $OUT"
exit 1
