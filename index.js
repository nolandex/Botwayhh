cat << 'EOF' > index.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');

let TOTAL_HARGA = 300000; 
const PREFIX = '!'; 
const NOMOR_BOT = '6285156779923'; 

function formatRupiah(angka) {
    return 'Rp ' + Math.ceil(angka).toLocaleString('id-ID');
}

async function jalankanBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesi_bot');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false, 
        logger: require('pino')({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"] 
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            console.log(`\n⏳ Sedang meminta kode pairing untuk nomor: ${NOMOR_BOT}...`);
            try {
                let code = await sock.requestPairingCode(NOMOR_BOT);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n======================================`);
                console.log(`🔥 KODE PAIRING WHATSAPP KAMU : ${code}`);
                console.log(`======================================\n`);
            } catch (error) {
                console.error('Gagal meminta kode pairing.', error);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const alasan = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
            if (alasan !== DisconnectReason.loggedOut) jalankanBot();
        } else if (connection === 'open') {
            console.log('\n==============================================');
            console.log('     BOT WHATSAPP PATUNGAN MINIMALIS AKTIF!   ');
            console.log('==============================================\n');
        }
    });

    sock.ev.on('group-participants.update', async (update) => {
        const { id, action } = update;
        try {
            await delay(2000); 
            const metadataGrup = await sock.groupMetadata(id);
            const namaGrup = metadataGrup.subject;
            const jumlahAnggota = metadataGrup.participants.length;
            const hargaPerOrang = TOTAL_HARGA / jumlahAnggota;

            let teksStatus = action === 'add' ? `📥 *ANGGOTA BARU BERGABUNG!*` : action === 'remove' ? `📤 *ANGGOTA TELAH KELUAR/DI-KICK!*` : '';
            if (!teksStatus) return;

            let templatePesan = `${teksStatus}\n`;
            templatePesan += `🏠 Grup: *${namaGrup}*\n`;
            templatePesan += `─────────────────────────\n`;
            templatePesan += `💰 Target Tagihan : *${formatRupiah(TOTAL_HARGA)}*\n`;
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
                const hargaPerOrang = TOTAL_HARGA / jumlahAnggota;

                // Teks yang sudah bersih dan dipangkas total
                let infoPesan = `💰 Total Tagihan : *${formatRupiah(TOTAL_HARGA)}*\n`;
                infoPesan += `👥 Total Anggota : *${jumlahAnggota} orang*\n`;
                infoPesan += `📉 *Biaya Per Orang : ${formatRupiah(hargaPerOrang)}*\n───────────────────\n`;
                infoPesan += `🔗 *LINK KONFIRMASI:* https://wa.me/${NOMOR_BOT}?text=Halo%20saya%20sudah%20bayar%20patungan`;

                if (fs.existsSync('./qris.jpg')) {
                    const gambarBuffer = fs.readFileSync('./qris.jpg');
                    await sock.sendMessage(infoGrup, { image: gambarBuffer, caption: infoPesan }, { quoted: msg });
                } else {
                    await sock.sendMessage(infoGrup, { text: infoPesan + '\n\n⚠️ _File qris.jpg tidak ditemukan di folder bot!_' }, { quoted: msg });
                }

            } catch (e) { 
                console.log("Error Patungan:", e.message); 
            }
        }

        if (perintah === 'setharga' && isGroup) {
            const hargaBaru = parseInt(argumen[0]);
            if (isNaN(hargaBaru) || hargaBaru <= 0) return;

            TOTAL_HARGA = hargaBaru;
            const metadataGrup = await sock.groupMetadata(infoGrup);
            const jumlahAnggota = metadataGrup.participants.length;
            const hargaPerOrang = TOTAL_HARGA / jumlahAnggota;

            let pesanSukses = `✅ *Target Patungan Berhasil Diubah!*\n\n`;
            pesanSukses += `💰 Tagihan Baru : *${formatRupiah(TOTAL_HARGA)}*\n`;
            pesanSukses += `📉 *Biaya Baru/Orang : ${formatRupiah(hargaPerOrang)}* (${jumlahAnggota} anggota)`;

            await sock.sendMessage(infoGrup, { text: pesanSukses }, { quoted: msg });
        }
    });
}

jalankanBot();
EOF
