require('dotenv').config();

/**
 * SERVIDOR MULTI-TENANT CON BASE DE DATOS
 * Sistema completo con login, MySQL y sesiones por cliente
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const WhatsAppConnection = require('./whatsapp');

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

// Pool de conexiones
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

/**
 * Obtener cliente por API Key
 */
async function getClientByApiKey(apiKey) {
    const [rows] = await pool.execute(
        'SELECT * FROM clients WHERE api_key = ? AND status = "active"',
        [apiKey]
    );
    return rows[0] || null;
}

/**
 * Obtener cliente por email
 */
async function getClientByEmail(email) {
    const [rows] = await pool.execute(
        'SELECT * FROM clients WHERE email = ?',
        [email]
    );
    return rows[0] || null;
}

/**
 * Obtener cliente por session token
 */
async function getClientBySession(sessionToken) {
    const [rows] = await pool.execute(`
        SELECT c.* FROM clients c
        INNER JOIN sessions s ON c.client_id = s.client_id
        WHERE s.session_token = ? AND s.expires_at > NOW()
    `, [sessionToken]);
    return rows[0] || null;
}

/**
 * Crear sesión de login
 */
async function createSession(clientId, ipAddress, userAgent) {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días
    
    await pool.execute(`
        INSERT INTO sessions (client_id, session_token, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?)
    `, [clientId, sessionToken, ipAddress, userAgent, expiresAt]);
    
    return sessionToken;
}

/**
 * Actualizar estado de conexión de WhatsApp
 */
async function updateWhatsAppStatus(clientId, connected, phoneNumber = null) {
    await pool.execute(`
        UPDATE clients 
        SET whatsapp_connected = ?, phone_number = ?
        WHERE client_id = ?
    `, [connected, phoneNumber, clientId]);
}

/**
 * Registrar mensaje enviado
 */
async function logMessage(clientId, phoneNumber, messageType, status, errorMessage = null, messageId = null) {
    await pool.execute(`
        INSERT INTO message_logs (client_id, phone_number, message_type, status, error_message, message_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [clientId, phoneNumber, messageType, status, errorMessage, messageId]);
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
    const wa = new WhatsAppConnection();
    wa.authFolder = `./auth/${clientId}`;
    
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
        await waData.instance.initialize();
        waData.isInitialized = true;
        
        // Actualizar estado en BD cuando se conecte
        waData.instance.client.on('ready', async () => {
            const info = waData.instance.client.info;
            await updateWhatsAppStatus(clientId, true, info.wid.user);
        });
        
        waData.instance.client.on('disconnected', async () => {
            await updateWhatsAppStatus(clientId, false);
        });
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

/**
 * POST /api/admin/login - Login de super admin
 */
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Usuario y contraseña requeridos'
            });
        }
        
        const [rows] = await pool.execute(
            'SELECT * FROM admin_users WHERE username = ?',
            [username]
        );
        
        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }
        
        const admin = rows[0];

        const passwordMatch = await bcrypt.compare(password, admin.password);

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        // Crear token
        const adminToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // ✅ Guardar en tabla admin_sessions
        await pool.execute(`
            INSERT INTO admin_sessions 
            (admin_id, session_token, ip_address, user_agent, expires_at)
            VALUES (?, ?, ?, ?, ?)
        `, [admin.id, adminToken, req.ip, req.headers['user-agent'], expiresAt]);

        res.json({
            success: true,
            admin_token: adminToken,
            username: admin.username,
            role: admin.role
        });

    } catch (error) {
        console.error('Error en admin login:', error);
        res.status(500).json({
            success: false,
            error: 'Error en el servidor'
        });
    }
});

/**
 * GET /api/admin/clients - Listar todos los clientes (requiere admin)
 */
app.get('/api/admin/clients', async (req, res) => {
    try {
        const adminToken = req.headers['x-admin-token'];
        
        if (!adminToken) {
            return res.status(401).json({
                success: false,
                error: 'No autorizado'
            });
        }
        
        // Verificar que es un token de admin
        const [sessions] = await pool.execute(
            'SELECT * FROM admin_sessions WHERE session_token = ? AND expires_at > NOW()',
            [adminToken]
        );
        
        if (sessions.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Sesión de admin inválida'
            });
        }
        
        // Obtener todos los clientes
        const [clients] = await pool.execute('SELECT * FROM clients ORDER BY created_at DESC');
        
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

/**
 * POST /api/admin/clients - Crear nuevo cliente (requiere admin)
 */
app.post('/api/admin/clients', async (req, res) => {
    try {
        const adminToken = req.headers['x-admin-token'];
        
        if (!adminToken) {
            return res.status(401).json({
                success: false,
                error: 'No autorizado'
            });
        }
        
        // Verificar admin
        const [sessions] = await pool.execute(
            'SELECT * FROM admin_sessions WHERE session_token = ? AND expires_at > NOW()',
            [adminToken]
        );
        
        if (sessions.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Sesión de admin inválida'
            });
        }
        
        const { client_id, name, email, password } = req.body;
        
        // Generar API Key
        const apiKey = crypto.randomBytes(32).toString('hex');
        
        // Hash de contraseña
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.execute(`
            INSERT INTO clients (client_id, name, email, password, api_key, status)
            VALUES (?, ?, ?, ?, ?, 'active')
        `, [client_id, name, email, hashedPassword, apiKey]);
        
        res.json({
            success: true,
            message: 'Cliente creado',
            api_key: apiKey
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/admin/clients/:clientId - Eliminar cliente (requiere admin)
 */
app.delete('/api/admin/clients/:clientId', async (req, res) => {
    try {
        const adminToken = req.headers['x-admin-token'];
        
        if (!adminToken) {
            return res.status(401).json({
                success: false,
                error: 'No autorizado'
            });
        }
        
        // Verificar admin
        const [sessions] = await pool.execute(
         'SELECT * FROM admin_sessions WHERE session_token = ? AND expires_at > NOW()',
         [adminToken]
        );
        
        if (sessions.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Sesión de admin inválida'
            });
        }
        
        const { clientId } = req.params;
        
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

/**
 * POST /api/login - Login de clientes
 */
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
        
        // Verificar contraseña
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
        
        // Crear sesión
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

/**
 * POST /api/logout - Cerrar sesión
 */
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

// ========== RUTAS PROTEGIDAS POR SESIÓN (Panel del cliente) ==========

/**
 * GET /api/me - Información del cliente logueado
 */
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

/**
 * GET /api/my-status - Estado de WhatsApp del cliente
 */
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

/**
 * POST /api/my-disconnect - Desconectar mi WhatsApp
 */
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

// ========== RUTAS PROTEGIDAS POR API KEY (PHP externo) ==========

/**
 * POST /api/send - Enviar mensaje (con API Key)
 */
app.post('/api/send', authenticateAPI, async (req, res) => {
    try {
        const { phonenumber, phone, text, message, url, filename } = req.body;
        const clientId = req.client.client_id;
        
        const phoneNumber = phonenumber || phone;
        const messageText = text || message;
        
        if (!phoneNumber || !messageText) {
            await logMessage(clientId, phoneNumber || 'unknown', 'text', 'failed', 'Faltan parámetros');
            return res.status(400).json({
                success: false,
                error: 'Número y mensaje son requeridos'
            });
        }
        
        const wa = await ensureInitialized(clientId);
        
        if (!wa.getStatus()) {
            await logMessage(clientId, phoneNumber, 'text', 'failed', 'WhatsApp no conectado');
            return res.status(503).json({
                success: false,
                error: 'WhatsApp no está conectado'
            });
        }
        
        let result;
        const messageType = url ? 'file' : 'text';
        
        try {
            if (url) {
                const urlParts = url.split('/');
                const fileNameFromUrl = filename || urlParts[urlParts.length - 1] || 'documento.pdf';
                
                result = await wa.sendFile(phoneNumber, url, fileNameFromUrl, messageText);
            } else {
                result = await wa.sendMessage(phoneNumber, messageText);
            }
            
            await logMessage(clientId, phoneNumber, messageType, 'sent', null, result.messageId);
            
            res.json({
                success: true,
                message: 'Mensaje enviado',
                data: {
                    phone: phoneNumber,
                    messageId: result.messageId
                }
            });
        } catch (sendError) {
            await logMessage(clientId, phoneNumber, messageType, 'failed', sendError.message);
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

/**
 * POST /v2/sendMessage - Alias 360messenger
 */
app.post('/v2/sendMessage', authenticateAPI, (req, res) => {
    req.url = '/api/send';
    app.handle(req, res);
});

// ========== ERROR 404 ==========

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint no encontrado'
    });
});

// ========== INICIAR SERVIDOR ==========

app.listen(PORT, '0.0.0.0', async () => {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║  🚀 WHATSAPP API MULTI-TENANT + MySQL     ║');
    console.log('╚════════════════════════════════════════════╝\n');
    console.log(`📱 Login Portal: http://localhost:${PORT}`);
    console.log(`🔌 API REST:     http://localhost:${PORT}/api`);
    console.log(`🗄️  MySQL:       Conectado\n`);
    
    // Test de conexión a BD
    try {
        await pool.execute('SELECT 1');
        console.log('✅ Conexión a MySQL exitosa\n');
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