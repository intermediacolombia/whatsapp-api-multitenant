/**
 * WhatsApp Connection OPTIMIZADO
 * Corrección de identificación de número conectado
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser // Importante para limpiar el ID
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');

class WhatsAppConnection {
    constructor(clientId = 'default') {
    this.clientId = clientId;
    this.authFolder = `./auth/${clientId}`;
    this.sock = null;
    this.qrImage = null;
    this.isConnected = false;
}

getPhoneNumber() {
    if (this.sock && this.sock.user && this.sock.user.id) {
        return this.sock.user.id.split(':')[0].split('@')[0];
    }
    return null;
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
            browser: ['API WhatsApp', 'Chrome', '1.0.0'],
            // Añadimos esto para mejorar la estabilidad de la sesión
            syncFullHistory: false 
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
                this.phoneNumber = null; // Limpiar número al desconectar
                console.log(`❌ [${this.clientId}] Conexión cerrada. Reintentando: ${shouldReconnect}`);
                if (shouldReconnect) this.initialize();
            } else if (connection === 'open') {
                this.isConnected = true;
                this.isInitializing = false;
                this.qrCodeImage = null;
                
                // --- MEJORA AQUÍ: Identificación robusta del número ---
                try {
                    // Usamos jidNormalizedUser para obtener el ID limpio (ej: 573001234567@s.whatsapp.net)
                    const fullId = jidNormalizedUser(this.sock.user.id);
                    this.phoneNumber = fullId.split('@')[0];
                    console.log(`✅ [${this.clientId}] CONECTADO como: ${this.phoneNumber}`);
                } catch (e) {
                    console.error("Error al obtener número:", e);
                    this.phoneNumber = "Desconocido";
                }
            }
        });
    }

    // Método para asegurar que el número esté disponible si se consulta justo al conectar
    getPhoneNumber() { 
    if (this.phoneNumber) return this.phoneNumber;
    if (this.sock && this.sock.user && this.sock.user.id) {
        const { jidNormalizedUser } = require('@whiskeysockets/baileys');
        return jidNormalizedUser(this.sock.user.id).split('@')[0];
    }
    return null; 
}

    async sendMessage(phone, message) {
        if (!this.isConnected) throw new Error('WhatsApp no conectado');
        
        const clean = phone.replace(/[^0-9]/g, '');
        const jid = `${clean}@s.whatsapp.net`;
        
        const result = await this.sock.sendMessage(jid, { text: message });
        return { success: true, messageId: result.key.id };
    }

    async sendFile(phone, fileUrl, caption = '') {
        if (!this.isConnected) throw new Error('WhatsApp no conectado');

        const clean = phone.replace(/[^0-9]/g, '');
        const jid = `${clean}@s.whatsapp.net`;
        
        const result = await this.sock.sendMessage(jid, { 
            document: { url: fileUrl }, 
            caption: caption,
            fileName: fileUrl.split('/').pop() 
        });
        return { success: true, messageId: result.key.id };
    }

    getQRImage() { return this.qrCodeImage; }
    getStatus() { return this.isConnected; }

    async logout() {
        if (this.sock) {
            try { await this.sock.logout(); } catch (e) {}
            if (fs.existsSync(this.authFolder)) {
                fs.rmSync(this.authFolder, { recursive: true, force: true });
            }
            this.isConnected = false;
            this.phoneNumber = null;
        }
    }
}

module.exports = WhatsAppConnection;