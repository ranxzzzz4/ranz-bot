const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const axios = require('axios');
const ytdl = require('ytdl-core');
const path = require('path');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Endpoint untuk health check
app.get('/', (req, res) => {
    res.send('Bot RANZ is running...');
});

app.listen(port, () => {
    console.log(`Web server running on port ${port}`);
});

const DOWNLOAD_DIR = './downloads';
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

let sock;

async function downloadYouTube(url) {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const outputPath = path.join(DOWNLOAD_DIR, `yt_${timestamp}.mp4`);
        const stream = ytdl(url, { quality: 'highestvideo' });
        const writeStream = fs.createWriteStream(outputPath);
        stream.pipe(writeStream);
        writeStream.on('finish', () => resolve(outputPath));
        writeStream.on('error', reject);
        stream.on('error', reject);
    });
}

async function downloadFromAPI(url, platform) {
    try {
        const apiUrl = `https://api.savetube.me/save?url=${encodeURIComponent(url)}`;
        const response = await axios.get(apiUrl);
        if (response.data && response.data.videoUrl) {
            const videoUrl = response.data.videoUrl;
            const timestamp = Date.now();
            const outputPath = path.join(DOWNLOAD_DIR, `${platform}_${timestamp}.mp4`);
            const writer = fs.createWriteStream(outputPath);
            const videoResponse = await axios.get(videoUrl, { responseType: 'stream' });
            videoResponse.data.pipe(writer);
            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(outputPath));
                writer.on('error', reject);
            });
        }
        return null;
    } catch (error) {
        console.error('API Error:', error.message);
        return null;
    }
}

// Fungsi untuk request Pairing Code (OTP via SMS/Call)
async function requestPairingCode(phoneNumber) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./sessions');
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // Matikan QR
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Request timeout')), 30000);
            
            sock.ev.on('connection.update', async (update) => {
                if (update.qr) {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        clearTimeout(timeout);
                        resolve(code);
                    } catch (err) {
                        clearTimeout(timeout);
                        reject(err);
                    }
                }
                if (update.connection === 'open') {
                    clearTimeout(timeout);
                    reject(new Error('Connection opened unexpectedly without pairing code.'));
                }
                if (update.connection === 'close') {
                    clearTimeout(timeout);
                    reject(new Error('Connection closed.'));
                }
            });
        });
    } catch (error) {
        console.error('Error requesting pairing code:', error);
        throw error;
    }
}

// Inisialisasi bot utama
async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./sessions');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('QR Code generated. However, you should use pairing code.');
            }

            if (connection === 'open') {
                console.log('✅ BOT RANZ AKTIF!');
                console.log('📌 PERINTAH: menu, stiker, yt [link], ig [link], tt [link]');
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log('🔄 Koneksi terputus, mencoba reconnect...');
                    connectToWhatsApp();
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);
        
        // Proses pesan masuk
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const from = msg.key.remoteJid;

            console.log(`📩 Pesan: ${text}`);

            // Menu
            if (text.toLowerCase() === 'menu') {
                await sock.sendMessage(from, { text: `╔══════════════════════════════════╗
║        🤖 RANZ BOT WhatsApp 🤖        ║
╠══════════════════════════════════════╣
║ stiker     - bikin stiker             ║
║ yt [link]  - download YouTube         ║
║ ig [link]  - download Instagram       ║
║ tt [link]  - download TikTok          ║
╚══════════════════════════════════════╝` });
                return;
            }

            // Stiker
            if (text.toLowerCase() === 'stiker') {
                const media = msg.message.imageMessage || msg.message.videoMessage;
                if (!media) {
                    await sock.sendMessage(from, { text: '❌ Kirim gambar lalu ketik "stiker"' });
                    return;
                }
                try {
                    await sock.sendMessage(from, { text: '🔄 Membuat stiker...' });
                    const buffer = await sock.downloadMediaMessage(msg);
                    await sock.sendMessage(from, { sticker: buffer });
                } catch {
                    await sock.sendMessage(from, { text: '❌ Gagal membuat stiker' });
                }
                return;
            }

            // YouTube
            if (text.toLowerCase().startsWith('yt ')) {
                const url = text.slice(3);
                await sock.sendMessage(from, { text: '🔄 Download YouTube...' });
                try {
                    const filePath = await downloadYouTube(url);
                    await sock.sendMessage(from, { video: { url: filePath }, caption: '✅ Video siap!' });
                    fs.unlinkSync(filePath);
                } catch {
                    await sock.sendMessage(from, { text: '❌ Gagal download YouTube' });
                }
                return;
            }

            // Instagram
            if (text.toLowerCase().startsWith('ig ')) {
                const url = text.slice(3);
                await sock.sendMessage(from, { text: '🔄 Download Instagram...' });
                try {
                    const filePath = await downloadFromAPI(url, 'ig');
                    if (filePath) {
                        await sock.sendMessage(from, { video: { url: filePath }, caption: '✅ Video siap!' });
                        fs.unlinkSync(filePath);
                    } else {
                        await sock.sendMessage(from, { text: '❌ Gagal download Instagram' });
                    }
                } catch {
                    await sock.sendMessage(from, { text: '❌ Gagal download Instagram' });
                }
                return;
            }

            // TikTok
            if (text.toLowerCase().startsWith('tt ')) {
                const url = text.slice(3);
                await sock.sendMessage(from, { text: '🔄 Download TikTok...' });
                try {
                    const filePath = await downloadFromAPI(url, 'tt');
                    if (filePath) {
                        await sock.sendMessage(from, { video: { url: filePath }, caption: '✅ Video siap!' });
                        fs.unlinkSync(filePath);
                    } else {
                        await sock.sendMessage(from, { text: '❌ Gagal download TikTok' });
                    }
                } catch {
                    await sock.sendMessage(from, { text: '❌ Gagal download TikTok' });
                }
                return;
            }
        });
        
        // Setelah socket siap, kita bisa request Pairing Code secara otomatis dari environment variable
        const phoneNumber = process.env.PHONE_NUMBER;
        if (phoneNumber) {
            console.log(`📱 Meminta Pairing Code untuk nomor: ${phoneNumber}`);
            try {
                const code = await requestPairingCode(phoneNumber);
                console.log(`🎉 Pairing Code berhasil didapatkan: ${code}`);
                console.log(`🔢 Masukkan kode ${code} di WhatsApp Anda (Settings -> Linked Devices -> Link with phone number)`);
            } catch (error) {
                console.error('Gagal mendapatkan Pairing Code:', error);
                console.log('Silakan set environment variable PHONE_NUMBER dengan nomor WhatsApp Anda (contoh: 6281234567890)');
            }
        } else {
            console.log('📱 Environment variable PHONE_NUMBER tidak ditemukan.');
            console.log('Silakan set PHONE_NUMBER dengan nomor WhatsApp Anda (contoh: 6281234567890) untuk mendapatkan Pairing Code.');
        }
        
    } catch (error) {
        console.error('Fatal error in connectToWhatsApp:', error);
    }
}

console.log('🚀 Menjalankan RANZ Bot...');
connectToWhatsApp();
