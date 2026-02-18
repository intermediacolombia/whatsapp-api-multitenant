/**
 * WhatsApp Connection OPTIMIZADO
 * Rápido y eficiente para servidor
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');

class WhatsAppConnection {
    constructor(clientId) {
        this.clientId = clientId;
        this.authFolder = `./auth/${clientId}`;
        this.sock = null;
        this.qrCodeImage = null;
        this.isConnected = false;
        this.isInitializing = false;
        this.phoneNumber = null;
    }

    async initialize() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            logger: pino({ level: 'silent' }),
            browser: ['API WhatsApp', 'Chrome', '1.0.0']
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.qrCodeImage = await QRCode.toDataURL(qr);
                console.log(`📱 [${this.clientId}] Nuevo QR generado`);
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                this.isConnected = false;
                this.isInitializing = false;
                console.log(`❌ [${this.clientId}] Conexión cerrada. Reintentando: ${shouldReconnect}`);
                if (shouldReconnect) this.initialize();
            } else if (connection === 'open') {
                this.isConnected = true;
                this.isInitializing = false;
                this.qrCodeImage = null;
                this.phoneNumber = this.sock.user.id.split(':')[0];
                console.log(`✅ [${this.clientId}] CONECTADO`);
            }
        });
    }

    async sendMessage(phone, message) {
        if (!this.isConnected) throw new Error('WhatsApp no conectado');
        
        const jid = `${phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        const result = await this.sock.sendMessage(jid, { text: message });
        return { success: true, messageId: result.key.id };
    }

    async sendFile(phone, fileUrl, caption = '') {
        if (!this.isConnected) throw new Error('WhatsApp no conectado');

        const jid = `${phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        const result = await this.sock.sendMessage(jid, { 
            document: { url: fileUrl }, 
            caption: caption,
            fileName: fileUrl.split('/').pop() 
        });
        return { success: true, messageId: result.key.id };
    }

    getQRImage() { return this.qrCodeImage; }
    getStatus() { return this.isConnected; }
    getPhoneNumber() { return this.phoneNumber; }

    async logout() {
        if (this.sock) {
            await this.sock.logout();
            if (fs.existsSync(this.authFolder)) {
                fs.rmSync(this.authFolder, { recursive: true, force: true });
            }
            this.isConnected = false;
        }
    }
}

module.exports = WhatsAppConnection;