//BLOQUEO TOTAL de logs Closing session
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = (chunk, encoding, callback) => {
    if (chunk && chunk.toString().includes('Closing session')) return true;
    if (chunk && chunk.toString().includes('SessionEntry')) return true;
    return originalStdoutWrite(chunk, encoding, callback);
};

process.stderr.write = (chunk, encoding, callback) => {
    if (chunk && chunk.toString().includes('Closing session')) return true;
    if (chunk && chunk.toString().includes('SessionEntry')) return true;
    return originalStderrWrite(chunk, encoding, callback);
};


require('dotenv').config();

/**
 * SERVIDOR MULTI-TENANT CON REGISTRO COMPLETO DE MENSAJES
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const WhatsAppConnection = require('./whatsapp');

// SILENCIAR LOGS DE BAILEYS
const originalConsoleLog = console.log;
console.log = function(...args) {
    const message = args.join(' ');
    // Ignorar logs de Baileys sobre sesiones
    if (message.includes('Closing session') || 
        message.includes('SessionEntry') ||
        message.includes('ephemeralKeyPair')) {
        return;
    }
    originalConsoleLog.apply(console, args);
};

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer();

// ========== CONFIGURACIÓN DE BASE DE DATOS ==========
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'whatsapp_api',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// ========== MIDDLEWARES ==========
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(upload.none());
app.use(express.static('public'));

// Almacenar instancias de WhatsApp
const whatsappInstances = {};

// ========== FUNCIONES DE BASE DE DATOS ==========

async function getClientByApiKey(apiKey) {
    const [rows] = await pool.execute(
        'SELECT * FROM clients WHERE api_key = ? AND status = "active"',
        [apiKey]
    );
    return rows[0] || null;
}

async function getClientByEmail(email) {
    const [rows] = await pool.execute(
        'SELECT * FROM clients WHERE email = ?',
        [email]
    );
    return rows[0] || null;
}

async function getClientBySession(sessionToken) {
    const [rows] = await pool.execute(`
        SELECT c.* FROM clients c
        INNER JOIN sessions s ON c.client_id = s.client_id
        WHERE s.session_token = ? AND s.expires_at > NOW()
    `, [sessionToken]);
    return rows[0] || null;
}

async function createSession(clientId, ipAddress, userAgent) {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    await pool.execute(`
        INSERT INTO sessions (client_id, session_token, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?)
    `, [clientId, sessionToken, ipAddress, userAgent, expiresAt]);
    
    return sessionToken;
}

async function updateWhatsAppStatus(clientId, connected, phoneNumber = null) {
    await pool.execute(`
        UPDATE clients 
        SET whatsapp_connected = ?, phone_number = ?
        WHERE client_id = ?
    `, [connected, phoneNumber, clientId]);
}

/**
 * ✨ NUEVA FUNCIÓN MEJORADA - Registrar mensaje con toda la información
 */
async function logMessage(clientId, data) {
    const {
        phoneNumber,
        messageType,
        messageText = null,
        fileUrl = null,
        caption = null,
        status,
        errorMessage = null,
        messageId = null,
        timestampSent = null,
        responseTime = null
    } = data;
    
    try {
        await pool.execute(`
            INSERT INTO message_logs (
                client_id, 
                phone_number, 
                message_type, 
                message_text,
                file_url,
                caption,
                status, 
                error_message, 
                message_id,
                timestamp_sent,
                response_time
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            clientId, 
            phoneNumber, 
            messageType, 
            messageText || null,        
            fileUrl || null,            
            caption || null,           
            status, 
            errorMessage || null,       
            messageId || null,          
            timestampSent || null,      
            responseTime || null        
        ]);
        
        console.log(`📝 [${clientId}] Mensaje registrado en BD: ${phoneNumber}`);
    } catch (error) {
        console.error(`❌ [${clientId}] Error registrando mensaje:`, error.message);
    }
}

// ========== GESTIÓN DE INSTANCIAS WHATSAPP ==========

async function getWhatsAppInstance(clientId) {
    if (whatsappInstances[clientId]) {
        return whatsappInstances[clientId];
    }
    
    const client = await pool.execute(
        'SELECT * FROM clients WHERE client_id = ?',
        [clientId]
    );
    
    if (client[0].length === 0) {
        throw new Error('Cliente no encontrado');
    }
    
    const clientData = client[0][0];
    const wa = new WhatsAppConnection(clientId);
    
    whatsappInstances[clientId] = {
        instance: wa,
        isInitialized: false,
        clientName: clientData.name
    };
    
    return whatsappInstances[clientId];
}

async function ensureInitialized(clientId) {
    const waData = await getWhatsAppInstance(clientId);
    
    if (!waData.isInitialized) {
        console.log(`🔌 Inicializando WhatsApp para: ${waData.clientName}`);
        
        waData.instance.onConnected = async (phoneNumber) => {
            await updateWhatsAppStatus(clientId, true, phoneNumber);
            console.log(`📞 [${clientId}] Número guardado en BD: ${phoneNumber}`);
        };
        
        waData.instance.onDisconnected = async () => {
            await updateWhatsAppStatus(clientId, false, null);
            console.log(`🔴 [${clientId}] Desconectado - BD actualizada`);
        };
        
        waData.instance.onLogout = async () => {
            console.log(`♻️ [${clientId}] Sesión cerrada - Reseteando instancia`);
            delete whatsappInstances[clientId];
            await updateWhatsAppStatus(clientId, false, null);
        };
        
        await waData.instance.initialize();
        waData.isInitialized = true;
    }
    
    return waData.instance;
}

// ========== MIDDLEWARE DE AUTENTICACIÓN ==========

function authenticateAPI(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(401).json({
            success: false,
            error: 'No se proporcionó token de autenticación'
        });
    }
    
    const token = authHeader.replace('Bearer ', '').trim();
    
    getClientByApiKey(token).then(client => {
        if (!client) {
            return res.status(403).json({
                success: false,
                error: 'API Key inválida'
            });
        }
        
        req.client = client;
        next();
    }).catch(err => {
        res.status(500).json({
            success: false,
            error: 'Error de autenticación'
        });
    });
}

async function authenticateSession(req, res, next) {
    const sessionToken = req.headers['x-session-token'] || req.cookies?.session;
    
    if (!sessionToken) {
        return res.status(401).json({
            success: false,
            error: 'Sesión no válida'
        });
    }
    
    try {
        const client = await getClientBySession(sessionToken);
        if (!client) {
            return res.status(401).json({
                success: false,
                error: 'Sesión expirada'
            });
        }
        
        req.client = client;
        req.sessionToken = sessionToken;
        next();
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error de autenticación'
        });
    }
}

// ========== RUTAS PÚBLICAS ==========

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

app.get('/admin-login.html', (req, res) => {
    res.sendFile(__dirname + '/public/admin-login.html');
});

app.get('/admin-panel.html', (req, res) => {
    res.sendFile(__dirname + '/public/admin-panel.html');
});

// [AQUÍ VAN TODAS LAS DEMÁS RUTAS ADMIN - las mantengo igual]

app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Usuario y contraseña requeridos'
            });
        }
        
        const [admins] = await pool.execute(
            'SELECT * FROM admin_users WHERE username = ?',
            [username]
        );
        
        if (admins.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }
        
        const admin = admins[0];
        const passwordMatch = await bcrypt.compare(password, admin.password);
        
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }
        
        const adminToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        
        await pool.execute(`
            INSERT INTO admin_sessions (admin_id, session_token, ip_address, user_agent, expires_at)
            VALUES (?, ?, ?, ?, ?)
        `, [admin.id, adminToken, req.ip, req.headers['user-agent'], expiresAt]);  // ← admin.id
        
        res.json({
            success: true,
            admin_token: adminToken,
            username: admin.username
        });
        
    } catch (error) {
        console.error('Error en admin login:', error);
        res.status(500).json({
            success: false,
            error: 'Error en el servidor'
        });
    }
});

// Función para validar admin token
async function authenticateAdmin(req, res, next) {
    const adminToken = req.headers['x-admin-token'];
    
    if (!adminToken) {
        return res.status(401).json({
            success: false,
            error: 'Token de admin requerido'
        });
    }
    
    try {
        const [sessions] = await pool.execute(`
            SELECT a.* FROM admin_users a
            INNER JOIN admin_sessions s ON a.id = s.admin_id
            WHERE s.session_token = ? AND s.expires_at > NOW()
        `, [adminToken]);
        
        if (sessions.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Sesión de admin inválida'
            });
        }
        
        req.admin = sessions[0];
        next();
    } catch (error) {
        console.error('❌ Error authenticateAdmin:', error);  // ← Agregar log
        res.status(500).json({
            success: false,
            error: 'Error de autenticación'
        });
    }
}

app.get('/api/admin/clients', authenticateAdmin, async (req, res) => {
    try {
        const [clients] = await pool.execute(`
            SELECT 
                client_id,
                name,
                email,
                api_key,
                whatsapp_connected,
                phone_number,
                status,
                created_at
            FROM clients
            ORDER BY created_at DESC
        `);
        
        res.json({
            success: true,
            clients: clients
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/admin/clients', authenticateAdmin, async (req, res) => {
    try {
        const { client_id, name, email, password } = req.body;
        
        if (!client_id || !name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Todos los campos son requeridos'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const apiKey = crypto.randomBytes(32).toString('hex');
        
        await pool.execute(`
            INSERT INTO clients (client_id, name, email, password, api_key)
            VALUES (?, ?, ?, ?, ?)
        `, [client_id, name, email, hashedPassword, apiKey]);
        
        res.json({
            success: true,
            message: 'Cliente creado',
            api_key: apiKey
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                error: 'El ID o email ya existe'
            });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.put('/api/admin/clients/:clientId', authenticateAdmin, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { name, email, password } = req.body;
        
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.execute(`
                UPDATE clients 
                SET name = ?, email = ?, password = ?
                WHERE client_id = ?
            `, [name, email, hashedPassword, clientId]);
        } else {
            await pool.execute(`
                UPDATE clients 
                SET name = ?, email = ?
                WHERE client_id = ?
            `, [name, email, clientId]);
        }
        
        res.json({
            success: true,
            message: 'Cliente actualizado'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.delete('/api/admin/clients/:clientId', authenticateAdmin, async (req, res) => {
    try {
        const { clientId } = req.params;
        
        if (whatsappInstances[clientId]) {
            await whatsappInstances[clientId].instance.logout();
            delete whatsappInstances[clientId];
        }
        
        await pool.execute('DELETE FROM clients WHERE client_id = ?', [clientId]);
        
        res.json({
            success: true,
            message: 'Cliente eliminado'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========== RUTAS CLIENTE ==========

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email y contraseña son requeridos'
            });
        }
        
        const client = await getClientByEmail(email);
        
        if (!client) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }
        
        const passwordMatch = await bcrypt.compare(password, client.password);
        
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }
        
        if (client.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Cuenta suspendida o inactiva'
            });
        }
        
        const sessionToken = await createSession(
            client.client_id,
            req.ip,
            req.headers['user-agent']
        );
        
        res.json({
            success: true,
            session_token: sessionToken,
            client: {
                name: client.name,
                email: client.email,
                client_id: client.client_id,
                api_key: client.api_key
            }
        });
        
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            success: false,
            error: 'Error en el servidor'
        });
    }
});

app.post('/api/logout', async (req, res) => {
    try {
        const sessionToken = req.headers['x-session-token'];
        
        if (sessionToken) {
            await pool.execute(
                'DELETE FROM sessions WHERE session_token = ?',
                [sessionToken]
            );
        }
        
        res.json({
            success: true,
            message: 'Sesión cerrada'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/me', authenticateSession, async (req, res) => {
    res.json({
        success: true,
        client: {
            name: req.client.name,
            email: req.client.email,
            client_id: req.client.client_id,
            api_key: req.client.api_key,
            phone_number: req.client.phone_number,
            whatsapp_connected: req.client.whatsapp_connected
        }
    });
});

app.get('/api/my-status', authenticateSession, async (req, res) => {
    try {
        const clientId = req.client.client_id;
        const wa = await ensureInitialized(clientId);
        
        res.json({
            success: true,
            connected: wa.getStatus(),
            qr: wa.getQRImage() || null,
            phone_number: req.client.phone_number
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/my-disconnect', authenticateSession, async (req, res) => {
    try {
        const clientId = req.client.client_id;
        
        if (whatsappInstances[clientId]) {
            await whatsappInstances[clientId].instance.logout();
            delete whatsappInstances[clientId];
            await updateWhatsAppStatus(clientId, false);
        }
        
        res.json({
            success: true,
            message: 'WhatsApp desconectado'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==========  RUTA MEJORADA CON LOGGING COMPLETO ==========

app.post('/api/send', authenticateAPI, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { phonenumber, phone, text, message, url, filename, caption } = req.body;
        const clientId = req.client.client_id;
        
        const phoneNumber = phonenumber || phone;
        const messageText = text || message;
        
        if (!phoneNumber || !messageText) {
            await logMessage(clientId, {
                phoneNumber: phoneNumber || 'unknown',
                messageType: 'text',
                messageText: messageText,
                status: 'failed',
                errorMessage: 'Faltan parámetros',
                responseTime: Date.now() - startTime
            });
            
            return res.status(400).json({
                success: false,
                error: 'Número y mensaje son requeridos'
            });
        }
        
        const wa = await ensureInitialized(clientId);
        
        if (!wa.getStatus()) {
            await logMessage(clientId, {
                phoneNumber: phoneNumber,
                messageType: url ? 'file' : 'text',
                messageText: messageText,
                fileUrl: url,
                caption: caption,
                status: 'failed',
                errorMessage: 'WhatsApp no conectado',
                responseTime: Date.now() - startTime
            });
            
            return res.status(503).json({
                success: false,
                error: 'WhatsApp no está conectado'
            });
        }
        
        let result;
        const messageType = url ? 'file' : 'text';
        
        try {
            if (url) {
                // Extraer nombre del archivo de la URL o usar el filename proporcionado
                const fileNameToUse = filename || url.split('/').pop().split('?')[0] || 'documento.pdf';
                result = await wa.sendFile(phoneNumber, url, fileNameToUse, caption || messageText);
            } else {
                result = await wa.sendMessage(phoneNumber, messageText);
        }
            
            const responseTime = Date.now() - startTime;
            
            // REGISTRO COMPLETO DEL MENSAJE
            await logMessage(clientId, {
                phoneNumber: phoneNumber,
                messageType: messageType,
                messageText: messageText,
                fileUrl: url || null,
                caption: caption || null,
                status: 'sent',
                errorMessage: null,
                messageId: result.messageId,
                timestampSent: result.timestamp,
                responseTime: responseTime
            });
            
            res.json({
                success: true,
                message: 'Mensaje enviado',
                data: {
                    phone: phoneNumber,
                    messageId: result.messageId,
                    timestamp: result.timestamp,
                    responseTime: `${responseTime}ms`
                }
            });
            
        } catch (sendError) {
            const responseTime = Date.now() - startTime;
            
            await logMessage(clientId, {
                phoneNumber: phoneNumber,
                messageType: messageType,
                messageText: messageText,
                fileUrl: url || null,
                caption: caption || null,
                status: 'failed',
                errorMessage: sendError.message,
                responseTime: responseTime
            });
            
            throw sendError;
        }
        
    } catch (error) {
        console.error(`❌ Error:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/v2/sendMessage', authenticateAPI, (req, res) => {
    req.url = '/api/send';
    app.handle(req, res);
});

// ========== NUEVA RUTA: Ver historial de mensajes ==========

app.get('/api/my-messages', authenticateSession, async (req, res) => {
    try {
        const clientId = req.client.client_id;
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const status = req.query.status;
        
        console.log(`📊 [DEBUG] Consultando mensajes para: ${clientId}`);
        
        let query = `
            SELECT 
                id,
                phone_number,
                message_type,
                message_text,
                file_url,
                caption,
                status,
                error_message,
                message_id,
                timestamp_sent,
                response_time,
                created_at
            FROM message_logs
            WHERE client_id = ?
        `;
        
        const params = [clientId];
        
        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
        }
        
        query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        
        console.log(`📊 [DEBUG] Ejecutando query...`);
        
        const [messages] = await pool.execute(query, params);
        
        console.log(`✅ [DEBUG] Encontrados ${messages.length} mensajes`);
        
        const [countResult] = await pool.execute(
            'SELECT COUNT(*) as total FROM message_logs WHERE client_id = ?',
            [clientId]
        );
        
        res.json({
            success: true,
            messages: messages,
            total: countResult[0].total,
            limit: limit,
            offset: offset
        });
        
    } catch (error) {
        console.error('❌ [ERROR] Error en /api/my-messages:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/messages-by-phone
 * Devuelve mensajes enviados a un número específico (similar a 360messenger)
 * Parámetros:
 *   - phonenumber (obligatorio)
 *   - limit (opcional, por defecto 100)
 *   - offset (opcional, por defecto 0)
 */
/**
 * GET /api/messages-by-phone
 * Devuelve solo mensajes del cliente autenticado hacia un número
 */
app.get('/api/messages-by-phone', authenticateAPI, async (req, res) => {
    try {
        const clientId = req.client.client_id;
        const phonenumber = req.query.phonenumber;

        if (!phonenumber) {
            return res.status(400).json({
                success: false,
                error: 'El parámetro phonenumber es obligatorio'
            });
        }

        const cleanPhone = phonenumber.replace(/\D/g, '');
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const status = req.query.status;

        // ✅ LIMIT y OFFSET interpolados igual que en /api/my-messages
       let query = `
    SELECT 
        id,
        IFNULL(phone_number, '') AS phonenumber,
        message_type,
        IFNULL(message_text, '') AS message,  -- Evita que 'message' sea null
        IFNULL(file_url, '') AS file_url,
        IFNULL(caption, '') AS caption,
        status,
        error_message,
        message_id,
        IFNULL(timestamp_sent, 0) AS timestamp,
        response_time,
        created_at
    FROM message_logs
    WHERE client_id = ?
      AND REPLACE(phone_number, ' ', '') LIKE ?
`;
        const params = [clientId, `%${cleanPhone}%`];

        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
        }

        query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

        const [messages] = await pool.execute(query, params);

        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total 
             FROM message_logs 
             WHERE client_id = ? 
               AND REPLACE(phone_number, ' ', '') LIKE ?`,
            [clientId, `%${cleanPhone}%`]
        );

        const total = countResult[0].total || 0;
        const page = Math.floor(offset / limit) + 1;
        const pageCount = total > 0 ? Math.ceil(total / limit) : 1;

        res.json({
            success: true,
            data: {
                count: messages.length,
                pageCount: pageCount,
                page: page,
                data: messages,
                phone_numbers: [phonenumber]
            },
            statusCode: 200,
            timestamp: new Date().toISOString().replace("T", " ").substring(0, 19)
        });

    } catch (error) {
        console.error('❌ Error en /api/messages-by-phone:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


/**
 * GET /api/admin/messages - Ver todos los mensajes (admin)
 */
app.get('/api/admin/messages', authenticateAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 1000;
        
        // ✅ CORRECCIÓN: No usar prepared statement para LIMIT
        const [messages] = await pool.execute(
            `SELECT * FROM message_logs ORDER BY created_at DESC LIMIT ${limit}`
        );
        
        res.json({
            success: true,
            messages: messages,
            total: messages.length
        });
        
    } catch (error) {
        console.error('❌ Error en /api/admin/messages:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/verify - Verificar si un número existe en WhatsApp
 */
app.post('/api/verify', authenticateAPI, async (req, res) => {
    try {
        const { phone, phonenumber } = req.body;
        const phoneNumber = phone || phonenumber;
        const clientId = req.client.client_id;
        
        if (!phoneNumber) {
            return res.status(400).json({ success: false, error: 'Número requerido' });
        }
        
        const wa = await ensureInitialized(clientId);
        if (!wa.getStatus()) {
            return res.status(503).json({ success: false, error: 'WhatsApp no conectado' });
        }
        
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        const jid = `${cleanNumber}@s.whatsapp.net`;
        
        const [result] = await wa.sock.onWhatsApp(jid);
        
        res.json({
            success: true,
            exists: result?.exists || false,
            jid: result?.jid || null,
            phone: phoneNumber
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/send-bulk - Enviar mensaje a múltiples números
 */
app.post('/api/send-bulk', authenticateAPI, async (req, res) => {
    try {
        const { phones, text, message, url, filename, caption, delay } = req.body;
        const clientId = req.client.client_id;
        
        const phoneList = Array.isArray(phones) ? phones : phones.split(',').map(p => p.trim());
        const messageText = text || message;
        const delayMs = delay || 2000; // Delay entre mensajes (2 seg default)
        
        if (!phoneList.length || !messageText) {
            return res.status(400).json({ success: false, error: 'phones y message requeridos' });
        }
        
        const wa = await ensureInitialized(clientId);
        if (!wa.getStatus()) {
            return res.status(503).json({ success: false, error: 'WhatsApp no conectado' });
        }
        
        const results = [];
        
        for (const phone of phoneList) {
            try {
                let result;
                if (url) {
                    const fileNameToUse = filename || url.split('/').pop().split('?')[0] || 'documento.pdf';
                    result = await wa.sendFile(phone, url, fileNameToUse, caption || messageText);
                } else {
                    result = await wa.sendMessage(phone, messageText);
                }
                
                results.push({ phone, success: true, messageId: result.messageId });
                
                // Log individual
                await logMessage(clientId, {
                    phoneNumber: phone,
                    messageType: url ? 'file' : 'text',
                    messageText: messageText,
                    fileUrl: url || null,
                    caption: caption || null,
                    status: 'sent',
                    messageId: result.messageId,
                    timestampSent: result.timestamp,
                    responseTime: 0
                });
                
                // Delay para evitar ban
                if (phoneList.indexOf(phone) < phoneList.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
                
            } catch (error) {
                results.push({ phone, success: false, error: error.message });
                
                await logMessage(clientId, {
                    phoneNumber: phone,
                    messageType: url ? 'file' : 'text',
                    messageText: messageText,
                    fileUrl: url || null,
                    status: 'failed',
                    errorMessage: error.message,
                    responseTime: 0
                });
            }
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        res.json({
            success: true,
            total: phoneList.length,
            sent: successful,
            failed: failed,
            results: results
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/profile-picture - Obtener foto de perfil de un número
 */
app.get('/api/profile-picture', authenticateAPI, async (req, res) => {
    try {
        const { phone, phonenumber } = req.query;
        const phoneNumber = phone || phonenumber;
        const clientId = req.client.client_id;
        
        if (!phoneNumber) {
            return res.status(400).json({ success: false, error: 'Número requerido' });
        }
        
        const wa = await ensureInitialized(clientId);
        if (!wa.getStatus()) {
            return res.status(503).json({ success: false, error: 'WhatsApp no conectado' });
        }
        
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        const jid = `${cleanNumber}@s.whatsapp.net`;
        
        const profilePicUrl = await wa.sock.profilePictureUrl(jid, 'image');
        
        res.json({
            success: true,
            phone: phoneNumber,
            profilePicture: profilePicUrl || null
        });
        
    } catch (error) {
        res.json({
            success: true,
            phone: phoneNumber,
            profilePicture: null,
            message: 'No profile picture available'
        });
    }
});

/**
 * GET /api/stats - Estadísticas de mensajes del cliente
 */
app.get('/api/stats', authenticateAPI, async (req, res) => {
    try {
        const clientId = req.client.client_id;
        const days = parseInt(req.query.days) || 30;
        
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);
        
        // Total mensajes
        const [totalResult] = await pool.execute(
            'SELECT COUNT(*) as total FROM message_logs WHERE client_id = ? AND created_at >= ?',
            [clientId, dateFrom]
        );
        
        // Mensajes enviados
        const [sentResult] = await pool.execute(
            'SELECT COUNT(*) as sent FROM message_logs WHERE client_id = ? AND status = "sent" AND created_at >= ?',
            [clientId, dateFrom]
        );
        
        // Mensajes fallidos
        const [failedResult] = await pool.execute(
            'SELECT COUNT(*) as failed FROM message_logs WHERE client_id = ? AND status = "failed" AND created_at >= ?',
            [clientId, dateFrom]
        );
        
        // Tiempo promedio de respuesta
        const [avgTimeResult] = await pool.execute(
            'SELECT AVG(response_time) as avg_time FROM message_logs WHERE client_id = ? AND status = "sent" AND created_at >= ?',
            [clientId, dateFrom]
        );
        
        // Mensajes por día (últimos 7 días)
        const [dailyStats] = await pool.execute(`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM message_logs 
            WHERE client_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `, [clientId]);
        
        res.json({
            success: true,
            period_days: days,
            total: totalResult[0].total,
            sent: sentResult[0].sent,
            failed: failedResult[0].failed,
            success_rate: totalResult[0].total > 0 ? ((sentResult[0].sent / totalResult[0].total) * 100).toFixed(2) + '%' : '0%',
            avg_response_time_ms: Math.round(avgTimeResult[0].avg_time || 0),
            daily_stats: dailyStats
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/webhook - Configurar webhook para mensajes recibidos
 */
app.post('/api/webhook', authenticateAPI, async (req, res) => {
    try {
        const { url, events } = req.body;
        const clientId = req.client.client_id;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL requerida' });
        }
        
        // Guardar webhook en BD (necesitas crear tabla webhooks)
        await pool.execute(`
            INSERT INTO webhooks (client_id, url, events, status)
            VALUES (?, ?, ?, 'active')
            ON DUPLICATE KEY UPDATE url = ?, events = ?
        `, [clientId, url, JSON.stringify(events || ['message']), url, JSON.stringify(events || ['message'])]);
        
        res.json({
            success: true,
            message: 'Webhook configurado',
            url: url,
            events: events || ['message']
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/health - Estado de salud de la API
 */
app.get('/api/health', async (req, res) => {
    try {
        await pool.execute('SELECT 1');
        
        const totalInstances = Object.keys(whatsappInstances).length;
        const connectedInstances = Object.values(whatsappInstances)
            .filter(wa => wa.instance && wa.instance.getStatus()).length;
        
        res.json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected',
            whatsapp_instances: {
                total: totalInstances,
                connected: connectedInstances,
                disconnected: totalInstances - connectedInstances
            },
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            status: 'unhealthy',
            error: error.message
        });
    }
});

/**
 * GET /api/groups - Listar grupos del cliente
 */
app.get('/api/groups', authenticateAPI, async (req, res) => {
    try {
        const clientId = req.client.client_id;
        
        const wa = await ensureInitialized(clientId);
        if (!wa.getStatus()) {
            return res.status(503).json({ success: false, error: 'WhatsApp no conectado' });
        }
        
        const groups = await wa.sock.groupFetchAllParticipating();
        const groupList = Object.values(groups).map(group => ({
            id: group.id,
            name: group.subject,
            participants: group.participants.length,
            creation: group.creation,
            owner: group.owner
        }));
        
        res.json({
            success: true,
            total: groupList.length,
            groups: groupList
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * POST /api/send-group - Enviar mensaje a un grupo
 */
app.post('/api/send-group', authenticateAPI, async (req, res) => {
    try {
        const { group_id, text, message } = req.body;
        const clientId = req.client.client_id;
        const messageText = text || message;
        
        if (!group_id || !messageText) {
            return res.status(400).json({ success: false, error: 'group_id y message requeridos' });
        }
        
        const wa = await ensureInitialized(clientId);
        if (!wa.getStatus()) {
            return res.status(503).json({ success: false, error: 'WhatsApp no conectado' });
        }
        
        const result = await wa.sock.sendMessage(group_id, { text: messageText });
        
        res.json({
            success: true,
            message: 'Mensaje enviado al grupo',
            messageId: result.key.id,
            group_id: group_id
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * GET /api/status - Verificar estado de conexión de WhatsApp
 */
app.get('/api/status', authenticateAPI, async (req, res) => {
    try {
        const clientId = req.client.client_id;
        const wa = whatsappInstances[clientId];
        
        if (!wa || !wa.instance) {
            return res.json({
                success: true,
                connected: false,
                phone: null,
                message: 'WhatsApp no inicializado'
            });
        }
        
        const isConnected = wa.instance.getStatus();
        const phoneNumber = wa.instance.getPhoneNumber();
        
        res.json({
            success: true,
            connected: isConnected,
            phone: phoneNumber,
            client_id: clientId
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});




// ========== ERROR 404 ==========

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint no encontrado'
    });
});

// ========== INICIALIZACIÓN AUTOMÁTICA AL ARRANQUE ==========

async function initializeAllWhatsAppConnections() {
    try {
        console.log('🔄 Inicializando conexiones de WhatsApp...');
        
        const [clients] = await pool.execute(
            'SELECT client_id FROM clients WHERE status = "active"'
        );
        
        console.log(`📱 Encontrados ${clients.length} clientes activos`);
        
        for (const client of clients) {
            try {
                console.log(`🔌 Inicializando WhatsApp para: ${client.client_id}`);
                await ensureInitialized(client.client_id);
            } catch (error) {
                console.error(`❌ Error inicializando ${client.client_id}:`, error.message);
            }
        }
        
        console.log('✅ Inicialización de WhatsApp completada\n');
    } catch (error) {
        console.error('❌ Error en inicialización automática:', error.message);
    }
}

// ========== KEEPALIVE AUTOMÁTICO ==========

function startWhatsAppKeepalive() {
    // Cada 24 horas, verifica todas las conexiones
    setInterval(async () => {
        console.log('🔄 Ejecutando keepalive de WhatsApp...');
        
        for (const clientId in whatsappInstances) {
            try {
                const waData = whatsappInstances[clientId];
                if (waData && waData.instance) {
                    const status = waData.instance.getStatus();
                    
                    if (status) {
                        // Conexión activa, hacer un "ping" silencioso
                        console.log(`✅ [${clientId}] Conexión activa`);
                    } else {
                        // Conexión caída, reintentar
                        console.log(`🔄 [${clientId}] Reconectando...`);
                        await ensureInitialized(clientId);
                    }
                }
            } catch (error) {
                console.error(`❌ [${clientId}] Error en keepalive:`, error.message);
            }
        }
    }, 24 * 60 * 60 * 1000); // 24 horas
}



// ========== INICIAR SERVIDOR ==========

app.listen(PORT, '0.0.0.0', async () => {
    console.log('\n╔═══════════════════════════════════════════╗');
    console.log('║  🚀 WHATSAPP API MULTI-TENANT + MySQL     ║');
    console.log('╚═══════════════════════════════════════════╝\n');
    console.log(`📱 Login Portal: http://localhost:${PORT}`);
    console.log(`🔌 API REST:     http://localhost:${PORT}/api`);
    console.log(`🗄️  MySQL:       Conectado\n`);
    
    try {
        await pool.execute('SELECT 1');
        console.log('✅ Conexión a MySQL exitosa\n');

        // ✨ INICIALIZAR EN SEGUNDO PLANO (no bloquea el arranque)
        setTimeout(async () => {
            await initializeAllWhatsAppConnections();
            
            // ✨ INICIAR KEEPALIVE
            startWhatsAppKeepalive();
            console.log('🔄 Keepalive iniciado (verificación cada 24h)\n');
        }, 2000); // Espera 2 segundos después del arranque

    } catch (error) {
        console.error('❌ Error conectando a MySQL:', error.message);
        console.error('   Verifica la configuración en dbConfig\n');
    }
});

process.on('SIGINT', async () => {
    console.log('\n\n🛑 Cerrando servidor...');
    await pool.end();
    process.exit(0);
});