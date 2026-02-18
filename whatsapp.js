/**
 * WhatsApp Connection usando whatsapp-web.js
 * Mucho más estable que Baileys, sin error 515
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');

class WhatsAppConnection {
    constructor() {
        this.client = null;
        this.qrCode = null;
        this.qrCodeImage = null;
        this.isConnected = false;
        this.isInitializing = false;
    }
    
    async initialize() {
        if (this.isInitializing) {
            console.log('⏳ Ya se está inicializando...');
            return;
        }
        
        this.isInitializing = true;
        console.log('🚀 Iniciando conexión a WhatsApp...');
        
        try {
            // Crear cliente con autenticación local
            tthis.client = new Client({
    authStrategy: new LocalAuth({
        dataPath: this.authFolder
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
            '--disable-gpu'
        ]
    }
            
            // ========== EVENTOS ==========
            
            // QR Code generado
            this.client.on('qr', async (qr) => {
                console.log('\n📱 ═══════════════════════════════════════');
                console.log('   QR CODE GENERADO');
                console.log('═══════════════════════════════════════\n');
                
                this.qrCode = qr;
                
                // Convertir a imagen base64
                try {
                    this.qrCodeImage = await QRCode.toDataURL(qr);
                    console.log('✅ QR convertido a imagen base64');
                } catch (error) {
                    console.error('❌ Error generando imagen QR:', error);
                }
                
                // Mostrar en terminal
                qrcode.generate(qr, { small: true });
                
                console.log('\n📋 Instrucciones:');
                console.log('1. Abre WhatsApp en tu teléfono');
                console.log('2. Configuración → Dispositivos vinculados');
                console.log('3. Vincular un dispositivo');
                console.log('4. Escanea el QR\n');
            });
            
            // Autenticando
            this.client.on('authenticated', () => {
                console.log('🔐 Autenticado correctamente');
            });
            
            // Listo
            this.client.on('ready', () => {
                console.log('\n✅ ═══════════════════════════════════════');
                console.log('   WHATSAPP CONECTADO EXITOSAMENTE!');
                console.log('═══════════════════════════════════════\n');
                
                this.isConnected = true;
                this.qrCode = null;
                this.qrCodeImage = null;
                this.isInitializing = false;
                
                const info = this.client.info;
                console.log(`👤 Usuario: ${info.pushname}`);
                console.log(`📱 Número: ${info.wid.user}`);
                console.log(`\n💡 Sistema listo para enviar mensajes\n`);
            });
            
            // Desconectado
            this.client.on('disconnected', (reason) => {
                console.log('❌ Desconectado:', reason);
                this.isConnected = false;
                this.qrCode = null;
                this.qrCodeImage = null;
                this.isInitializing = false;
            });
            
            // Error de autenticación
            this.client.on('auth_failure', (msg) => {
                console.error('❌ Error de autenticación:', msg);
                this.isInitializing = false;
            });
            
            // Mensaje recibido (opcional)
            this.client.on('message', async (msg) => {
                if (!msg.fromMe) {
                    const contact = await msg.getContact();
                    console.log(`📨 Mensaje de ${contact.pushname || contact.number}: ${msg.body.substring(0, 50)}...`);
                }
            });
            
            // Inicializar cliente
            await this.client.initialize();
            console.log('⏳ Esperando autenticación...');
            
        } catch (error) {
            console.error('\n❌ Error fatal:', error.message);
            this.isInitializing = false;
            throw error;
        }
    }
    
    async sendMessage(phone, message) {
        if (!this.isConnected) {
            throw new Error('WhatsApp no está conectado');
        }
        
        try {
            // Formatear número
            let chatId = phone.replace(/[^0-9]/g, '');
            
            // Agregar @c.us si no lo tiene
            if (!chatId.includes('@')) {
                chatId = chatId + '@c.us';
            }
            
            // Enviar mensaje
            const result = await this.client.sendMessage(chatId, message);
            
            console.log(`✅ Mensaje enviado a ${phone}`);
            
            return {
                success: true,
                phone: phone,
                messageId: result.id.id,
                timestamp: result.timestamp
            };
            
        } catch (error) {
            console.error(`❌ Error enviando mensaje:`, error.message);
            throw error;
        }
    }
    
    async sendFile(phone, fileUrl, fileName = 'documento.pdf', caption = '') {
        if (!this.isConnected) {
            throw new Error('WhatsApp no está conectado');
        }
        
        try {
            const { MessageMedia } = require('whatsapp-web.js');
            
            // Formatear número
            let chatId = phone.replace(/[^0-9]/g, '');
            if (!chatId.includes('@')) {
                chatId = chatId + '@c.us';
            }
            
            // Descargar archivo desde URL
            const media = await MessageMedia.fromUrl(fileUrl, {
                unsafeMime: true
            });
            
            // Enviar con nombre personalizado
            const result = await this.client.sendMessage(chatId, media, {
                caption: caption || undefined,
                sendMediaAsDocument: true,
                filename: fileName  // ← ¡Nombre personalizado!
            });
            
            console.log(`✅ Archivo "${fileName}" enviado a ${phone}`);
            
            return {
                success: true,
                phone: phone,
                fileName: fileName,
                messageId: result.id.id,
                timestamp: result.timestamp
            };
            
        } catch (error) {
            console.error(`❌ Error enviando archivo:`, error.message);
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
    
    async logout() {
        if (this.client) {
            await this.client.logout();
            console.log('👋 Sesión cerrada');
            this.isConnected = false;
            this.qrCode = null;
            this.qrCodeImage = null;
            
            // Limpiar carpeta auth
            const fs = require('fs');
            const authPath = './auth';
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
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

// Prueba directa
if (require.main === module) {
    console.log('\n╔═══════════════════════════════════════════╗');
    console.log('║   WHATSAPP API - WHATSAPP-WEB.JS          ║');
    console.log('╚═══════════════════════════════════════════╝\n');
    
    const wa = new WhatsAppConnection();
    
    wa.initialize().catch(error => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
    
    process.on('SIGINT', async () => {
        console.log('\n\n🛑 Cerrando sistema...');
        await wa.destroy();
        process.exit(0);
    });
}