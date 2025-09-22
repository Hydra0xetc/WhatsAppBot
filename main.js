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

const BROADCAST_JOB_FILE = 'data/broadcast_job.json';

// Buat struktur folder yang diperlukan
if (!fs.existsSync('data/logs')) {
  fs.mkdirSync('data/logs', { recursive: true });
}
if (!fs.existsSync('data/lists')) {
  fs.mkdirSync('data/lists', { recursive: true });
}

(async () => {
  let myJid = null;
  let isExecutingBroadcast = false;
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const connectionOptions = {
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: false
  };

  let conn = makeWaSocket(connectionOptions);
  let pythonProcess = null;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function executeBroadcast() {
    if (isExecutingBroadcast) {
      console.log(chalk.yellow('Broadcast already in progress.'));
      return;
    }

    let job;
    try {
      if (!fs.existsSync(BROADCAST_JOB_FILE)) return;
      const fileContent = fs.readFileSync(BROADCAST_JOB_FILE, 'utf-8');
      job = JSON.parse(fileContent);
    } catch (e) {
      console.error(chalk.red('Error reading broadcast job file:'), e);
      return;
    }

    if (!job.isActive || job.pendingRecipients.length === 0) {
      if (job.isActive) { // If active but no recipients, mark as done
        job.isActive = false;
        fs.writeFileSync(BROADCAST_JOB_FILE, JSON.stringify(job, null, 2));
      }
      console.log(chalk.gray('No active broadcast job or no pending recipients.'));
      return;
    }

    isExecutingBroadcast = true;
    console.log(chalk.yellow(`--- Starting/Resuming Broadcast ---`));
    console.log(chalk.yellow(`Pending recipients: ${job.pendingRecipients.length}`));

    const { message, mediaInfo } = job;

    for (const recipient of [...job.pendingRecipients]) {
      try {
        let messagePromise;
        if (mediaInfo.has_media && mediaInfo.media_path) {
          const buffer = fs.readFileSync(mediaInfo.media_path);
          const mediaOptions = {
            caption: message || '',
            mimetype: mediaInfo.media_mimetype
          };
          if (mediaInfo.media_type === 'image') {
            messagePromise = conn.sendMessage(recipient, { image: buffer, ...mediaOptions });
          } else if (mediaInfo.media_type === 'video') {
            messagePromise = conn.sendMessage(recipient, { video: buffer, ...mediaOptions });
          }
        } else {
          messagePromise = conn.sendMessage(recipient, { text: message });
        }

        if (messagePromise) {
          await messagePromise;
          const logMessage = `[BERHASIL] mengirim pesan ke: ${recipient}`;
          console.log(chalk.green(logMessage));
          fs.appendFileSync('broadcast.log', logMessage + '\n');

          const currentJobContent = fs.readFileSync(BROADCAST_JOB_FILE, 'utf-8');
          const currentJob = JSON.parse(currentJobContent);
          currentJob.pendingRecipients = currentJob.pendingRecipients.filter(r => r !== recipient);
          fs.writeFileSync(BROADCAST_JOB_FILE, JSON.stringify(currentJob, null, 2));
        }

        const delay = Math.floor(Math.random() * 6000) + 6000; // 8-14 seconds
        console.log(chalk.gray(`Menunggu ${delay / 1000} detik...`));
        await sleep(delay);

      } catch (e) {
        const logMessage = `[GAGAL] mengirim pesan ke: ${recipient}`;
        console.error(chalk.red(logMessage), e);
        fs.appendFileSync('broadcast.log', logMessage + ` - Error: ${e}\n`);
        console.error(chalk.red.bold('\n [•] BROADCAST DIHENTIKAN KARENA KESALAHAN PENGIRIMAN.'));
        console.error(chalk.red.bold('Program akan berhenti. Silakan restart dan gunakan !lanjutkan untuk menyambung.'));
        process.exit(1);
      }
    }

    const finalJobContent = fs.readFileSync(BROADCAST_JOB_FILE, 'utf-8');
    const finalJob = JSON.parse(finalJobContent);
    finalJob.isActive = false;
    fs.writeFileSync(BROADCAST_JOB_FILE, JSON.stringify(finalJob, null, 2));

    console.log(chalk.green.bold('--- BROADCAST SELESAI ---'));
    isExecutingBroadcast = false;
  }

  async function downloadMedia(m) {
    try {
      const messageType = Object.keys(m.message)[0];
      const mediaMessage = m.message[messageType];
      if (!mediaMessage.fileSha256) throw new Error('No fileSha256 found');

      const mediaType = messageType === 'imageMessage' ? 'image' : 'video';
      const extension = mediaMessage.mimetype.split('/')[1].split(';')[0];
      const cacheKey = mediaMessage.fileSha256.toString('base64url');
      const filename = `${cacheKey}.${extension}`;
      const filepath = path.join('data', filename);

      if (!fs.existsSync(filepath)) {
        console.log(chalk.green(`Downloading media to ${filepath}...`));
        const buffer = await downloadMediaMessage(m, "buffer", {}, { logger: pino({ level: "silent" }) });
        fs.writeFileSync(filepath, buffer);
      }
      return { type: mediaType, path: filepath, mimetype: mediaMessage.mimetype };
    } catch (e) {
      console.error('Error downloading media:', e);
      return null;
    }
  }

  function debug(text) {
    console.log(chalk.yellowBright('[DEBUG]: ', text));
  }

  function logError(text) {
    console.error(chalk.redBright('[ERROR]: ', text));
  }

  function startPythonProcess() {
    if (pythonProcess) pythonProcess.kill();

    pythonProcess = spawn('python', ['send.py']);

    pythonProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim() !== '');
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          console.log(chalk.blue('Response from Python:'), response);

          switch (response.type) {
            case 'reply':
              conn.sendMessage(response.to, { text: response.text });
              break;

            case 'send_message':
              if (response.has_media && response.media_path) {
                const buffer = fs.readFileSync(response.media_path);
                const mediaOptions = { caption: response.caption || '', mimetype: response.media_mimetype };
                if (response.media_type === 'image') {
                  conn.sendMessage(response.to, { image: buffer, ...mediaOptions });
                } else if (response.media_type === 'video') {
                  conn.sendMessage(response.to, { video: buffer, ...mediaOptions });
                }
              } else {
                conn.sendMessage(response.to, { text: response.text });
              }
              console.log(chalk.green(`Message sent to ${response.to}`));
              break;

            case 'start_broadcast_job':
            case 'resume_broadcast_job':
              executeBroadcast();
              break;

            case 'clear_cache':
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
                    try {
                      fs.unlinkSync(path.join(dataDir, file));
                      deletedCount++;
                    } catch (e) { }
                  }
                });
                const replyText = `✅ Cache media berhasil dibersihkan. ${deletedCount} file dihapus.`;
                conn.sendMessage(response.to, { text: replyText });
                console.log(chalk.green(replyText));
              });
              break;
          }
        } catch (error) {
          if (!line.includes('Python Bot Logic Ready')) {
            debug(line.trim());
          }
        }
      }
    });

    pythonProcess.stderr.on('data', (data) => console.error(chalk.red(`[Python Error] ${data}`)));
    pythonProcess.on('close', (code) => console.log(chalk.yellow(`Python process exited with code ${code}`)));
  }

  function sendToPython(messageData) {
    if (pythonProcess && pythonProcess.stdin.writable) {
      pythonProcess.stdin.write(JSON.stringify(messageData) + '\n');
    }
  }

  async function connectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const { request } = await inquirer.prompt([{ type: "list", name: "request", message: "Pilih metode login:", choices: [{ name: "QrCode", value: "qr" }, { name: "PairingCode", value: "pairing" }] }]);
      if (request === "qr") {
        console.log(chalk.cyan("\nScan QR di bawah ini:"));
        qrcode.generate(qr, { small: true });
      } else if (request === "pairing") {
        const { waNumber } = await inquirer.prompt([{ type: "input", name: "waNumber", message: chalk.blue("Masukkan nomor WhatsApp Anda:"), validate: input => /^\d{8,}$/.test(input) ? true : "Nomor tidak valid." }]);
        const code = await conn.requestPairingCode(waNumber);
        console.log(chalk.green("Pairing Code Anda: " + chalk.bold(code)));
      }
    }

    if (connection === "open") {
      myJid = conn.user.id;
      console.log(chalk.greenBright("Connected as: " + chalk.yellow(conn.user.id)));
      startPythonProcess();
      sendToPython({ type: "connection", status: "connected", user: conn.user.id });

      setTimeout(() => {
        console.log(chalk.cyan('Mengecek broadcast yang tertunda...'));
        executeBroadcast();
      }, 5000);
    }

    if (connection === "close") {
      console.log(chalk.red("Connection Closed, restarting Bot..."));
      if (pythonProcess) pythonProcess.kill();
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        reload(true);
      } else {
        console.log(chalk.red.bold('Connection logged out, please re-scan QR code.'));
        process.exit(1); // Stop process
      }
    }
  }

  function reload(restartConn) {
    if (restartConn) {
      try { conn.ws.close(); } catch { }
      conn = makeWaSocket(connectionOptions);
    }
    conn.ev.on("creds.update", saveCreds);
    conn.ev.on("connection.update", connectionUpdate);
    conn.ev.on("messages.upsert", async ({ messages }) => {
      const m = messages[0];
      if (!m.message || (m.key.fromMe && jidNormalizedUser(m.key.remoteJid) !== jidNormalizedUser(myJid))) return;

      const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || "";
      if (!text.startsWith('!')) return;

      let mediaData = null;
      if (m.message?.imageMessage || m.message?.videoMessage) {
        mediaData = await downloadMedia(m);
      }

      sendToPython({
        type: "message",
        from: m.key.remoteJid,
        text: text,
        name: m.pushName || "Unknown",
        timestamp: new Date().toISOString(),
        has_media: mediaData !== null,
        media_type: mediaData?.type,
        media_path: mediaData?.path,
        media_mimetype: mediaData?.mimetype
      });
    });
  }

  reload();
})();
