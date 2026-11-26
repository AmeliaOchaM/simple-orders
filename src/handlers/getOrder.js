// GET /orders/{id} - pembeli melihat satu pesanan.
const { db, TABLE_NAME, GetCommand } = require('../utils/dynamodb');
const { validasiId } = require('../utils/validate');
const { json, gagal } = require('../utils/response');

module.exports = async (event, id) => {
  const salah = validasiId(id);
  if (salah) return gagal(400, salah);

  const hasil = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: { orderId: id } }));
  if (!hasil.Item) return gagal(404, 'Pesanan tidak ditemukan');
  return json(200, hasil.Item);
};
