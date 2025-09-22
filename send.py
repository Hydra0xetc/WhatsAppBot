import json
from colorama import init, Fore, Style
import sys
import re
import datetime
import os
import subprocess
from dotenv import load_dotenv

init(autoreset=True)

load_dotenv()

BROADCAST_JOB_FILE = 'data/broadcast_job.json'

def print_debug(text):
    print(f"{Fore.YELLOW}[DEBUG] {Style.RESET_ALL} {text}")

class WhatsAppBot:
    def __init__(self):
        self.commands = {
            '!help': self.handle_help,
            '!time': self.handle_time,
            '!broadcast': self.handle_broadcast,
            '!kirim': self.handle_kirim,
            '!tambah': self.handle_tambah,
            '!cek': self.handle_cek_broadcast,
            '!clear': self.handle_clear,
            '!ai': self.handle_ai,
            '!lanjutkan': self.handle_lanjutkan,
            '!batalkan': self.handle_batalkan,
        }
        self.broadcast_list = []
        self.load_broadcast_list()
        self.is_connected = False
        self.user_id = None

    def _get_job_status(self):
        if not os.path.exists(BROADCAST_JOB_FILE):
            return None
        try:
            with open(BROADCAST_JOB_FILE, 'r') as f:
                job = json.load(f)
                return job
        except (json.JSONDecodeError, FileNotFoundError):
            return None

    def load_broadcast_list(self):
        try:
            with open('data/lists/broadcast_list.txt', 'r') as f:
                self.broadcast_list = [line.strip() for line in f if line.strip()]
        except FileNotFoundError:
            self.broadcast_list = []

    def save_broadcast_list(self):
        with open('data/lists/broadcast_list.txt', 'w') as f:
            for recipient in self.broadcast_list:
                f.write(recipient + '\n')

    def handle_help(self, data):
        help_text = "Daftar perintah yang tersedia:\n\n"
        help_text += "• `!help` - Menampilkan bantuan\n"
        help_text += "• `!time` - Waktu saat ini\n"
        help_text += "• `!broadcast` <pesan> - Mulai broadcast baru\n"
        help_text += "• `!lanjutkan` - Lanjutkan broadcast yang tertunda\n"
        help_text += "• `!batalkan` - Batalkan broadcast yang tertunda\n"
        help_text += "• `!kirim` <nomor> <pesan> - Kirim pesan ke nomor tertentu\n"
        help_text += "• `!tambah` <nomor|txt> - Tambah nomor dari argumen atau file nomor.txt\n"
        help_text += "• `!cek` - Cek daftar broadcast\n"
        help_text += "• `!clear` - Bersihkan cache media\n"
        help_text += "• `!ai` <prompt> - Berinteraksi dengan AI"

        return {
            "type": "reply",
            "to": data["from"],
            "text": help_text
        }

    def handle_lanjutkan(self, data):
        job = self._get_job_status()
        if not job or not job.get('isActive'):
            return {
                "type": "reply",
                "to": data["from"],
                "text": "Tidak ada sesi broadcast yang aktif untuk dilanjutkan."
            }
        
        return {
            "type": "resume_broadcast_job"
        }

    def handle_batalkan(self, data):
        job = self._get_job_status()
        if not job or not job.get('isActive'):
            return {
                "type": "reply",
                "to": data["from"],
                "text": "Tidak ada sesi broadcast yang aktif untuk dibatalkan."
            }
        
        try:
            os.remove(BROADCAST_JOB_FILE)
            return {
                "type": "reply",
                "to": data["from"],
                "text": "✅ Sesi broadcast yang tertunda telah dibatalkan."
            }
        except OSError as e:
            return {
                "type": "reply",
                "to": data["from"],
                "text": f"❌ Gagal membatalkan sesi broadcast: {e}"
            }

    def handle_broadcast(self, data):
        job = self._get_job_status()
        if job and job.get('isActive'):
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Masih ada sesi broadcast yang belum selesai. Gunakan `!lanjutkan` untuk melanjutkan atau `!batalkan` untuk memulai dari awal."
            }

        message_text = data["text"].replace("!broadcast", "").strip()
        has_media = data.get("has_media", False)
        
        if not message_text and not has_media:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Format: !broadcast <pesan> atau kirim media dengan caption !broadcast"
            }
        
        if not self.broadcast_list:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Daftar broadcast kosong. Gunakan !tambah untuk menambahkan nomor."
            }

        new_job = {
            "isActive": True,
            "recipients": self.broadcast_list,
            "pendingRecipients": self.broadcast_list,
            "message": message_text,
            "mediaInfo": {
                "has_media": has_media,
                "media_type": data.get("media_type"),
                "media_path": data.get("media_path"),
                "media_mimetype": data.get("media_mimetype")
            }
        }

        with open(BROADCAST_JOB_FILE, 'w') as f:
            json.dump(new_job, f, indent=2)

        return {
            "type": "start_broadcast_job"
        }

    def handle_tambah(self, data):
        parts = data.get("text", "").strip().split(" ", 1)
        
        if len(parts) < 2:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Format salah. Gunakan `!tambah <nomor>` atau `!tambah txt`."
            }

        argument = parts[1].strip()

        if argument.lower() == 'txt':
            try:
                with open('nomor.txt', 'r') as f:
                    numbers_from_file = [line.strip() for line in f if line.strip()]
            except FileNotFoundError:
                return { "type": "reply", "to": data["from"], "text": "❌ File `nomor.txt` tidak ditemukan." }

            if not numbers_from_file:
                return { "type": "reply", "to": data["from"], "text": "❌ File `nomor.txt` kosong." }

            added_count = 0
            duplicate_count = 0
            for num in numbers_from_file:
                phone_number = re.sub(r'[^\d]', '', num)
                if phone_number.startswith('0'):
                    phone_number = '62' + phone_number[1:]
                if not phone_number.endswith('@s.whatsapp.net'):
                    phone_number += '@s.whatsapp.net'
                
                if phone_number not in self.broadcast_list:
                    self.broadcast_list.append(phone_number)
                    added_count += 1
                else:
                    duplicate_count += 1
            
            if added_count > 0:
                self.save_broadcast_list()

            return {
                "type": "reply",
                "to": data["from"],
                "text": f"✅ Berhasil dari `nomor.txt`:\n- {added_count} nomor baru ditambahkan.\n- {duplicate_count} nomor duplikat dilewati."
            }
        else:
            phone_number = argument
            phone_number = re.sub(r'[^\d]', '', phone_number)
            if phone_number.startswith('0'):
                phone_number = '62' + phone_number[1:]
            if not phone_number.endswith('@s.whatsapp.net'):
                phone_number += '@s.whatsapp.net'
            
            if phone_number not in self.broadcast_list:
                self.broadcast_list.append(phone_number)
                self.save_broadcast_list()
                return {
                    "type": "reply",
                    "to": data["from"],
                    "text": f"✅ Nomor {phone_number.replace('@s.whatsapp.net', '')} berhasil ditambahkan."
                }
            else:
                return {
                    "type": "reply",
                    "to": data["from"],
                    "text": f"❌ Nomor {phone_number.replace('@s.whatsapp.net', '')} sudah ada."
                }

    def handle_cek_broadcast(self, data):
        """Menangani perintah !cek_broadcast"""
        if not self.broadcast_list:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Daftar broadcast kosong."
            }
        
        list_text = "*Daftar nomor dalam broadcast:*\n\n"
        for i, recipient in enumerate(self.broadcast_list, 1):
            list_text += f"{i}. {recipient.replace('@s.whatsapp.net', '')}\n"
            
        return {
            "type": "reply",
            "to": data["from"],
            "text": list_text
        }
    
    def handle_time(self, data):
        """Menangani perintah !time"""
        now = datetime.datetime.now()
        time_text = f"⏰ Waktu saat ini:\n{now.strftime('%Y-%m-%d %H:%M:%S')}"
        
        return {
            "type": "reply",
            "to": data["from"],
            "text": time_text
        }

    def handle_kirim(self, data):
        """Menangani perintah !kirim"""
        # Ekstrak argumen setelah !kirim
        args_text = data["text"].replace("!kirim", "").strip()
        
        parts = args_text.split(" ")
        phone_parts = []
        message_parts = []
        
        number_ended = False
        for part in parts:
            if number_ended or not re.match(r'^[+\d][\d-]*$', part):
                number_ended = True
                message_parts.append(part)
            else:
                phone_parts.append(part)
                
        if not phone_parts:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Format: !kirim <nomor> <pesan>\nContoh: !kirim +62 812-3456-7890 Halo"
            }
            
        phone_number_raw = " ".join(phone_parts)
        message_text = " ".join(message_parts)
        
        # Format nomor ke format WhatsApp
        phone_number = re.sub(r'[^\d]', '', phone_number_raw)
        if phone_number.startswith('0'):
            phone_number = '62' + phone_number[1:]

        if not phone_number.endswith('@s.whatsapp.net'):
            phone_number = phone_number + '@s.whatsapp.net'
        
        # Cek apakah ada media yang dikirim bersama perintah
        has_media = data.get("has_media", False)
        media_type = data.get("media_type")
        media_path = data.get("media_path")
        media_mimetype = data.get("media_mimetype")
        
        # Jika ada media, kirim dengan media
        if has_media and media_path and media_type:
            return {
                "type": "send_message",
                "to": phone_number,
                "text": message_text,
                "has_media": True,
                "media_type": media_type,
                "media_path": media_path,
                "media_mimetype": media_mimetype,
                "caption": message_text
            }
        
        # Kirim pesan teks biasa
        return {
            "type": "send_message",
            "to": phone_number,
            "text": message_text
        }

    def handle_clear(self, data):
        """Menangani perintah !clear"""
        return {
            "type": "clear_cache",
            "to": data["from"]
        }

    def handle_ai(self, data):
        """Menangani perintah !ai menggunakan curl"""
        prompt = data["text"].replace("!ai", "").strip()
        if not prompt:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "Silahkan berikan prompt setelah perintah `!ai`"
            }

        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "GEMINI_API_KEY tidak ditemukan di file .env Anda."
            }

        url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
        headers = {
            'Content-Type': 'application/json',
            'X-goog-api-key': api_key
        }
        konten = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt
                        }
                    ]
                }
            ]
        }

        try:
            response = subprocess.run(
                ['curl', '-s', url, '-X', 'POST', '-H', f"Content-Type: {headers['Content-Type']}", '-H', f"X-goog-api-key: {headers['X-goog-api-key']}", '-d', json.dumps(konten)],
                capture_output=True, text=True, check=True
            )
            response_json = json.loads(response.stdout)

            if 'error' in response_json:
                error_message = response_json['error'].get('message', 'Terjadi kesalahan yang tidak diketahui')
                if 'API key' in error_message:
                    return {
                        "type": "reply",
                        "to": data["from"],
                        "text": f"⚠️ API Key Anda tidak valid atau kedaluwarsa. Silakan periksa kembali API Key Anda di Google AI Studio.\n\nError: {error_message}"
                    }
                else:
                    return {
                        "type": "reply",
                        "to": data["from"],
                        "text": f"Terjadi kesalahan dari Gemini API: {error_message}"
                    }

            generated_text = ""
            if 'candidates' in response_json and len(response_json['candidates']) > 0:
                candidate = response_json['candidates'][0]
                if 'content' in candidate and 'parts' in candidate['content']:
                    for part in candidate['content']['parts']:
                        if 'text' in part:
                            generated_text = part['text']
                            break
            
            if not generated_text:
                return {
                    "type": "reply",
                    "to": data["from"],
                    "text": "❌ Maaf, saya tidak dapat menghasilkan respons untuk permintaan ini. Silakan coba dengan prompt yang berbeda."
                }

            generated_text = generated_text.replace('**', '*')
            
            def format_code_blocks(text):
                text = re.sub(r"```(\w+)\n(.*?)""```", r"*\1:*\n`\2`", text, flags=re.DOTALL)
                text = re.sub(r"```\n(.*?)""```", r"`\1`", text, flags=re.DOTALL)
                return text
            
            generated_text = format_code_blocks(generated_text)
            
            return {
                "type": "reply",
                "to": data["from"],
                "text": generated_text
            }
            
        except subprocess.CalledProcessError as e:
            return {
                "type": "reply",
                "to": data["from"],
                "text": f"❌ Terjadi kesalahan saat menghubungi Gemini API: {e.stderr}"
            }
        except (KeyError, IndexError, json.JSONDecodeError) as e:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Terjadi kesalahan dalam memproses respons dari AI. Silakan coba lagi nanti."
            }

    def process_message(self, data):
        text = data.get("text", "").strip()
        command = text.split()[0].lower() if text.startswith('!') else None

        if command and command in self.commands:
            return self.commands[command](data)
        
        return None

def main():
    bot = WhatsAppBot()
    print("Waiting for messages...")
    sys.stdout.flush()
    for line in sys.stdin:
        try:
            data = json.loads(line.strip())
            if data.get("type") == "connection":
                bot.is_connected = data.get("status") == "connected"
                bot.user_id = data.get("user")
            elif data.get("type") == "message":
                response = bot.process_message(data)
                if response:
                    print(json.dumps(response))
                    sys.stdout.flush()
        except json.JSONDecodeError as e:
            print(f"Error decoding JSON: {e}", file=sys.stderr)
            sys.stdout.flush()
        except Exception as e:
            print(f"Error processing message: {e}", file=sys.stderr)
            sys.stdout.flush()

if __name__ == "__main__":
    main()
