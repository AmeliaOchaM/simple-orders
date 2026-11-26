#!/usr/bin/env bash
# Deploy Simple Orders dari AWS CloudShell (tanpa S3).
#
# Pakai: bash scripts/deploy.sh
#
# Langkah: kunci -> cloudformation deploy -> zip src/ -> update-function-code
#          -> invoke setupDatabase (buat tabel) -> simpan .env
# Aman dijalankan berulang. Kunci API tidak dicetak ke layar.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-simple-orders}"
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"

# a. Kunci API pembeli: pakai yang lama dari .env bila ada, kalau tidak buat acak.
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi
KEY_PEMBELI="${KEY_PEMBELI:-$(openssl rand -hex 24)}"

# Stack yang gagal saat pertama dibuat (ROLLBACK_COMPLETE) tidak bisa di-update; hapus dulu.
STATUS="$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo TIDAK_ADA)"
if [[ "$STATUS" == "ROLLBACK_COMPLETE" ]]; then
  echo "==> Stack $STACK berstatus ROLLBACK_COMPLETE, dihapus dulu"
  aws cloudformation delete-stack --stack-name "$STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK"
fi

# b. Stack: fungsi (kode placeholder), Function URL, dan izin.
#    Kunci dikirim sebagai parameter NoEcho (tidak tampil di konsol CloudFormation).
echo "==> Deploy stack $STACK"
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file infra/template.yaml \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    KeyPembeli="$KEY_PEMBELI"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
FN="$(output FunctionName)"
URL="$(output FunctionUrl)"
API_URL="${URL%/}"

# c. Zip isi folder src/ lalu unggah langsung ke Lambda.
echo "==> Mengunggah kode ke $FN"
mkdir -p build
rm -f build/orders.zip
(cd src && zip -qr ../build/orders.zip .)
aws lambda wait function-updated --function-name "$FN" # tunggu bila masih diperbarui CloudFormation
aws lambda update-function-code --function-name "$FN" \
  --zip-file fileb://build/orders.zip >/dev/null
aws lambda wait function-updated --function-name "$FN"

# d. Buat tabel (atau pakai ulang bila sudah ada).
echo "==> Menyiapkan tabel DynamoDB"
aws lambda invoke --function-name "$FN" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"action":"setupDatabase"}' \
  build/setup-hasil.json >/dev/null
if ! grep -q '"ok":true' build/setup-hasil.json; then
  echo "Gagal menyiapkan tabel:" >&2
  cat build/setup-hasil.json >&2
  echo >&2
  exit 1
fi
echo "    $(cat build/setup-hasil.json)"

# e. Simpan kunci dan URL ke .env (hanya bisa dibaca pemilik, tidak di-commit).
umask 077
cat > .env <<EOF
KEY_PEMBELI=$KEY_PEMBELI
API_URL=$API_URL
EOF

echo
echo "Selesai."
echo "  URL aplikasi : $API_URL"
echo "  Kunci API    : tersimpan di .env (lihat dengan: cat .env)"
echo "  Tes API      : bash scripts/test-api.sh"
