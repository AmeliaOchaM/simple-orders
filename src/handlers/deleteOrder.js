// DELETE /orders/{id} - penjual menghapus pesanan.
const { db, TABLE_NAME, DeleteCommand } = require('../utils/dynamodb');
const { validasiId } = require('../utils/validate');
const { json, gagal } = require('../utils/response');

module.exports = async (event, id) => {
  const salah = validasiId(id);
  if (salah) return gagal(400, salah);

  try {
    await db.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { orderId: id },
      ConditionExpression: 'attribute_exists(orderId)', // supaya bisa membalas 404
    }));
    return json(200, { message: 'Pesanan dihapus', orderId: id });
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return gagal(404, 'Pesanan tidak ditemukan');
    throw e;
  }
};
