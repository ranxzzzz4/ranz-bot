const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const axios = require('axios');
const ytdl = require('ytdl-core');
const path = require('path');

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
            
            const videoResponse = await axios({
                method: 'get',
                url: videoUrl,
                responseType: 'stream'
            });
            
            const writer = fs.createWriteStream(outputPath);
            videoResponse.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(outputPath));
                writer.on('error', reject);
            });
        }
        return null;
    } catch (error) {
        console.error(`Error API:`, error.message);
        return null;
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./sessions');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📱 SCAN QR CODE INI DENGAN WHATSAPP:');
            console.log(qr);
            console.log('\n📲 Cara: WhatsApp → 3 titik → Perangkat Tertaut → Tautkan Perangkat → Scan QR\n');
        }
        
        if (connection === 'open') {
            console.log('\n✅ BOT RANZ AKTIF!');
            console.log('📌 Perintah:\n');
            console.log('   stiker        - Buat stiker dari gambar');
            console.log('   yt [link]     - Download YouTube');
            console.log('   ig [link]     - Download Instagram');
            console.log('   tt [link]     - Download TikTok');
            console.log('   menu / help   - Tampilkan menu\n');
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, reconnect...');
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;
        
        console.log(`📩 Pesan: ${text}`);
        
        // Menu
        if (text.toLowerCase() === 'menu' || text.toLowerCase() === 'help') {
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
        if (text.toLowerCase() === 'stiker' || text.toLowerCase() === 'sticker') {
            const media = msg.message.imageMessage || msg.message.videoMessage;
            if (!media) {
                await sock.sendMessage(from, { text: '❌ Kirim gambar/video lalu ketik "stiker"' });
                return;
            }
            
            try {
                await sock.sendMessage(from, { text: '🔄 Membuat stiker...' });
                const buffer = await sock.downloadMediaMessage(msg);
                await sock.sendMessage(from, { sticker: buffer });
            } catch (error) {
                await sock.sendMessage(from, { text: '❌ Gagal membuat stiker' });
            }
            return;
        }
        
        // YouTube
        if (text.toLowerCase().startsWith('yt ')) {
            const url = text.substring(3).trim();
            if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
                await sock.sendMessage(from, { text: '❌ Link bukan YouTube!' });
                return;
            }
            
            await sock.sendMessage(from, { text: '🔄 Download YouTube...' });
            try {
                const filePath = await downloadYouTube(url);
                await sock.sendMessage(from, { video: { url: filePath }, caption: '✅ Video YouTube siap!' });
                fs.unlinkSync(filePath);
            } catch (error) {
                await sock.sendMessage(from, { text: '❌ Gagal download YouTube' });
            }
            return;
        }
        
        // Instagram
        if (text.toLowerCase().startsWith('ig ')) {
            const url = text.substring(3).trim();
            if (!url.includes('instagram.com')) {
                await sock.sendMessage(from, { text: '❌ Link bukan Instagram!' });
                return;
            }
            
            await sock.sendMessage(from, { text: '🔄 Download Instagram...' });
            try {
                const filePath = await downloadFromAPI(url, 'ig');
                if (filePath) {
                    await sock.sendMessage(from, { video: { url: filePath }, caption: '✅ Video Instagram siap!' });
                    fs.unlinkSync(filePath);
                } else {
                    await sock.sendMessage(from, { text: '❌ Gagal download Instagram' });
                }
            } catch (error) {
                await sock.sendMessage(from, { text: '❌ Gagal download Instagram' });
            }
            return;
        }
        
        // TikTok
        if (text.toLowerCase().startsWith('tt ')) {
            const url = text.substring(3).trim();
            if (!url.includes('tiktok.com')) {
                await sock.sendMessage(from, { text: '❌ Link bukan TikTok!' });
                return;
            }
            
            await sock.sendMessage(from, { text: '🔄 Download TikTok...' });
            try {
                const filePath = await downloadFromAPI(url, 'tt');
                if (filePath) {
                    await sock.sendMessage(from, { video: { url: filePath }, caption: '✅ Video TikTok siap!' });
                    fs.unlinkSync(filePath);
                } else {
                    await sock.sendMessage(from, { text: '❌ Gagal download TikTok' });
                }
            } catch (error) {
                await sock.sendMessage(from, { text: '❌ Gagal download TikTok' });
            }
            return;
        }
    });
}

console.log('🚀 Menjalankan RANZ Bot...');
connectToWhatsApp();            const outputPath = path.join(DOWNLOAD_DIR, `${platform}_${timestamp}.mp4`);
            
            const videoResponse = await axios({
                method: 'get',
                url: videoUrl,
                responseType: 'stream'
            });
            
            const writer = fs.createWriteStream(outputPath);
            videoResponse.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(outputPath));
                writer.on('error', reject);
            });
        }
        return null;
    } catch (error) {
        console.error(`Error download ${platform}:`, error.message);
        return null;
    }
}

// ============ HANDLER PESAN ============

client.on('message', async (message) => {
    const body = message.body.toLowerCase();
    const originalMsg = message.body;
    
    // Skip pesan dari bot sendiri
    if (message.fromMe) return;
    
    console.log(`📩 Pesan: ${originalMsg}`);
    
    // ============ MENU ============
    if (body === 'menu' || body === 'help') {
        const menu = `╔══════════════════════════════════╗
║        🤖 RANZ BOT WhatsApp 🤖        ║
╠══════════════════════════════════════╣
║                                      ║
║ 📌 *PERINTAH:*                       ║
║                                      ║
║ 🖼️ *stiker*     - bikin stiker       ║
║ 🎬 *yt [link]*  - download YouTube   ║
║ 📸 *ig [link]*  - download Instagram ║
║ 🎵 *tt [link]*  - download TikTok    ║
║                                      ║
║ *Contoh:*                            ║
║ yt https://youtube.com/watch?v=xxx   ║
║ ig https://instagram.com/p/xxx       ║
║ tt https://tiktok.com/xxx            ║
║                                      ║
╚══════════════════════════════════════╝
║        by RANZ • 2026               ║
╚══════════════════════════════════════╝`;
        await message.reply(menu);
        return;
    }
    
    // ============ STIKER ============
    if (body === 'stiker' || body === 'sticker') {
        let mediaMessage = message;
        
        if (message.hasQuotedMsg) {
            const quoted = await message.getQuotedMessage();
            if (quoted.hasMedia) mediaMessage = quoted;
        }
        
        if (!mediaMessage.hasMedia) {
            await message.reply('❌ Kirim gambar/video dengan caption "stiker" atau balas media dengan "stiker"');
            return;
        }
        
        try {
            await message.reply('🔄 Membuat stiker, tunggu sebentar...');
            const media = await mediaMessage.downloadMedia();
            await client.sendMessage(message.from, media, {
                sendMediaAsSticker: true,
                stickerName: 'Ranz Sticker',
                stickerAuthor: 'Ranz Bot'
            });
        } catch (error) {
            console.error('Error stiker:', error);
            await message.reply('❌ Gagal membuat stiker. Pastikan gambar/video valid.');
        }
        return;
    }
    
    // ============ DOWNLOAD YOUTUBE ============
    if (body.startsWith('yt ')) {
        const url = originalMsg.substring(3).trim();
        
        if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            await message.reply('❌ Link bukan YouTube!');
            return;
        }
        
        await message.reply('🔄 Mendownload video YouTube... Mohon tunggu.');
        
        try {
            const filePath = await downloadYouTube(url);
            const media = {
                video: fs.readFileSync(filePath),
                caption: '✅ Video YouTube berhasil didownload!'
            };
            await client.sendMessage(message.from, media);
            fs.unlinkSync(filePath);
        } catch (error) {
            console.error('Error YT:', error);
            await message.reply('❌ Gagal download YouTube. Coba link lain.');
        }
        return;
    }
    
    // ============ DOWNLOAD INSTAGRAM ============
    if (body.startsWith('ig ')) {
        const url = originalMsg.substring(3).trim();
        
        if (!url.includes('instagram.com')) {
            await message.reply('❌ Link bukan Instagram!');
            return;
        }
        
        await message.reply('🔄 Mendownload video Instagram... Mohon tunggu.');
        
        try {
            const filePath = await downloadFromAPI(url, 'ig');
            if (filePath) {
                const media = {
                    video: fs.readFileSync(filePath),
                    caption: '✅ Video Instagram berhasil didownload!'
                };
                await client.sendMessage(message.from, media);
                fs.unlinkSync(filePath);
            } else {
                await message.reply('❌ Gagal download Instagram. Coba link lain.');
            }
        } catch (error) {
            await message.reply('❌ Gagal download Instagram.');
        }
        return;
    }
    
    // ============ DOWNLOAD TIKTOK ============
    if (body.startsWith('tt ')) {
        const url = originalMsg.substring(3).trim();
        
        if (!url.includes('tiktok.com')) {
            await message.reply('❌ Link bukan TikTok!');
            return;
        }
        
        await message.reply('🔄 Mendownload video TikTok... Mohon tunggu.');
        
        try {
            const filePath = await downloadFromAPI(url, 'tt');
            if (filePath) {
                const media = {
                    video: fs.readFileSync(filePath),
                    caption: '✅ Video TikTok berhasil didownload (No Watermark)!'
                };
                await client.sendMessage(message.from, media);
                fs.unlinkSync(filePath);
            } else {
                await message.reply('❌ Gagal download TikTok. Coba link lain.');
            }
        } catch (error) {
            await message.reply('❌ Gagal download TikTok.');
        }
        return;
    }
});

// Event: Error auth
client.on('auth_failure', (msg) => {
    console.error('❌ Auth gagal:', msg);
});

client.on('disconnected', (reason) => {
    console.log('❌ Bot terputus:', reason);
    console.log('🔄 Restart dalam 5 detik...');
    setTimeout(() => {
        client.initialize();
    }, 5000);
});

// Start bot
console.log('🚀 Menjalankan RANZ Bot...');
client.initialize();

// Handle exit
process.on('SIGINT', async () => {
    console.log('\n👋 Mematikan bot...');
    await client.destroy();
    process.exit(0);
});
