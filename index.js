const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');

// 1. DAFTAR NOMOR BOT YANG INGIN DIAKTIFKAN
const DAFTAR_BOT = [
    { nomor: '6285156779923', folderSesi: 'sesi_bot_1' },
    { nomor: '6289691685228', folderSesi: 'sesi_bot_2' } 
];

// Penyimpanan target harga dinamis
const memoriHarga = {};

// Harga dikunci sesuai request, tidak akan berubah oleh setharga
const HARGA_CORET_TETAP = 790000; 
const HARGA_SETELAH_DISKON_DEFAULT = 300000; 

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

    const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false, 
        logger: require('pino')({ level: 'silent' }),
        browser: ["Mac OS", "Chrome", "120.0.0.0"] 
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

    sock.ev.on('group-participants.update', async (update) => {
        const { id, action } = update;
        try {
            await delay(2000); 
            const metadataGrup = await sock.groupMetadata(id);
            const namaGrup = metadataGrup.subject;
            const jumlahAnggota = metadataGrup.participants.length;
            
            const hargaBayarGrup = memoriHarga[id] || HARGA_SETELAH_DISKON_DEFAULT;
            const hargaPerOrang = hargaBayarGrup / jumlahAnggota;

            let teksStatus = action === 'add' ? `ANGGOTA BARU BERGABUNG!` : action === 'remove' ? `ANGGOTA TELAH KELUAR/DI-KICK!` : '';
            if (!teksStatus) return;

            let templatePesan = `*${teksStatus}*\n`;
            templatePesan += `Grup: *${namaGrup}*\n`;
            templatePesan += `─────────────────────────\n`;
            templatePesan += `Harga Grup : ${buatTeksCoret(formatRupiah(HARGA_CORET_TETAP))} *${formatRupiah(hargaBayarGrup)}*\n`;
            templatePesan += `Jumlah Anggota : *${jumlahAnggota} orang*\n`;
            templatePesan += `Biaya Per Orang : *${formatRupiah(hargaPerOrang)}*\n`;
            templatePesan += `─────────────────────────\n`;

            await sock.sendMessage(id, { text: templatePesan });
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

        // 1. PERINTAH: bayar
        if (perintah === 'bayar' && isGroup) {
            try {
                const metadataGrup = await sock.groupMetadata(infoGrup);
                const jumlahAnggota = metadataGrup.participants.length;
                
                const hargaBayarGrup = memoriHarga[infoGrup] || HARGA_SETELAH_DISKON_DEFAULT;
                const hargaPerOrang = hargaBayarGrup / jumlahAnggota;

                let infoPesan = `Harga Grup : ${buatTeksCoret(formatRupiah(HARGA_CORET_TETAP))} *${formatRupiah(hargaBayarGrup)}*\n`;
                infoPesan += `Total Anggota : *${jumlahAnggota} orang*\n`;
                infoPesan += `Biaya Per Orang : *${formatRupiah(hargaPerOrang)}*\n`;

                const namaGambarSpesifik = `./qris_${folderSesi}.jpg`; 
                const namaGambarDefault = './qris.jpg';

                if (fs.existsSync(namaGambarSpesifik)) {
                    const gambarBuffer = fs.readFileSync(namaGambarSpesifik);
                    await sock.sendMessage(infoGrup, { image: gambarBuffer, caption: infoPesan }, { quoted: msg });
                } else if (fs.existsSync(namaGambarDefault)) {
                    const gambarBuffer = fs.readFileSync(namaGambarDefault);
                    await sock.sendMessage(infoGrup, { image: gambarBuffer, caption: infoPesan }, { quoted: msg });
                } else {
                    await sock.sendMessage(infoGrup, { text: infoPesan + '\n\nFile gambar QRIS tidak ditemukan di folder bot!' }, { quoted: msg });
                }

            } catch (e) { 
                console.log(`Error Bayar [BOT ${nomor}]:`, e.message); 
            }
        }

        // 2. PERINTAH: setharga
        if (perintah === 'setharga' && isGroup) {
            const hargaBaru = parseInt(argumen[0]);
            if (isNaN(hargaBaru) || hargaBaru <= 0) return;

            // Hanya mengubah harga setelah diskon
            memoriHarga[infoGrup] = hargaBaru;
            
            const metadataGrup = await sock.groupMetadata(infoGrup);
            const jumlahAnggota = metadataGrup.participants.length;
            const hargaPerOrang = hargaBaru / jumlahAnggota;

            let pesanSukses = `✅ Target Patungan Berhasil Diubah!\n\n`;
            pesanSukses += `Harga Grup Baru : ${buatTeksCoret(formatRupiah(HARGA_CORET_TETAP))} *${formatRupiah(hargaBaru)}*\n`;
            pesanSukses += `Biaya Baru/Orang : *${formatRupiah(hargaPerOrang)}* (${jumlahAnggota} anggota)`;

            await sock.sendMessage(infoGrup, { text: pesanSukses }, { quoted: msg });
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
