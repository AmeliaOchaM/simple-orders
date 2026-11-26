// PUT /orders/{id} - penjual mengubah status atau isi pesanan (boleh sebagian field).
const { db, TABLE_NAME, UpdateCommand } = require('../utils/dynamodb');
const { validasiId, validasiUbah, bacaJson, bersihkan } = require('../utils/validate');
const { json, gagal } = require('../utils/response');

module.exports = async (event, id) => {
  const salahId = validasiId(id);
  if (salahId) return gagal(400, salahId);
  const { data, error } = bacaJson(event);
  if (error) return gagal(400, error);
  const salah = validasiUbah(data);
  if (salah) return gagal(400, salah);

  // Susun "SET #f0 = :v0, #f1 = :v1". Nama field memakai placeholder #
  // karena "status" dan "item" adalah kata terlarang (reserved word) di DynamoDB.
  const ubah = bersihkan(data);
  const names = {};
  const values = {};
  const bagian = Object.keys(ubah).map((k, i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = ubah[k];
    return `#f${i} = :v${i}`;
  });

  try {
    const hasil = await db.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { orderId: id },
      UpdateExpression: 'SET ' + bagian.join(', '),
      ConditionExpression: 'attribute_exists(orderId)', // jangan buat pesanan baru lewat PUT
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));
    return json(200, hasil.Attributes);
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return gagal(404, 'Pesanan tidak ditemukan');
    throw e;
  }
};
