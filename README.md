# Bot WhatsApp dengan Node.js dan Python

Bot WhatsApp ini menggunakan `@whiskeysockets/baileys` untuk terhubung ke WhatsApp dan menjalankan logika bot yang ditulis dalam Python. Bot ini mampu menangani perintah, mengirim pesan, mengelola daftar siaran (broadcast), dan terintegrasi dengan Google Gemini AI.

## Fitur Utama

- **Koneksi Stabil**: Menggunakan Baileys untuk koneksi ke WhatsApp Web.
- **Login Mudah**: Mendukung login melalui kode QR dan kode penyandingan (pairing code).
- **Logika Terpisah**: Proses koneksi (Node.js) dan logika perintah (Python) berjalan terpisah, memungkinkan pengembangan yang lebih mudah.
- **Manajemen Broadcast**:
    - Memulai, melanjutkan, dan membatalkan sesi broadcast.
    - Menambah nomor ke daftar broadcast dari teks atau file.
    - Menyimpan progres broadcast dan dapat dilanjutkan setelah bot di-restart.
- **Pengiriman Pesan**: Kirim pesan teks atau media ke nomor tertentu.
- **Integrasi AI**: Terhubung dengan Google Gemini untuk menjawab pertanyaan (memerlukan API Key).
- **Manajemen Cache**: Perintah untuk membersihkan file media yang diunduh.

## Prasyarat

- [Node.js](https://nodejs.org/) (v14 atau lebih baru)
- [Python](https://www.python.org/) (v3.6 atau lebih baru)
- `colorama` dan `python-dotenv` untuk Python.

## Instalasi

1.  **Clone repository ini:**
    ```bash
    git clone https://github.com/Hydra0xetc/WhatsAppBot.git
    cd bot_whatsapp
    ```

2.  **Install dependensi Node.js:**
    ```bash
    npm install
    ```

3.  **Install dependensi Python:**
    ```bash
    pip install colorama python-dotenv
    ```

4.  **Konfigurasi API Key (Opsional):**
    Jika Anda ingin menggunakan fitur `!ai`, buat file bernama `.env` di direktori utama proyek dan tambahkan kunci API Gemini Anda:
    ```
    GEMINI_API_KEY="API_KEY_ANDA_DISINI"
    ```

## Menjalankan Bot

Untuk memulai bot, jalankan perintah berikut di terminal Anda:

```bash
npm start
```

Saat pertama kali dijalankan, Anda akan diminta untuk memilih metode login (Kode QR atau Kode Penyandingan) untuk menghubungkan bot dengan nomor WhatsApp Anda.

## Daftar Perintah

Semua perintah harus diawali dengan `!`.

- `!help`: Menampilkan semua perintah yang tersedia.
- `!time`: Menampilkan waktu server saat ini.
- `!kirim <nomor> <pesan>`: Mengirim pesan ke nomor tertentu.
  - Contoh: `!kirim 6281234567890 Halo, apa kabar?`
- `!broadcast <pesan>`: Memulai broadcast pesan ke semua nomor di daftar broadcast. Bisa juga dengan mengirim media (gambar/video) dengan caption `!broadcast`.
- `!lanjutkan`: Melanjutkan sesi broadcast yang dijeda (misalnya karena error atau bot berhenti).
- `!batalkan`: Membatalkan sesi broadcast yang aktif dan menghapus antriannya.
- `!tambah <nomor>`: Menambahkan satu nomor ke daftar broadcast.
  - Contoh: `!tambah 6281234567890`
- `!tambah txt`: Menambahkan semua nomor yang ada di file `nomor.txt` ke daftar broadcast.
- `!cek`: Menampilkan semua nomor yang ada di daftar broadcast.
- `!clear`: Membersihkan cache media (file gambar/video yang telah diunduh).
- `!ai <pertanyaan>`: Mengirim pertanyaan ke Gemini AI dan mendapatkan jawabannya.

## Struktur File

```
.
├── auth/             # Menyimpan kredensial sesi WhatsApp
├── data/             # Menyimpan file data (job broadcast, cache media)
│   ├── lists/        # Menyimpan daftar nomor (broadcast_list.txt)
│   └── ...
├── node_modules/     # Dependensi Node.js
├── .env              # File untuk menyimpan API Key (opsional)
├── .gitignore
├── main.js           # Titik masuk utama, menangani koneksi WhatsApp
├── package.json      # Konfigurasi proyek Node.js
├── send.py           # (Python) Logika untuk semua perintah bot
├── nomor.txt         # (Opsional) Daftar nomor untuk ditambahkan ke broadcast
└── README.md         # File ini
```
