// POST /orders - pembeli membuat pesanan baru.
const { randomUUID } = require('node:crypto');
const { db, TABLE_NAME, PutCommand } = require('../utils/dynamodb');
const { bacaJson, validasiBuat, bersihkan } = require('../utils/validate');
const { json, gagal } = require('../utils/response');

module.exports = async (event) => {
  const { data, error } = bacaJson(event);
  if (error) return gagal(400, error);
  const salah = validasiBuat(data);
  if (salah) return gagal(400, salah);

  // orderId, status, dan createdAt selalu dibuat server.
  const pesanan = {
    orderId: randomUUID(),
    ...bersihkan(data),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await db.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: pesanan,
    ConditionExpression: 'attribute_not_exists(orderId)', // jangan pernah menimpa pesanan lain
  }));
  return json(201, pesanan);
};
