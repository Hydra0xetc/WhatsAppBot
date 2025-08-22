const { spawn } = require('child_process');
const {
    default: makeWaSocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");
const chalk = require("chalk");
const qrcode = require("qrcode-terminal");
const inquirer = require("inquirer");
const fs = require('fs');
const path = require('path');

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
                        conn.sendMessage(response.to, { text: response.text });
                    } else if (response.type === 'send_message') {
                        conn.sendMessage(response.to, { text: response.text });
                    } else if (response.type === 'broadcast') {
                        // Kirim pesan broadcast ke semua kontak atau grup
                        response.recipients.forEach(recipient => {
                            conn.sendMessage(recipient, { text: response.text });
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
            const text = m.message.conversation || m.message.extendedTextMessage?.text || "";
            const name = m.pushName || "Unknown";

            // Kirim data pesan ke Python
            const messageData = {
                type: "message",
                from: sender,
                text: text,
                name: name,
                timestamp: new Date().toISOString()
            };
            
            sendToPython(messageData);
        });
        // -----------------------------

        return true;
    }

    reload();
})();
