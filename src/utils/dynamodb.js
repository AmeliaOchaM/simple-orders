// Koneksi DynamoDB bersama untuk semua handler.
// Semua perintah ikut diekspor dari sini, supaya unit test cukup mengganti
// modul ini dengan DynamoDB tiruan (tanpa perlu memasang AWS SDK).
const {
  DynamoDBClient, CreateTableCommand, DeleteTableCommand,
  waitUntilTableExists, waitUntilTableNotExists,
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

// client: untuk perintah tabel (buat/hapus tabel).
const client = new DynamoDBClient({});
// db (DocumentClient): untuk item, bisa langsung memakai objek JS biasa.
const db = DynamoDBDocumentClient.from(client);

// Nama tabel diisi CloudFormation lewat env var.
const TABLE_NAME = process.env.TABLE_NAME || 'orders';

module.exports = {
  client, db, TABLE_NAME,
  GetCommand, PutCommand, UpdateCommand, DeleteCommand,
  CreateTableCommand, DeleteTableCommand, waitUntilTableExists, waitUntilTableNotExists,
};
