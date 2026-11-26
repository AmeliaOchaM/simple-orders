// Titik masuk Lambda OrdersFn (handler: index.handler).
// Di sini hanya menyambungkan konfigurasi (env var) dengan logika di app.mjs.
import { buatHandler } from './app.mjs';

export const handler = buatHandler({
  // Kunci API diisi dari parameter CloudFormation (NoEcho). Jangan dicetak ke log.
  keys: {
    pelanggan: process.env.KEY_PELANGGAN,
    penjual: process.env.KEY_PENJUAL,
  },
  // Tahap 3: aksi CRUD DynamoDB.
  aksi: {},
  // Tahap 4: halaman web.
  html: '<!doctype html><title>Simple Orders</title><p>Halaman web dibuat di tahap 4.</p>',
});
