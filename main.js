const { spawn } = require('child_process');
const {
    default: makeWaSocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
} = require("@whiskeysockets/baileys");
const chalk = require("chalk");
const qrcode = require("qrcode-terminal");
const inquirer = require("inquirer");
const fs = require('fs');
const path = require('path');
const pino = require("pino");

// Buat folder untuk menyimpan data
if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

(async () => {
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    const connectionOptions = {
        logger: require("pino")({ level: "silent" }),
        auth: state,
        printQRInTerminal: false
    };

    let conn = makeWaSocket(connectionOptions);
    let pythonProcess = null;

    // Fungsi untuk mendownload media dari pesan menggunakan downloadMediaMessage
    async function downloadMedia(m) {
        try {
            // Cek jika pesan mengandung media
            if (!m.message?.imageMessage && !m.message?.videoMessage) {
                return null;
            }

            // Download media sebagai buffer
            const buffer = await downloadMediaMessage(
                m,
                "buffer",
                {},
                { logger: pino({ level: "silent" }) }
            );

            let mediaType = null;
            if (m.message.imageMessage) {
                mediaType = 'image';
            } else if (m.message.videoMessage) {
                mediaType = 'video';
            }

            return {
                type: mediaType,
                buffer: buffer.toString('base64'), // Convert to base64 untuk JSON
                mimetype: m.message.imageMessage?.mimetype || m.message.videoMessage?.mimetype || 'image/jpeg'
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
                    console.log(chalk.blue('Response from Python:'), response);
                    
                    if (response.type === 'reply') {
                        // Balas ke pengirim
                        conn.sendMessage(response.to, { text: response.text });
                    } 
                    else if (response.type === 'send_message') {
                        // Kirim ke nomor tertentu (!kirim)
                        if (response.has_media && response.media_buffer) {
                            // Kirim media dengan caption
                            const buffer = Buffer.from(response.media_buffer, 'base64');
                            
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
                        
                        response.recipients.forEach(recipient => {
                            if (response.has_media && response.media_buffer) {
                                const buffer = Buffer.from(response.media_buffer, 'base64');
                                
                                if (response.media_type === 'image') {
                                    conn.sendMessage(recipient, {
                                        image: buffer,
                                        caption: response.caption || '',
                                        mimetype: response.media_mimetype || 'image/jpeg'
                                    });
                                } else if (response.media_type === 'video') {
                                    conn.sendMessage(recipient, {
                                        video: buffer,
                                        caption: response.caption || '',
                                        mimetype: response.media_mimetype || 'video/mp4'
                                    });
                                }
                            } else {
                                conn.sendMessage(recipient, { text: response.text });
                            }
                        });
                        
                        console.log(chalk.green('Broadcast completed'));
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
            // Restart proses Python jika tertutup
            setTimeout(startPythonProcess, 3000);
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
            } catch {}
            conn = makeWaSocket(connectionOptions);
        }

        conn.ev.on("creds.update", saveCreds);
        conn.ev.on("connection.update", connectionUpdate);

        // --- listener pesan masuk ---
        conn.ev.on("messages.upsert", async ({ messages }) => {
            const m = messages[0];
            if (!m.message) return;

            const sender = m.key.remoteJid; // id pengirim
            const text = m.message.conversation || 
                        m.message.extendedTextMessage?.text || 
                        m.message.imageMessage?.caption ||
                        m.message.videoMessage?.caption ||
                        "";
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
                media_buffer: mediaData?.buffer, // base64 string
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
        // -----------------------------

        return true;
    }

    reload();
})();
