/**
 * WhatsApp Connection OPTIMIZADO
 * Rápido y eficiente para servidor
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

class WhatsAppConnection {
    constructor(clientId) {
        this.clientId = clientId;
        this.authFolder = `./auth/${clientId}`;
        this.client = null;
        this.qrCode = null;
        this.qrCodeImage = null;
        this.isConnected = false;
        this.isInitializing = false;
        this.phoneNumber = null;
    }
    
    async initialize() {
        if (this.isInitializing) {
            console.log(`⏳ [${this.clientId}] Ya se está inicializando...`);
            return;
        }
        
        this.isInitializing = true;
        console.log(`🚀 [${this.clientId}] Iniciando WhatsApp...`);
        
        try {
            // Cliente con configuración OPTIMIZADA
            this.client = new Client({
                authStrategy: new LocalAuth({
                    dataPath: this.authFolder,
                    clientId: this.clientId
                }),
                puppeteer: {
                    headless: true,
                    executablePath: '/usr/bin/chromium',
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process',
                        '--disable-gpu',
                        '--disable-extensions',
                        '--disable-background-networking',
                        '--disable-default-apps',
                        '--disable-sync',
                        '--disable-translate',
                        '--mute-audio'
                    ],
                    timeout: 60000
                },
                webVersionCache: {
                    type: 'remote',
                    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
                }
            });
            
            // QR Code (NO BLOQUEANTE)
            this.client.on('qr', (qr) => {
                console.log(`📱 [${this.clientId}] QR GENERADO`);
                this.qrCode = qr;
                
                // Generar imagen async
                QRCode.toDataURL(qr).then(img => {
                    this.qrCodeImage = img;
                    console.log(`✅ [${this.clientId}] QR imagen lista`);
                }).catch(() => {});
            });
            
            // Autenticado
            this.client.on('authenticated', () => {
                console.log(`🔐 [${this.clientId}] Autenticado`);
            });
            
            // Listo
            this.client.on('ready', () => {
                console.log(`✅ [${this.clientId}] CONECTADO`);
                this.isConnected = true;
                this.qrCode = null;
                this.qrCodeImage = null;
                this.isInitializing = false;
                this.phoneNumber = this.client.info.wid.user;
            });
            
            // Desconectado
            this.client.on('disconnected', (reason) => {
                console.log(`❌ [${this.clientId}] Desconectado:`, reason);
                this.isConnected = false;
                this.qrCode = null;
                this.qrCodeImage = null;
                this.isInitializing = false;
                this.phoneNumber = null;
            });
            
            // Error
            this.client.on('auth_failure', () => {
                console.error(`❌ [${this.clientId}] Error autenticación`);
                this.isInitializing = false;
            });
            
            // Inicializar (NO AWAIT - no bloquea)
            this.client.initialize();
            
        } catch (error) {
            console.error(`❌ [${this.clientId}] Error:`, error.message);
            this.isInitializing = false;
            throw error;
        }
    }
    
    async sendMessage(phone, message) {
        if (!this.isConnected) {
            throw new Error('WhatsApp no conectado');
        }
        
        try {
            let chatId = phone.replace(/[^0-9]/g, '');
            if (!chatId.includes('@')) {
                chatId += '@c.us';
            }
            
            const result = await this.client.sendMessage(chatId, message);
            console.log(`✅ [${this.clientId}] Mensaje a ${phone}`);
            
            return {
                success: true,
                phone: phone,
                messageId: result.id.id,
                timestamp: result.timestamp
            };
            
        } catch (error) {
            console.error(`❌ [${this.clientId}] Error:`, error.message);
            throw error;
        }
    }
    
    async sendFile(phone, fileUrl, caption = '') {
        if (!this.isConnected) {
            throw new Error('WhatsApp no conectado');
        }
        
        try {
            const { MessageMedia } = require('whatsapp-web.js');
            
            let chatId = phone.replace(/[^0-9]/g, '');
            if (!chatId.includes('@')) {
                chatId += '@c.us';
            }
            
            const media = await MessageMedia.fromUrl(fileUrl, {
                unsafeMime: true
            });
            
            const result = await this.client.sendMessage(chatId, media, {
                caption: caption || undefined,
                sendMediaAsDocument: true
            });
            
            console.log(`✅ [${this.clientId}] Archivo a ${phone}`);
            
            return {
                success: true,
                phone: phone,
                messageId: result.id.id,
                timestamp: result.timestamp
            };
            
        } catch (error) {
            console.error(`❌ [${this.clientId}] Error:`, error.message);
            throw error;
        }
    }
    
    getQR() {
        return this.qrCode;
    }
    
    getQRImage() {
        return this.qrCodeImage;
    }
    
    getStatus() {
        return this.isConnected;
    }
    
    getPhoneNumber() {
        return this.phoneNumber;
    }
    
    async logout() {
        if (this.client) {
            console.log(`👋 [${this.clientId}] Logout...`);
            await this.client.logout();
            this.isConnected = false;
            this.qrCode = null;
            this.qrCodeImage = null;
            this.phoneNumber = null;
            
            const fs = require('fs');
            if (fs.existsSync(this.authFolder)) {
                fs.rmSync(this.authFolder, { recursive: true, force: true });
            }
        }
    }
    
    async destroy() {
        if (this.client) {
            await this.client.destroy();
            this.client = null;
        }
    }
}

module.exports = WhatsAppConnection;