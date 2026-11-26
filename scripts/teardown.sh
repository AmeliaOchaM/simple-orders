#!/usr/bin/env bash
# Hapus Simple Orders dari AWS CloudShell.
#
# Pakai:
#   bash scripts/teardown.sh               # hapus tabel (beserta data) + stack
#   RETAIN=true bash scripts/teardown.sh   # SIMPAN tabel, hapus stack saja
#
# File .env (kunci) tetap disimpan supaya deploy ulang memakai kunci yang sama.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-simple-orders}"
RETAIN="${RETAIN:-false}"
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"

if ! aws cloudformation describe-stacks --stack-name "$STACK" >/dev/null 2>&1; then
  echo "Stack $STACK tidak ada, tidak ada yang dihapus."
  exit 0
fi

FN="$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionName'].OutputValue" --output text)"

# 1. Hapus tabel lewat fungsi (selama fungsi masih ada), kecuali RETAIN=true.
if [[ "$RETAIN" == "true" ]]; then
  echo "==> RETAIN=true: tabel DynamoDB DISIMPAN (deploy ulang akan memakai data yang sama)"
else
  echo "==> Menghapus tabel DynamoDB"
  mkdir -p build
  aws lambda invoke --function-name "$FN" \
    --cli-binary-format raw-in-base64-out \
    --payload '{"action":"deleteDatabase"}' \
    build/teardown-hasil.json >/dev/null
  if ! grep -q '"ok":true' build/teardown-hasil.json; then
    echo "Gagal menghapus tabel, stack TIDAK dihapus:" >&2
    cat build/teardown-hasil.json >&2
    echo >&2
    exit 1
  fi
  echo "    $(cat build/teardown-hasil.json)"
fi

# 2. Hapus stack (Lambda, Function URL, izin).
echo "==> Menghapus stack $STACK"
aws cloudformation delete-stack --stack-name "$STACK"
aws cloudformation wait stack-delete-complete --stack-name "$STACK"

rm -rf build
echo "Selesai. File .env tetap disimpan (hapus manual bila tidak diperlukan)."
