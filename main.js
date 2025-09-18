const { spawn } = require('child_process');

const {
  default: makeWaSocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  jidNormalizedUser
} = require("@whiskeysockets/baileys");
const chalk = require("chalk");
const qrcode = require("qrcode-terminal");
const inquirer = require("inquirer");
const fs = require('fs');
const path = require('path');
const pino = require("pino");

// Buat struktur folder yang diperlukan
if (!fs.existsSync('data/logs')) {
  fs.mkdirSync('data/logs', { recursive: true });
}
if (!fs.existsSync('data/lists')) {
  fs.mkdirSync('data/lists', { recursive: true });
}

(async () => {
  let myJid = null;
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const connectionOptions = {
    logger: require("pino")({ level: "silent" }),
    auth: state,
    printQRInTerminal: false
  };

  let conn = makeWaSocket(connectionOptions);
  let pythonProcess = null;

  // Fungsi untuk mendownload media dengan caching berbasis fileSha256 dari WhatsApp
  async function downloadMedia(m) {
    try {
      const messageType = Object.keys(m.message)[0];
      const mediaMessage = m.message[messageType];

      if (!mediaMessage.fileSha256) {
        throw new Error('No fileSha256 found in message, cannot cache.');
      }

      const mediaType = messageType === 'imageMessage' ? 'image' : 'video';
      const mimetype = mediaMessage.mimetype;
      const extension = mimetype.split('/')[1].split(';')[0];

      // Gunakan fileSha256 (base64) sebagai nama file cache yang stabil
      const cacheKey = mediaMessage.fileSha256.toString('base64url');
      const filename = `${cacheKey}.${extension}`;
      const filepath = path.join('data', filename);

      // Cek jika file sudah ada (cache hit)
      if (fs.existsSync(filepath)) {
        console.log(chalk.blue(`Cache hit for media ${filename}, using existing file.`));
      } else {
        // Download media jika belum ada (cache miss)
        console.log(chalk.green(`Cache miss for media ${filename}, downloading...`));
        const buffer = await downloadMediaMessage(
          m,
          "buffer",
          {},
          { logger: pino({ level: "silent" }) }
        );
        fs.writeFileSync(filepath, buffer);
        console.log(chalk.green(`Media saved to ${filepath}`));
      }

      return {
        type: mediaType,
        path: filepath,
        mimetype: mimetype
      };
    } catch (e) {
      console.error('Error downloading media:', e);
      return null;
    }
  }

  // Fungsi untuk memulai proses Python
  function startPythonProcess() {
    if (pythonProcess) {
      pythonProcess.kill();
    }

    pythonProcess = spawn('python', ['send.py']);

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();

      // Pisahkan output menjadi baris-baris
      const lines = output.split('\n');

      for (const line of lines) {
        if (line.trim() === '') continue;

        try {
          // Coba parse sebagai JSON
          const response = JSON.parse(line);
          fs.appendFileSync('data/logs/python_responses.log', JSON.stringify(response, null, 2) + '\n---\n');
          console.log(chalk.blue('Response from Python:'), response);

          if (response.type === 'reply') {
            // Balas ke pengirim
            conn.sendMessage(response.to, { text: response.text });
          }
          else if (response.type === 'send_message') {
            // Kirim ke nomor tertentu (!kirim)
            if (response.has_media && response.media_path) {
              // Kirim media dengan caption
              const buffer = fs.readFileSync(response.media_path);

              if (response.media_type === 'image') {
                conn.sendMessage(response.to, {
                  image: buffer,
                  caption: response.caption || '',
                  mimetype: response.media_mimetype || 'image/jpeg'
                });
              } else if (response.media_type === 'video') {
                conn.sendMessage(response.to, {
                  video: buffer,
                  caption: response.caption || '',
                  mimetype: response.media_mimetype || 'video/mp4'
                });
              }
              console.log(chalk.green(`Media sent to ${response.to}`));
            } else {
              // Kirim teks biasa
              conn.sendMessage(response.to, { text: response.text });
              console.log(chalk.green(`Message sent to ${response.to}`));
            }
          }
          else if (response.type === 'broadcast') {
            // Kirim broadcast ke semua (!broadcast)
            console.log(chalk.yellow(`Broadcasting to ${response.recipients.length} recipients`));

            // Fungsi untuk menambahkan jeda
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            // Proses broadcast secara sekuensial dengan jeda
            (async () => {
              for (const recipient of response.recipients) {
                try {
                  let promise;
                  if (response.has_media && response.media_path) {
                    const buffer = fs.readFileSync(response.media_path);
                    if (response.media_type === 'image') {
                      promise = conn.sendMessage(recipient, {
                        image: buffer,
                        caption: response.caption || '',
                        mimetype: response.media_mimetype || 'image/jpeg'
                      });
                    } else if (response.media_type === 'video') {
                      promise = conn.sendMessage(recipient, {
                        video: buffer,
                        caption: response.caption || '',
                        mimetype: response.media_mimetype || 'video/mp4'
                      });
                    }
                  } else {
                    promise = conn.sendMessage(recipient, { text: response.text });
                  }
                  await promise;

                  const logMessage = `[BERHASIL] mengirim pesan ke: ${recipient}`;
                  console.log(chalk.green(logMessage));
                  fs.appendFileSync('broadcast.log', logMessage + '\n');

                } catch (e) {
                  const logMessage = `[GAGAL] mengirim pesan ke: ${recipient}`;
                  console.error(chalk.red(logMessage), e);
                  fs.appendFileSync('broadcast.log', logMessage + ` - Error: ${e}\n`);
                }

                // Jeda waktu acak antara 4 sampai 10 detik
                const delay = Math.floor(Math.random() * 6000) + 4000;
                console.log(chalk.gray(`Menunggu ${delay / 1000} detik sebelum pesan berikutnya...`));
                await sleep(delay);
              }
              console.log(chalk.green('Broadcast completed'));
            })();
          }
          else if (response.type === 'clear_cache') {
            const dataDir = 'data';
            const allowedExtensions = ['.mp4', '.jpeg', '.png', '.jpg', '.webp', '.gif'];
            let deletedCount = 0;

            fs.readdir(dataDir, (err, files) => {
              if (err) {
                console.error(chalk.red('Error reading data directory:', err));
                conn.sendMessage(response.to, { text: '❌ Gagal membaca direktori cache.' });
                return;
              }

              files.forEach(file => {
                const fileExt = path.extname(file).toLowerCase();
                if (allowedExtensions.includes(fileExt)) {
                  const filePath = path.join(dataDir, file);
                  try {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                  } catch (e) {
                    console.error(chalk.red(`Failed to delete ${filePath}:`, e));
                  }
                }
              });

              const replyText = `✅ Cache media berhasil dibersihkan. ${deletedCount} file dihapus.`;
              conn.sendMessage(response.to, { text: replyText });
              console.log(chalk.green(replyText));
            });
          }
        } catch (error) {
          // Jika bukan JSON, tampilkan sebagai log biasa
          if (!line.includes('Python Bot Logic Ready')) {
            console.log(chalk.gray('[Python]'), line.trim());
          }
        }
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error(chalk.red(`[Python Error] ${data}`));
    });

    pythonProcess.on('close', (code) => {
      console.log(chalk.yellow(`Python process exited with code ${code}`));
      // Jangan restart otomatis di sini untuk menghindari loop.
      // Biarkan connection handler yang mengelola restart.
    });
  }

  // Fungsi untuk mengirim pesan ke Python
  function sendToPython(messageData) {
    if (pythonProcess && pythonProcess.stdin.writable) {
      pythonProcess.stdin.write(JSON.stringify(messageData) + '\n');
    }
  }

  async function connectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const { request } = await inquirer.prompt([
        {
          type: "list",
          name: "request",
          message: "Ingin menggunakan login method?",
          choices: [
            { name: "QrCode", value: "qr" },
            { name: "PairingCode", value: "pairing" }
          ]
        }
      ]);

      if (request == "qr") {
        console.log(chalk.cyan("\nScan QR dibawah"));
        qrcode.generate(qr, { small: true });
      }
      if (request == "pairing") {
        const { waNumber } = await inquirer.prompt([
          {
            type: "input",
            name: "waNumber",
            message: chalk.blue("Masukkan nomor WhatsApp anda:"),
            validate: input => {
              if (!/^\d+$/.test(input)) {
                return "Masukkan angka saja";
              }
              if (input.length < 8) {
                return "Nomor terlalu pendek";
              }
              return true;
            }
          }
        ]);
        const code = await conn.requestPairingCode(waNumber);
        console.log(
          chalk.green("Your Pairing Code: " + chalk.bold(code))
        );
      }
    }

    if (connection == "open") {
      myJid = conn.user.id;
      console.log(
        chalk.greenBright("Connected as: " + chalk.yellow(conn.user.id))
      );
      // Mulai proses Python setelah terhubung
      startPythonProcess();

      // Kirim info koneksi ke Python
      sendToPython({
        type: "connection",
        status: "connected",
        user: conn.user.id
      });
    }
    if (connection == "close") {
      console.log(chalk.red("Connection Closed, restarting Bot..."));
      if (pythonProcess) {
        pythonProcess.kill();
      }
    }

    if (
      lastDisconnect &&
      lastDisconnect.error &&
      lastDisconnect.error.output &&
      lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
    ) {
      console.log(chalk.red("Reloading Bot..."));
      reload(true);
    }
  }

  function reload(restartConn) {
    if (restartConn) {
      try {
        conn.ws.close();
      } catch { }
      conn = makeWaSocket(connectionOptions);
    }

    conn.ev.on("creds.update", saveCreds);
    conn.ev.on("connection.update", connectionUpdate);

    // --- listener pesan masuk ---
    conn.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages[0];

      // Abaikan pesan jika tidak ada isi, atau jika pesan dari bot tapi bukan untuk bot
      if (!m.message || (m.key.fromMe && jidNormalizedUser(m.key.remoteJid) !== jidNormalizedUser(myJid))) {
        return;
      }

      const sender = m.key.remoteJid; // id pengirim
      const text = m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message.imageMessage?.caption ||
        m.message.videoMessage?.caption ||
        "";

      // Hanya proses pesan yang diawali dengan '!'
      if (!text.startsWith('!')) {
        return;
      }

      const name = m.pushName || "Unknown";

      // Cek jika pesan mengandung media
      let mediaData = null;
      if (m.message?.imageMessage || m.message?.videoMessage) {
        console.log(chalk.cyan('Media detected, downloading...'));
        mediaData = await downloadMedia(m);

        if (mediaData) {
          console.log(chalk.green('Media downloaded successfully'));
        } else {
          console.log(chalk.red('Failed to download media'));
        }
      }

      // Kirim data pesan ke Python
      const messageData = {
        type: "message",
        from: sender,
        text: text,
        name: name,
        timestamp: new Date().toISOString(),
        has_media: mediaData !== null,
        media_type: mediaData?.type,
        media_path: mediaData?.path, // Kirim path file, bukan buffer
        media_mimetype: mediaData?.mimetype
      };

      sendToPython(messageData);

      // Log pesan masuk
      if (mediaData) {
        console.log(chalk.magenta(`Media received from ${name}: ${mediaData.type}`));
      } else if (text) {
        console.log(chalk.magenta(`Message from ${name}: ${text}`));
      }
    });

    return true;
  }

  reload();
})();
