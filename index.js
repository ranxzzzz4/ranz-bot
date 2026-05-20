const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const axios = require('axios');
const ytdl = require('ytdl-core');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
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

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./sessions');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (update.qr) {
            console.log('📱 Masukkan nomor WhatsApp:');
            rl.question('📞 Nomor (contoh: 6281234567890): ', async (number) => {
                if (!number) return;
                console.log('⏳ Meminta kode pairing...');
                const code = await sock.requestPairingCode(number);
                console.log(`\n🔑 KODE PAIRING: ${code}`);
                console.log('\n📲 WhatsApp → 3 titik → Perangkat Tertaut → Tautkan Perangkat → Link with phone number');
                console.log(`🔢 Masukkan kode: ${code}\n`);
            });
        }
        
        if (connection === 'open') {
            console.log('\n✅ BOT RANZ AKTIF!');
            console.log('📌 PERINTAH: menu, stiker, yt [link], ig [link], tt [link]\n');
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;
        
        console.log(`📩 Pesan: ${text}`);
        
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
                await sock.sendMessage(from, { text: '❌ Gagal' });
            }
            return;
        }
        
        if (text.startsWith('yt ')) {
            const url = text.slice(3);
            await sock.sendMessage(from, { text: '🔄 Download YouTube...' });
            try {
                const filePath = await downloadYouTube(url);
                await sock.sendMessage(from, { video: { url: filePath }, caption: '✅ Video siap!' });
                fs.unlinkSync(filePath);
            } catch {
                await sock.sendMessage(from, { text: '❌ Gagal' });
            }
            return;
        }
        
        if (text.startsWith('ig ')) {
            const url = text.slice(3);
            await sock.sendMessage(from, { text: '🔄 Download Instagram...' });
            try {
                const filePath = await downloadFromAPI(url, 'ig');
                if (filePath) {
                    await sock.sendMessage(from, { video: { url: filePath }, caption: '✅ Video siap!' });
                    fs.unlinkSync(filePath);
                } else {
                    await sock.sendMessage(from, { text: '❌ Gagal' });
                }
            } catch {
                await sock.sendMessage(from, { text: '❌ Gagal' });
            }
            return;
        }
        
        if (text.startsWith('tt ')) {
            const url = text.slice(3);
            await sock.sendMessage(from, { text: '🔄 Download TikTok...' });
            try {
                const filePath = await downloadFromAPI(url, 'tt');
                if (filePath) {
                    await sock.sendMessage(from, { video: { url: filePath }, caption: '✅ Video siap!' });
                    fs.unlinkSync(filePath);
                } else {
                    await sock.sendMessage(from, { text: '❌ Gagal' });
                }
            } catch {
                await sock.sendMessage(from, { text: '❌ Gagal' });
            }
            return;
        }
    });
}

console.log('🚀 Menjalankan RANZ Bot...');
connectToWhatsApp();
