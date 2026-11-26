// Logika halaman Simple Orders. Memanggil API di URL yang sama dengan header X-Api-Key.
// Data dari API selalu ditulis dengan textContent (bukan innerHTML) supaya aman dari XSS.

const $ = (id) => document.getElementById(id);

const LABEL = {
  orderId: 'ID',
  customerName: 'Nama',
  item: 'Menu',
  quantity: 'Jumlah',
  status: 'Status',
  createdAt: 'Dibuat',
};

// ---------- Tampilan hasil ----------

function tampilPesan(teks, jenis) {
  const kotak = $('hasil');
  kotak.className = `hasil ${jenis || ''}`;
  kotak.textContent = teks;
}

function tampilPesanan(judul, p) {
  const kotak = $('hasil');
  kotak.className = 'hasil';
  const h = document.createElement('p');
  h.className = 'judul';
  h.textContent = judul;

  const dl = document.createElement('dl');
  for (const [kunci, label] of Object.entries(LABEL)) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    if (kunci === 'orderId') {
      const code = document.createElement('code');
      code.textContent = p.orderId;
      dd.append(code);
    } else if (kunci === 'status') {
      const span = document.createElement('span');
      span.className = `label-status ${p.status}`;
      span.textContent = p.status === 'done' ? 'Diterima' : 'Menunggu';
      dd.append(span);
    } else if (kunci === 'createdAt') {
      dd.textContent = new Date(p.createdAt).toLocaleString('id-ID');
    } else {
      dd.textContent = p[kunci];
    }
    dl.append(dt, dd);
  }
  kotak.replaceChildren(h, dl);
}

// ---------- Panggil API ----------

// Hasil: data JSON bila sukses, atau null bila gagal (pesan error sudah ditampilkan).
async function panggilApi(method, path, body) {
  const kunci = $('kunci').value.trim();
  if (!kunci) {
    tampilPesan('Isi kunci API terlebih dahulu.', 'error');
    return null;
  }
  const headers = { 'X-Api-Key': kunci };
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      tampilPesan(`Error ${res.status}: ${data.error || res.statusText}`, 'error');
      return null;
    }
    return data;
  } catch (e) {
    tampilPesan(`Gagal terhubung ke server: ${e.message}`, 'error');
    return null;
  }
}

// Panggil API sambil mematikan tombol (mencegah klik ganda). Hasil: data atau null.
async function sibuk(tombol, method, path, body) {
  tombol.disabled = true;
  try {
    return await panggilApi(method, path, body);
  } finally {
    tombol.disabled = false;
  }
}

// ---------- Tombol aksi (di bawah hasil cek) ----------

// Tampilkan tombol aksi untuk pesanan hasil cek, atau sembunyikan (pesanan = null).
function aturAksi(pesanan) {
  $('aksi-pesanan').hidden = !pesanan;
  $('btn-selesai').disabled = !pesanan || pesanan.status === 'done';
}

// ID diambil dari form cek. Bila ID diubah, tombol disembunyikan sampai "Cek" lagi,
// supaya aksi tidak mengenai pesanan lain dari yang sedang tampil.
const idCek = () => encodeURIComponent($('cek-id').value.trim());
$('cek-id').addEventListener('input', () => aturAksi(null));

// ---------- Buat & cek pesanan ----------

$('form-buat').addEventListener('submit', async (e) => {
  e.preventDefault();
  aturAksi(null);
  const data = await sibuk(e.submitter, 'POST', '/orders', {
    customerName: $('buat-nama').value,
    item: $('buat-menu').value,
    quantity: Number($('buat-jumlah').value),
  });
  if (!data) return;
  tampilPesanan('Pesanan dibuat. Simpan ID untuk mengecek pesanan.', data);
  $('cek-id').value = data.orderId; // isi otomatis form cek
  e.target.reset();
});

$('form-cek').addEventListener('submit', async (e) => {
  e.preventDefault();
  aturAksi(null);
  const data = await sibuk(e.submitter, 'GET', `/orders/${idCek()}`);
  if (!data) return;
  tampilPesanan('Detail pesanan', data);
  aturAksi(data);
});

$('btn-selesai').addEventListener('click', async () => {
  const data = await sibuk($('btn-selesai'), 'PUT', `/orders/${idCek()}`, { status: 'done' });
  if (!data) return;
  tampilPesanan('Pesanan ditandai diterima', data);
  aturAksi(data); // tombol "Tandai diterima" jadi nonaktif
});

$('btn-hapus').addEventListener('click', async () => {
  if (!confirm('Batalkan pesanan ini? Pesanan akan dihapus.')) return;
  const id = $('cek-id').value.trim();
  const data = await sibuk($('btn-hapus'), 'DELETE', `/orders/${idCek()}`);
  if (!data) return;
  tampilPesan(`Pesanan ${id} dibatalkan.`, 'sukses');
  aturAksi(null);
});
