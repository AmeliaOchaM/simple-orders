#!/usr/bin/env bash
# Tes end-to-end API Simple Orders dengan curl (jalankan setelah deploy.sh).
# Hasil dicetak ke layar dan disimpan ke out/hasil-tes-<waktu>.txt.
# Kunci API dibaca dari .env dan tidak ditulis ke hasil tes.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

if [[ ! -f .env ]]; then
  echo "File .env tidak ada. Jalankan dulu: bash scripts/deploy.sh" >&2
  exit 1
fi
# shellcheck disable=SC1091
source .env
: "${API_URL:?API_URL kosong di .env}" "${KEY_PELANGGAN:?}" "${KEY_PENJUAL:?}"

mkdir -p out
OUT="out/hasil-tes-$(date +%Y%m%d-%H%M%S).txt"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
LULUS=0
GAGAL=0

catat() { echo "$*" | tee -a "$OUT"; }

# uji <kode> <nama> <status-harapan> <method> <path> [kunci] [body-json]
uji() {
  local kode="$1" nama="$2" harap="$3" method="$4" path="$5" kunci="${6:-}" data="${7:-}"
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$method" "$API_URL$path")
  [[ -n "$kunci" ]] && args+=(-H "X-Api-Key: $kunci")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' -d "$data")

  local dapat
  dapat="$(curl "${args[@]}")"
  if [[ "$dapat" == "$harap" ]]; then
    LULUS=$((LULUS + 1))
    catat "$(printf 'OK    %-4s %-40s (harap %s, dapat %s)' "$kode" "$nama" "$harap" "$dapat")"
  else
    GAGAL=$((GAGAL + 1))
    catat "$(printf 'GAGAL %-4s %-40s (harap %s, dapat %s) %s' "$kode" "$nama" "$harap" "$dapat" "$(head -c 200 "$BODY")")"
  fi
}

catat "Tes API Simple Orders - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
catat "URL: $API_URL"
catat ""

PESANAN='{"customerName":"Budi","item":"Nasi goreng","quantity":2}'
ID_PALSU='00000000-0000-4000-8000-000000000000'

uji T1  "Tanpa kunci"                401 GET  "/orders/$ID_PALSU"
uji T2  "Kunci salah"                401 GET  "/orders/$ID_PALSU" "kunci-salah"
uji T3  "Route salah"                404 GET  "/tidak-ada" "$KEY_PELANGGAN"
uji T4  "Pelanggan POST pesanan"     201 POST "/orders" "$KEY_PELANGGAN" "$PESANAN"

# Ambil orderId dari balasan T4 untuk tes berikutnya.
ID="$(grep -o '"orderId":"[^"]*"' "$BODY" | cut -d'"' -f4)"
if [[ -z "$ID" ]]; then
  catat "orderId tidak didapat dari T4, tes berikutnya memakai ID palsu."
  ID="$ID_PALSU"
fi
catat "     orderId: $ID"

uji T5  "Pelanggan GET pesanan"      200 GET    "/orders/$ID" "$KEY_PELANGGAN"
uji T6  "Penjual GET pesanan"        200 GET    "/orders/$ID" "$KEY_PENJUAL"
uji T7  "Pelanggan PUT (dilarang)"   403 PUT    "/orders/$ID" "$KEY_PELANGGAN" '{"status":"done"}'
uji T7b "Penjual POST (dilarang)"    403 POST   "/orders" "$KEY_PENJUAL" "$PESANAN"
uji T8  "Penjual PUT status done"    200 PUT    "/orders/$ID" "$KEY_PENJUAL" '{"status":"done"}'
uji T9  "POST quantity 0"            400 POST   "/orders" "$KEY_PELANGGAN" '{"customerName":"Budi","item":"Es teh","quantity":0}'
uji T10 "PUT status salah"           400 PUT    "/orders/$ID" "$KEY_PENJUAL" '{"status":"selesai"}'
uji T11 "Pelanggan DELETE (dilarang)" 403 DELETE "/orders/$ID" "$KEY_PELANGGAN"
uji T12 "Penjual DELETE pesanan"     200 DELETE "/orders/$ID" "$KEY_PENJUAL"
uji T13 "GET setelah dihapus"        404 GET    "/orders/$ID" "$KEY_PENJUAL"

catat ""
catat "Total: $((LULUS + GAGAL)) tes, $LULUS OK, $GAGAL GAGAL"
echo "Hasil disimpan di $OUT"
[[ "$GAGAL" -eq 0 ]]
