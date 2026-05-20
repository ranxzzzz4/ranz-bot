const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Folder untuk download sementara
const DOWNLOAD_DIR = './downloads';
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// Konfigurasi client dengan LocalAuth (session tersimpan)
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'ranz-bot',
        dataPath: './sessions'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Event: QR Code
client.on('qr', (qr) => {
    console.log('📱 SCAN QR CODE INI DENGAN WHATSAPP:');
    qrcode.generate(qr, { small: true });
    console.log('\n📲 Cara: WhatsApp → 3 titik → Perangkat Tertaut → Tautkan Perangkat → Scan QR\n');
});

// Event: Client siap
client.on('ready', () => {
    console.log('✅ BOT RANZ AKTIF!');
    console.log('📌 Perintah yang tersedia:');
    console.log('   stiker        - Buat stiker dari gambar');
    console.log('   yt [link]     - Download YouTube');
    console.log('   ig [link]     - Download Instagram');
    console.log('   tt [link]     - Download TikTok');
    console.log('   menu / help   - Tampilkan menu');
});

// ============ FUNGSI DOWNLOAD ============

// Download YouTube (pake ytdl-core)
async function downloadYouTube(url) {
    const ytdl = require('ytdl-core');
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const outputPath = path.join(DOWNLOAD_DIR, `yt_${timestamp}.mp4`);
        
        const stream = ytdl(url, { 
            quality: 'highestvideo',
            filter: 'audioandvideo'
        });
        
        const writeStream = fs.createWriteStream(outputPath);
        stream.pipe(writeStream);
        
        writeStream.on('finish', () => resolve(outputPath));
        writeStream.on('error', reject);
        stream.on('error', reject);
    });
}

// Download dari API pihak ketiga (TikTok, Instagram)
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
