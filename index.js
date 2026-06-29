const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');

// 1. DAFTAR NOMOR BOT YANG INGIN DIAKTIFKAN
const DAFTAR_BOT = [
    { nomor: '6285156779923', folderSesi: 'sesi_bot_1' },
    { nomor: '6289691685228', folderSesi: 'sesi_bot_2' } 
];

// Penyimpanan target harga dinamis
const memoriHarga = {};

// Nilai default awal murni Rp 300.000
const HARGA_DEFAULT = 300000; 

function formatRupiah(angka) {
    return 'Rp ' + Math.ceil(angka).toLocaleString('id-ID');
}

// Fungsi membuat teks coret di WhatsApp
function buatTeksCoret(teks) {
    return `~${teks}~`;
}

async function inisialisasiBot(konfigurasiBot) {
    const { nomor, folderSesi } = konfigurasiBot;
    const { state, saveCreds } = await useMultiFileAuthState(folderSesi);
    const { version } = await fetchLatestBaileysVersion();

    // Browser dikonfigurasi menggunakan format standar Baileys yang aman dari pemblokiran tautan perangkat terbaru
    const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false, 
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome')
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            console.log(`\n⏳ [BOT ${nomor}] Sedang meminta kode pairing...`);
            try {
                let code = await sock.requestPairingCode(nomor);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n==============================================`);
                console.log(`🔥 KODE PAIRING UNTUK BOT [${nomor}]: ${code}`);
                console.log(`==============================================\n`);
            } catch (error) {
                console.error(`Gagal meminta kode pairing untuk ${nomor}:`, error.message);
            }
        }, 5000); 
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const alasan = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
            if (alasan !== DisconnectReason.loggedOut) {
                console.log(`🔄 [BOT ${nomor}] Koneksi terputus, mencoba menghubungkan kembali...`);
                inisialisasiBot(konfigurasiBot);
            }
        } else if (connection === 'open') {
            console.log(`✅ [BOT ${nomor}] BERHASIL AKTIF & TERHUBUNG!`);
        }
    });

    // RESPON KELUAR MASUK
    sock.ev.on('group-participants.update', async (update) => {
        const { id, action } = update;
        try {
            if (action !== 'add' && action !== 'remove') return;
            
            await delay(2000); 
            const metadataGrup = await sock.groupMetadata(id);
            const jumlahAnggota = metadataGrup.participants.length;
            
            const hargaAktif = memoriHarga[id] || HARGA_DEFAULT;
            const hargaPerOrang = hargaAktif / jumlahAnggota;

            let infoPesan = `Harga Grup : ${buatTeksCoret(formatRupiah(hargaAktif))}\n`;
            infoPesan += `Total Anggota : *${jumlahAnggota} orang*\n`;
            infoPesan += `Biaya Per Orang : *${formatRupiah(hargaPerOrang)}*\n`;

            const namaGambarSpesifik = `./qris_${folderSesi}.jpg`; 
            const namaGambarDefault = './qris.jpg';

            if (fs.existsSync(namaGambarSpesifik)) {
                const gambarBuffer = fs.readFileSync(namaGambarSpesifik);
                await sock.sendMessage(id, { image: gambarBuffer, caption: infoPesan });
            } else if (fs.existsSync(namaGambarDefault)) {
                const gambarBuffer = fs.readFileSync(namaGambarDefault);
                await sock.sendMessage(id, { image: gambarBuffer, caption: infoPesan });
            } else {
                await sock.sendMessage(id, { text: infoPesan + '\n\nFile gambar QRIS tidak ditemukan di folder bot!' });
            }
        } catch (err) { console.error(err); }
    });

    sock.ev.on('messages.upsert', async (chat) => {
        const msg = chat.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const infoGrup = msg.key.remoteJid;
        const isGroup = infoGrup.endsWith('@g.us');
        const isiChat = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        const argumen = isiChat.trim().split(/ +/);
        const perintah = argumen.shift().toLowerCase();

        // 1. PERINTAH: status
        if (perintah === 'status' && isGroup) {
            try {
                const metadataGrup = await sock.groupMetadata(infoGrup);
                const jumlahAnggota = metadataGrup.participants.length;
                
                const hargaAktif = memoriHarga[infoGrup] || HARGA_DEFAULT;
                const hargaPerOrang = hargaAktif / jumlahAnggota;

                let infoPesan = `Harga Grup : ${buatTeksCoret(formatRupiah(hargaAktif))}\n`;
                infoPesan += `Total Anggota : *${jumlahAnggota} orang*\n`;
                infoPesan += `Biaya Per Orang : *${formatRupiah(hargaPerOrang)}*\n`;

                const namaGambarSpesifik = `./qris_${folderSesi}.jpg`; 
                const namaGambarDefault = './qris.jpg';

                if (fs.existsSync(namaGambarSpesifik)) {
                    const gambarBuffer = fs.readFileSync(namaGambarSpesifik);
                    await sock.sendMessage(infoGrup, { image: gambarBuffer, caption: infoPesan });
                } else if (fs.existsSync(namaGambarDefault)) {
                    const gambarBuffer = fs.readFileSync(namaGambarDefault);
                    await sock.sendMessage(infoGrup, { image: gambarBuffer, caption: infoPesan });
                } else {
                    await sock.sendMessage(infoGrup, { text: infoPesan + '\n\nFile gambar QRIS tidak ditemukan di folder bot!' });
                }

            } catch (e) { 
                console.log(`Error Status [BOT ${nomor}]:`, e.message); 
            }
        }

        // 2. PERINTAH: setharga
        if (perintah === 'setharga' && isGroup) {
            const hargaBaru = parseInt(argumen[0]);
            if (isNaN(hargaBaru) || hargaBaru <= 0) return;

            memoriHarga[infoGrup] = hargaBaru;
            
            const metadataGrup = await sock.groupMetadata(infoGrup);
            const jumlahAnggota = metadataGrup.participants.length;
            const hargaPerOrang = hargaBaru / jumlahAnggota;

            let pesanSukses = `✅ Target Patungan Berhasil Diubah!\n\n`;
            pesanSukses += `Harga Grup Baru : ${buatTeksCoret(formatRupiah(hargaBaru))}\n`;
            pesanSukses += `Biaya Baru/Orang : *${formatRupiah(hargaPerOrang)}* (${jumlahAnggota} anggota)`;

            await sock.sendMessage(infoGrup, { text: pesanSukses });
        }
    });
}

// 2. RUNNING MULTI-BOT SYSTEM
console.log(`==============================================`);
console.log(`🚀 MEMULAI SISTEM MULTI-BOT SINKRON...`);
console.log(`📦 Menyalakan total: ${DAFTAR_BOT.length} nomor bot.`);
console.log(`==============================================\n`);

DAFTAR_BOT.forEach((bot) => {
    inisialisasiBot(bot);
});
