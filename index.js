const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');

const PREFIX = '!'; 

// 1. DAFTAR NOMOR BOT YANG INGIN DIAKTIFKAN
// Kamu bisa menambah baris ke bawah sesuai dengan jumlah bot yang ingin dijalankan secara paralel.
const DAFTAR_BOT = [
    { nomor: '6285156779923', folderSesi: 'sesi_bot_1' },
    { nomor: '6289691685228', folderSesi: 'sesi_bot_2' } // Contoh nomor kedua (silakan ganti dengan nomor aktifmu)
];

// Penyimpanan target harga dinamis agar tidak saling bercampur antar grup/bot
const memoriHarga = {};
const HARGA_DEFAULT = 300000;

function formatRupiah(angka) {
    return 'Rp ' + Math.ceil(angka).toLocaleString('id-ID');
}

// Fungsi utama pemicu instance bot WhatsApp
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

    // Mekanisme request kode pairing via Railway Terminal Logs
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
            
            const totalHargaGrup = memoriHarga[id] || HARGA_DEFAULT;
            const hargaPerOrang = totalHargaGrup / jumlahAnggota;

            let teksStatus = action === 'add' ? `📥 *ANGGOTA BARU BERGABUNG!*` : action === 'remove' ? `📤 *ANGGOTA TELAH KELUAR/DI-KICK!*` : '';
            if (!teksStatus) return;

            let templatePesan = `${teksStatus}\n`;
            templatePesan += `🏠 Grup: *${namaGrup}*\n`;
            templatePesan += `─────────────────────────\n`;
            templatePesan += `💰 Target Tagihan : *${formatRupiah(totalHargaGrup)}*\n`;
            templatePesan += `👥 Jumlah Anggota : *${jumlahAnggota} orang*\n`;
            templatePesan += `📉 *Biaya Per Orang : ${formatRupiah(hargaPerOrang)}*\n`;
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

        if (!isiChat.startsWith(PREFIX)) return;
        const argumen = isiChat.slice(PREFIX.length).trim().split(/ +/);
        const perintah = argumen.shift().toLowerCase();

        if (perintah === 'patungan' && isGroup) {
            try {
                const metadataGrup = await sock.groupMetadata(infoGrup);
                const jumlahAnggota = metadataGrup.participants.length;
                
                const totalHargaGrup = memoriHarga[infoGrup] || HARGA_DEFAULT;
                const hargaPerOrang = totalHargaGrup / jumlahAnggota;

                let infoPesan = `💰 Total Tagihan : *${formatRupiah(totalHargaGrup)}*\n`;
                infoPesan += `👥 Total Anggota : *${jumlahAnggota} orang*\n`;
                infoPesan += `📉 *Biaya Per Orang : ${formatRupiah(hargaPerOrang)}*\n───────────────────\n`;
                infoPesan += `🔗 *LINK KONFIRMASI:* https://wa.me/${nomor}?text=Halo%20saya%20sudah%20bayar%20patungan`;

                // Logika Penentuan File QRIS Otomatis
                const namaGambarSpesifik = `./qris_${folderSesi}.jpg`; 
                const namaGambarDefault = './qris.jpg';

                if (fs.existsSync(namaGambarSpesifik)) {
                    // Jika ada QRIS khusus untuk nomor ini (Pilihan B)
                    const gambarBuffer = fs.readFileSync(namaGambarSpesifik);
                    await sock.sendMessage(infoGrup, { image: gambarBuffer, caption: infoPesan }, { quoted: msg });
                } else if (fs.existsSync(namaGambarDefault)) {
                    // Jika tidak ada QRIS khusus, pakai QRIS standar global (Pilihan A)
                    const gambarBuffer = fs.readFileSync(namaGambarDefault);
                    await sock.sendMessage(infoGrup, { image: gambarBuffer, caption: infoPesan }, { quoted: msg });
                } else {
                    // Jika file QRIS sama sekali tidak ada di repositori
                    await sock.sendMessage(infoGrup, { text: infoPesan + '\n\n⚠️ _File gambar QRIS tidak ditemukan di folder bot!_' }, { quoted: msg });
                }

            } catch (e) { 
                console.log(`Error Patungan [BOT ${nomor}]:`, e.message); 
            }
        }

        if (perintah === 'setharga' && isGroup) {
            const hargaBaru = parseInt(argumen[0]);
            if (isNaN(hargaBaru) || hargaBaru <= 0) return;

            memoriHarga[infoGrup] = hargaBaru;
            
            const metadataGrup = await sock.groupMetadata(infoGrup);
            const jumlahAnggota = metadataGrup.participants.length;
            const hargaPerOrang = hargaBaru / jumlahAnggota;

            let pesanSukses = `✅ *Target Patungan Berhasil Diubah!*\n\n`;
            pesanSukses += `💰 Tagihan Baru : *${formatRupiah(hargaBaru)}*\n`;
            pesanSukses += `📉 *Biaya Baru/Orang : ${formatRupiah(hargaPerOrang)}* (${jumlahAnggota} anggota)`;

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
