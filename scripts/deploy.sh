#!/usr/bin/env bash
# Deploy Simple Orders dari AWS CloudShell.
#
# Pakai:
#   bash scripts/deploy.sh               # deploy biasa
#   RETAIN=true bash scripts/deploy.sh   # tabel TIDAK ikut terhapus saat stack dihapus
#
# Langkah: buat bucket kode -> zip src/ -> unggah -> cloudformation deploy -> simpan .env
# Kunci API dibuat acak sekali, lalu dipakai ulang dari .env. Kunci tidak dicetak ke layar.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-simple-orders}"
REGION="${AWS_REGION:-us-east-1}"
RETAIN="${RETAIN:-false}"
export AWS_DEFAULT_REGION="$REGION"

if [[ "$RETAIN" != "true" && "$RETAIN" != "false" ]]; then
  echo "RETAIN harus true atau false" >&2
  exit 1
fi

# 1. Kunci API: pakai yang lama dari .env bila ada, kalau tidak buat acak.
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi
KEY_PELANGGAN="${KEY_PELANGGAN:-$(openssl rand -hex 24)}"
KEY_PENJUAL="${KEY_PENJUAL:-$(openssl rand -hex 24)}"

# 2. Bucket S3 untuk kode (nama unik per akun).
AKUN="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="simple-orders-code-${AKUN}"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "==> Membuat bucket $BUCKET"
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  fi
fi

# 3. Zip isi folder src/. Nama zip memakai hash isi kode: kalau kode berubah,
#    nama berubah, sehingga CloudFormation tahu Lambda harus diperbarui.
HASH="$(cd src && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-12)"
ZIP="orders-${HASH}.zip"
mkdir -p build
rm -f "build/$ZIP"
(cd src && zip -qr "../build/$ZIP" .)
echo "==> Mengunggah build/$ZIP ke s3://$BUCKET/"
aws s3 cp "build/$ZIP" "s3://$BUCKET/$ZIP" --only-show-errors

# 4. Stack yang gagal saat pertama dibuat (ROLLBACK_COMPLETE) tidak bisa di-update; hapus dulu.
STATUS="$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo TIDAK_ADA)"
if [[ "$STATUS" == "ROLLBACK_COMPLETE" ]]; then
  echo "==> Stack $STACK berstatus ROLLBACK_COMPLETE, dihapus dulu"
  aws cloudformation delete-stack --stack-name "$STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK"
fi

# 5. Deploy. Kunci dikirim sebagai parameter NoEcho (tidak tampil di konsol CloudFormation).
echo "==> Deploy stack $STACK (RETAIN=$RETAIN)"
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file infra/template.yaml \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    CodeBucket="$BUCKET" \
    CodeKey="$ZIP" \
    KeyPelanggan="$KEY_PELANGGAN" \
    KeyPenjual="$KEY_PENJUAL" \
    RetainTableOnDelete="$RETAIN"

# 6. Ambil URL dan simpan semuanya ke .env (hanya bisa dibaca pemilik, tidak di-commit).
URL="$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text)"
API_URL="${URL%/}"

umask 077
cat > .env <<EOF
KEY_PELANGGAN=$KEY_PELANGGAN
KEY_PENJUAL=$KEY_PENJUAL
API_URL=$API_URL
EOF

echo
echo "Selesai."
echo "  URL aplikasi : $API_URL"
echo "  Kunci API    : tersimpan di .env (lihat dengan: cat .env)"
echo "  Tes API      : bash scripts/test-api.sh"
