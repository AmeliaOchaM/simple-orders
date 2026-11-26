// Custom Resource TableCreator: membuat/menghapus tabel DynamoDB untuk CloudFormation.
// Dipakai karena user sandbox tidak boleh CreateTable langsung, tapi LabRole boleh.
// Balasan ke CloudFormation dikirim sendiri lewat https PUT (tanpa modul cfn-response).
const https = require('node:https');
const {
  DynamoDBClient, CreateTableCommand, DeleteTableCommand, waitUntilTableExists,
} = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({});

// Kirim hasil (SUCCESS/FAILED) ke URL S3 bertanda tangan milik CloudFormation.
// Tanpa balasan ini, stack akan menunggu sampai timeout (sekitar 1 jam).
function balasCfn(event, context, status, idFisik, alasan) {
  const body = JSON.stringify({
    Status: status,
    Reason: alasan || `Lihat log CloudWatch: ${context.logStreamName}`,
    PhysicalResourceId: idFisik,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
  });
  return new Promise((resolve) => {
    const req = https.request(event.ResponseURL, {
      method: 'PUT',
      headers: { 'content-type': '', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', (e) => {
      console.error('Gagal mengirim balasan ke CloudFormation:', e.message);
      resolve();
    });
    req.end(body);
  });
}

// Buat tabel bila belum ada, lalu tunggu sampai ACTIVE.
async function buatTabel(nama) {
  try {
    await client.send(new CreateTableCommand({
      TableName: nama,
      BillingMode: 'PAY_PER_REQUEST', // bayar per permintaan, tanpa atur kapasitas
      AttributeDefinitions: [{ AttributeName: 'orderId', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'orderId', KeyType: 'HASH' }],
    }));
  } catch (e) {
    if (e.name !== 'ResourceInUseException') throw e;
    console.log('Tabel sudah ada, dipakai ulang:', nama);
  }
  await waitUntilTableExists({ client, maxWaitTime: 90 }, { TableName: nama });
}

// Hapus tabel. Abaikan bila tabel sudah tidak ada.
async function hapusTabel(nama, simpan) {
  if (simpan) {
    console.log('RetainOnDelete=true, tabel tidak dihapus:', nama);
    return;
  }
  try {
    await client.send(new DeleteTableCommand({ TableName: nama }));
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
  }
}

exports.handler = async (event, context) => {
  console.log('Permintaan CloudFormation:', event.RequestType, event.LogicalResourceId);
  const nama = event.ResourceProperties.TableName;
  // PhysicalResourceId = nama tabel. Saat Delete, pakai nama yang tercatat di stack.
  const idFisik = event.RequestType === 'Delete' ? event.PhysicalResourceId : nama;
  try {
    // RetainOnDelete dikirim CloudFormation sebagai teks "true"/"false".
    const simpan = event.ResourceProperties.RetainOnDelete === 'true';
    if (event.RequestType === 'Delete') await hapusTabel(idFisik, simpan);
    else await buatTabel(nama); // Create atau Update
    await balasCfn(event, context, 'SUCCESS', idFisik);
  } catch (e) {
    console.error('Gagal:', e.name, e.message);
    await balasCfn(event, context, 'FAILED', idFisik || 'gagal-dibuat', `${e.name}: ${e.message}`);
  }
};
