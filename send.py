import json
import sys
import re
import datetime
import threading
import time

class WhatsAppBot:
    def __init__(self):
        self.commands = {
            '!help': self.handle_help,
            '!time': self.handle_time,
            '!broadcast': self.handle_broadcast,
            '!kirim': self.handle_kirim,
            '!cek_broadcast': self.handle_cek_broadcast,
        }

        # Data untuk broadcast (simpan di file)
        self.broadcast_list = []
        self.load_broadcast_list()
        
        # Status bot
        self.is_connected = False
        self.user_id = None
    
    def load_broadcast_list(self):
        """Muat daftar broadcast dari file"""
        try:
            with open('data/broadcast_list.txt', 'r') as f:
                self.broadcast_list = [line.strip() for line in f if line.strip()]
        except FileNotFoundError:
            self.broadcast_list = []
    
    def save_broadcast_list(self):
        """Simpan daftar broadcast ke file"""
        with open('data/broadcast_list.txt', 'w') as f:
            for recipient in self.broadcast_list:
                f.write(recipient + '\n')
    
    def handle_help(self, data):
        """Menangani perintah !help"""
        help_text  = "Daftar perintah yang tersedia:\n"
        help_text += "• !help - Menampilkan bantuan\n"
        help_text += "• !time - Waktu saat ini\n"
        help_text += "• !broadcast <pesan> - Kirim pesan ke semua\n"
        help_text += "• !kirim <nomor> <pesan> - Kirim pesan ke nomor tertentu\n"
        help_text += "• !tambah_broadcast <nomor> - Tambah nomor ke broadcast\n"
        help_text += "• !cek_broadcast - Cek daftar broadcast\n"
        
        return {
            "type": "reply",
            "to": data["from"],
            "text": help_text
        }
    
    def handle_cek_broadcast(self, data):
        """Menangani perintah !cek_broadcast"""
        if not self.broadcast_list:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Daftar broadcast kosong."
            }
        
        list_text = "Daftar nomor dalam broadcast:\n"
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
    
    def handle_broadcast(self, data):
        """Menangani perintah !broadcast"""
        # Ekstrak pesan broadcast
        message_text = data["text"].replace("!broadcast", "").strip()
        if not message_text:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Format: !broadcast <pesan>"
            }
        
        if not self.broadcast_list:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Daftar broadcast kosong. Gunakan !tambah_broadcast <nomor>"
            }
        
        # Kirim broadcast
        return {
            "type": "broadcast",
            "recipients": self.broadcast_list,
            "text": f"{message_text}"
        }
    
    def handle_kirim(self, data):
        """Menangani perintah !kirim"""
        # Ekstrak nomor dan pesan
        parts = data["text"].split(" ", 2)
        if len(parts) < 3:
            return {
                "type": "reply",
                "to": data["from"],
                "text": "❌ Format: !kirim <nomor> <pesan>\nContoh: !kirim 081234567890 Halo apa kabar?"
            }
        
        phone_number = parts[1]
        message_text = parts[2]
        
        # Format nomor ke format WhatsApp
        phone_number = re.sub(r'[^\d]', '', phone_number)
        if phone_number.startswith('0'):
            phone_number = '62' + phone_number[1:]

        if not phone_number.endswith('@s.whatsapp.net'):
            phone_number = phone_number + '@s.whatsapp.net'
        
        return {
            "type": "send_message",
            "to": phone_number,
            "text": message_text
        }
    
    def process_message(self, data):
        """Memproses pesan dan mengembalikan respons"""
        text = data.get("text", "").strip()
        
        # Tangani perintah khusus
        if text.startswith('!'):
            command = text.split()[0].lower()
            if command in self.commands:
                return self.commands[command](data)
        
        # Tangani penambahan ke broadcast list
        if text.startswith('!tambah_broadcast'):
            parts = text.split(" ", 1)
            if len(parts) < 2:
                return {
                    "type": "reply",
                    "to": data["from"],
                    "text": "❌ Format: !tambah_broadcast <nomor>"
                }
            
            phone_number = parts[1].strip()
            phone_number = re.sub(r'[^\d]', '', phone_number)
            if phone_number.startswith('0'):
                phone_number = '62' + phone_number[1:]

            if not phone_number.endswith('@s.whatsapp.net'):
                phone_number = phone_number + '@s.whatsapp.net'
            
            if phone_number not in self.broadcast_list:
                self.broadcast_list.append(phone_number)
                self.save_broadcast_list()
                
                return {
                    "type": "reply",
                    "to": data["from"],
                    "text": f"✅ Nomor {phone_number.replace('@s.whatsapp.net', '')} berhasil ditambahkan ke daftar broadcast."
                }
            else:
                return {
                    "type": "reply",
                    "to": data["from"],
                    "text": f"❌ Nomor {phone_number.replace('@s.whatsapp.net', '')} sudah ada dalam daftar broadcast."
                }
        
        # Tidak merespons jika bukan perintah khusus
        return None

def main():
    bot = WhatsAppBot()
    
    print("Python Bot Logic Ready. Waiting for messages...")
    
    # Baca dari STDIN (dikirim dari JavaScript)
    for line in sys.stdin:
        try:
            data = json.loads(line.strip())
            
            if data.get("type") == "connection":
                # Update status koneksi
                bot.is_connected = data.get("status") == "connected"
                bot.user_id = data.get("user")
                print(f"Connection status: {data.get('status')}")
                
            elif data.get("type") == "message":
                response = bot.process_message(data)
                
                if response:
                    # Kirim respons kembali ke JavaScript
                    print(json.dumps(response))
                    sys.stdout.flush()
                    
        except json.JSONDecodeError as e:
            print(f"Error decoding JSON: {e}", file=sys.stderr)
        except Exception as e:
            print(f"Error processing message: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
