#!/usr/bin/env bash
# Hapus semua resource Simple Orders dari AWS CloudShell.
# - Stack CloudFormation dihapus (Lambda, Function URL, izin).
# - Tabel ikut terhapus, KECUALI deploy terakhir memakai RETAIN=true.
# - Bucket kode dikosongkan lalu dihapus.
# File .env (kunci) tetap disimpan supaya deploy ulang memakai kunci yang sama.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-simple-orders}"
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"

AKUN="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="simple-orders-code-${AKUN}"

# 1. Hapus stack dulu (Lambda, Function URL, izin, dan tabel bila tidak RETAIN).
if aws cloudformation describe-stacks --stack-name "$STACK" >/dev/null 2>&1; then
  RETAIN="$(aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Parameters[?ParameterKey=='RetainTableOnDelete'].ParameterValue" --output text)"
  echo "==> Menghapus stack $STACK (RetainTableOnDelete=$RETAIN)"
  aws cloudformation delete-stack --stack-name "$STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK"
  if [[ "$RETAIN" == "true" ]]; then
    echo "    Tabel DynamoDB DISIMPAN. Deploy ulang akan memakai data yang sama."
  else
    echo "    Tabel DynamoDB ikut terhapus."
  fi
else
  echo "==> Stack $STACK tidak ada, dilewati"
fi

# 2. Kosongkan dan hapus bucket kode.
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "==> Mengosongkan dan menghapus bucket $BUCKET"
  aws s3 rm "s3://$BUCKET" --recursive --only-show-errors
  aws s3api delete-bucket --bucket "$BUCKET"
else
  echo "==> Bucket $BUCKET tidak ada, dilewati"
fi

rm -rf build
echo "Selesai. File .env tetap disimpan (hapus manual bila tidak diperlukan)."
