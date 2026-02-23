/**
 /* WhatsApp Connection OPTIMIZADO
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

process.env.WA_NO_VERBOSE = 'true';

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

    
    const pino = require('pino')
    const silentLogger = pino({ level: 'silent' })

    this.sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        logger: silentLogger,
        browser: ['API WhatsApp', 'Chrome', '1.0.0'],
    })


    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            this.qrCodeImage = await QRCode.toDataURL(qr);
            console.log(`📱 [${this.clientId}] Nuevo QR generado`);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            this.isConnected = false;
            this.isInitializing = false;
            this.qrCodeImage = null;
            this.phoneNumber = null;

            console.log(`❌ [${this.clientId}] Conexión cerrada. Código: ${statusCode}`);

            // ✅ Si el usuario cerró sesión desde el teléfono
            if (statusCode === DisconnectReason.loggedOut) {
                console.log(`🗑️ [${this.clientId}] Sesión cerrada por el usuario. Limpiando datos...`);
                
                // Borrar archivos de autenticación
                if (fs.existsSync(this.authFolder)) {
                    fs.rmSync(this.authFolder, { recursive: true, force: true });
                }
                
                // Notificar al servidor para que limpie la instancia
                if (this.onLogout) {
                    this.onLogout();
                }
            } else if (shouldReconnect) {
                // Reconectar automáticamente si fue un error temporal
                console.log(`🔄 [${this.clientId}] Reintentando conexión...`);
                setTimeout(() => this.initialize(), 3000); // Esperar 3 segundos antes de reintentar
            }
            
            // Notificar desconexión al servidor
            if (this.onDisconnected) {
                this.onDisconnected();
            }
            
        } else if (connection === 'open') {
            this.isConnected = true;
            this.isInitializing = false;
            this.qrCodeImage = null;
            this.phoneNumber = this.sock.user.id.split(':')[0];
            console.log(`✅ [${this.clientId}] CONECTADO como: ${this.phoneNumber}`);
            
            // ✅ Emitir evento para que server.js actualice la BD
            if (this.onConnected) {
                this.onConnected(this.phoneNumber);
            }
        }
    });

  //Listener de mensajes recibidos
        this.sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const msg of messages) {
                // Ignorar mensajes propios
                if (msg.key.fromMe) continue;
                
                // Ignorar mensajes de broadcast
                if (msg.key.remoteJid === 'status@broadcast') continue;
                
                const messageType = msg.message ? Object.keys(msg.message)[0] : null;
                
                // Solo procesar mensajes de texto por ahora
                if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
                    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
                    const from = msg.key.remoteJid.replace('@s.whatsapp.net', '');
                    
                    console.log(`📩 [${this.clientId}] Mensaje recibido de ${from}: ${messageText}`);
                    
                    // Disparar webhook
                    if (this.onMessageReceived) {
                        this.onMessageReceived({
                            from: from,
                            message: messageText,
                            timestamp: new Date().toISOString(),
                            messageId: msg.key.id
                        });
                    }
                }
            }
        });
    }

   

    async sendFile(phoneNumber, fileUrl, fileName, caption = '') {
    if (!this.isConnected) {
        throw new Error('WhatsApp no está conectado');
    }

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const jid = cleanNumber.includes('@') ? cleanNumber : `${cleanNumber}@s.whatsapp.net`;

    const [result] = await this.sock.onWhatsApp(jid);
    if (!result || !result.exists) {
        throw new Error(`El número ${phoneNumber} no está registrado en WhatsApp`);
    }

    try {
        const axios = require('axios');
        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        let mimetype = response.headers['content-type'] || 'application/octet-stream';
        
        // ✅ DETECTAR TIPO DE ARCHIVO
        let messageContent;
        
        if (mimetype.startsWith('image/')) {
            // Enviar como IMAGEN
            messageContent = {
                image: buffer,
                caption: caption || ''
            };
        } else if (mimetype.startsWith('video/')) {
            // Enviar como VIDEO
            messageContent = {
                video: buffer,
                caption: caption || ''
            };
        } else if (mimetype.startsWith('audio/')) {
            // Enviar como AUDIO
            messageContent = {
                audio: buffer,
                mimetype: mimetype
            };
        } else {
            // Enviar como DOCUMENTO (PDF, Excel, Word, etc.)
            messageContent = {
                document: buffer,
                mimetype: mimetype,
                fileName: fileName,
                caption: caption || ''
            };
        }

        const message = await this.sock.sendMessage(jid, messageContent);

        return {
                success: true,
                messageId: message.key.id,
                timestamp: message.messageTimestamp ? Number(message.messageTimestamp) : Date.now(),
                phone: phoneNumber
            };

    } catch (error) {
        console.error(`❌ Error enviando archivo a ${phoneNumber}:`, error.message);
        throw new Error(`Error enviando archivo: ${error.message}`);
    }
}


async sendMessage(phone, message) {
        if (!this.isConnected) throw new Error('WhatsApp no conectado');
        
        const jid = `${phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        const result = await this.sock.sendMessage(jid, { text: message });
        
        return { 
            success: true, 
            messageId: result.key.id,
            timestamp: result.messageTimestamp ? Number(result.messageTimestamp) : Date.now()
        };
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
async sendMessage(phone, message) {
        if (!this.isConnected) throw new Error('WhatsApp no conectado');
        
        const jid = `${phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        const result = await this.sock.sendMessage(jid, { text: message });
        
        return { 
            success: true, 
            messageId: result.key.id,
            timestamp: result.messageTimestamp ? Number(result.messageTimestamp) : Date.now()
        };
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
