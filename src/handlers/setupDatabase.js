// Kelola tabel DynamoDB. BUKAN rute HTTP: hanya dijalankan bila OrdersFn dipanggil
// langsung lewat "aws lambda invoke" (dari deploy.sh / teardown.sh), lihat src/index.js.
//   {"action":"setupDatabase"}  -> buat tabel bila belum ada, tunggu sampai ACTIVE
//   {"action":"deleteDatabase"} -> hapus tabel, tunggu sampai benar-benar hilang
const {
  client, TABLE_NAME, CreateTableCommand, DeleteTableCommand,
  waitUntilTableExists, waitUntilTableNotExists,
} = require('../utils/dynamodb');

async function setupDatabase() {
  let status = 'dibuat';
  try {
    await client.send(new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST', // bayar per permintaan, tanpa atur kapasitas
      AttributeDefinitions: [{ AttributeName: 'orderId', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'orderId', KeyType: 'HASH' }],
    }));
  } catch (e) {
    if (e.name !== 'ResourceInUseException') throw e;
    status = 'sudah ada, dipakai ulang'; // data lama tetap ada
  }
  await waitUntilTableExists({ client, maxWaitTime: 50 }, { TableName: TABLE_NAME });
  return status;
}

async function deleteDatabase() {
  try {
    await client.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return 'tidak ada, dilewati';
    throw e;
  }
  // Tunggu sampai hilang, supaya deploy ulang tidak bertabrakan dengan status DELETING.
  await waitUntilTableNotExists({ client, maxWaitTime: 50 }, { TableName: TABLE_NAME });
  return 'dihapus';
}

const AKSI = { setupDatabase, deleteDatabase };

// Hasil sukses: { ok: true, ... }. Bila gagal, error dilempar (deploy.sh akan berhenti).
exports.handler = async (event) => {
  if (!Object.hasOwn(AKSI, event.action)) throw new Error(`action tidak dikenal: ${event.action}`);
  const status = await AKSI[event.action]();
  console.log(JSON.stringify({ action: event.action, table: TABLE_NAME, status }));
  return { ok: true, action: event.action, table: TABLE_NAME, status };
};
