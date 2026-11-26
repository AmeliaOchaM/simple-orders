// Koneksi DynamoDB bersama untuk semua handler pesanan.
// Perintah Get/Put/Update/Delete ikut diekspor dari sini, supaya unit test cukup
// mengganti modul ini dengan DynamoDB tiruan (tanpa perlu memasang AWS SDK).
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

// DocumentClient: bisa langsung memakai objek JS biasa (tanpa format { S: '...' }).
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Nama tabel diisi CloudFormation lewat env var.
const TABLE_NAME = process.env.TABLE_NAME || 'orders';

module.exports = { db, TABLE_NAME, GetCommand, PutCommand, UpdateCommand, DeleteCommand };
