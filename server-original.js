/**
 * ═══════════════════════════════════════════════════════════════
 * 🚀 WHATSAPP MULTI-INSTÂNCIAS SERVER - EKKO BRINDES
 * ═══════════════════════════════════════════════════════════════
 * Servidor Node.js para gerenciar múltiplas instâncias WhatsApp
 * Integrado com WordPress via MySQL
 * URL: ekkobrindes.com.br/loja
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const fs = require('fs-extra');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
// 📦 CONFIGURAÇÕES INICIAIS
// ═══════════════════════════════════════════════════════════════
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SESSIONS_PATH = path.join(__dirname, 'sessions');

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Garantir que a pasta de sessões existe
fs.ensureDirSync(SESSIONS_PATH);

// ═══════════════════════════════════════════════════════════════
// 🗄️ CONEXÃO COM MYSQL (WordPress)
// ═══════════════════════════════════════════════════════════════
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Testar conexão ao iniciar
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Conectado ao MySQL do WordPress');
        console.log('📊 Banco de dados:', process.env.DB_NAME);
        connection.release();
    } catch (error) {
        console.error('❌ Erro ao conectar no MySQL:', error.message);
        console.error('⚠️ Verifique as configurações no arquivo .env');
        process.exit(1);
    }
})();

// ═══════════════════════════════════════════════════════════════
// 💾 ARMAZENAMENTO DE INSTÂNCIAS ATIVAS
// ═══════════════════════════════════════════════════════════════
const instances = new Map();
const qrCodes = new Map();

// ═══════════════════════════════════════════════════════════════
// 🔐 MIDDLEWARE DE AUTENTICAÇÃO
// ═══════════════════════════════════════════════════════════════
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Token não fornecido'
        });
    }

    try {
        const [rows] = await pool.query(
            `SELECT * FROM ${process.env.DB_PREFIX}whatsapp_instances WHERE token = ?`,
            [token]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido'
            });
        }

        req.instance_data = rows[0];
        next();
    } catch (error) {
        console.error('Erro na autenticação:', error);
        res.status(500).json({
            success: false,
            message: 'Erro interno no servidor'
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// 🔧 FUNÇÕES AUXILIARES
// ═══════════════════════════════════════════════════════════════

// Atualizar status no banco de dados
async function updateInstanceStatus(instanceId, status, data = {}) {
    try {
        const updateData = {
            status: status,
            ...data
        };

        if (status === 'connected') {
            updateData.data_conexao = new Date();
        }

        const fields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updateData);
        values.push(instanceId);

        await pool.query(
            `UPDATE ${process.env.DB_PREFIX}whatsapp_instances SET ${fields} WHERE id = ?`,
            values
        );

        console.log(`✅ Status atualizado: Instância ${instanceId} → ${status}`);
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
    }
}

// Registrar log de mensagem
async function logMessage(instanceId, numero, tipo, conteudo, status, response = null) {
    try {
        await pool.query(
            `INSERT INTO ${process.env.DB_PREFIX}whatsapp_logs 
            (instance_id, numero, tipo_mensagem, conteudo, status, response, data_envio) 
            VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [instanceId, numero, tipo, conteudo, status, response ? JSON.stringify(response) : null]
        );
        console.log(`📝 Log registrado: Instância ${instanceId} → ${numero} (${status})`);
    } catch (error) {
        console.error('Erro ao registrar log:', error);
    }
}

// ═══════════════════════════════════════════════════════════════
// 📱 INICIALIZAR INSTÂNCIA WHATSAPP
// ═══════════════════════════════════════════════════════════════
async function initializeInstance(instanceId, instanceToken) {
    if (instances.has(instanceId)) {
        console.log(`⚠️ Instância ${instanceId} já está ativa`);
        return instances.get(instanceId);
    }

    console.log(`🚀 Inicializando instância ${instanceId}...`);

    const sessionPath = path.join(SESSIONS_PATH, `session_${instanceId}`);
    
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: `instance_${instanceId}`,
            dataPath: sessionPath
        }),
        puppeteer: {
            headless: true,
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
    });

    // Evento: QR Code gerado
    client.on('qr', async (qr) => {
        console.log(`📱 QR Code gerado para instância ${instanceId}`);
        
        try {
            const qrDataURL = await qrcode.toDataURL(qr);
            qrCodes.set(instanceId, qrDataURL);
            
            await updateInstanceStatus(instanceId, 'qr_code', {
                qr_code: qrDataURL,
                ultimo_qr: new Date()
            });
            
            console.log(`✅ QR Code armazenado para instância ${instanceId}`);
        } catch (error) {
            console.error(`❌ Erro ao gerar QR Code para instância ${instanceId}:`, error);
        }
    });

    // Evento: Cliente pronto
    client.on('ready', async () => {
        console.log(`✅ Instância ${instanceId} conectada e pronta!`);
        qrCodes.delete(instanceId);
        
        await updateInstanceStatus(instanceId, 'connected', {
            qr_code: null,
            session_id: `session_${instanceId}`
        });
    });

    // Evento: Autenticação bem-sucedida
    client.on('authenticated', async () => {
        console.log(`🔐 Instância ${instanceId} autenticada com sucesso`);
    });

    // Evento: Falha na autenticação
    client.on('auth_failure', async (msg) => {
        console.error(`❌ Falha na autenticação da instância ${instanceId}:`, msg);
        await updateInstanceStatus(instanceId, 'auth_failed');
    });

    // Evento: Desconectado
    client.on('disconnected', async (reason) => {
        console.log(`🔌 Instância ${instanceId} desconectada. Razão:`, reason);
        instances.delete(instanceId);
        qrCodes.delete(instanceId);
        
        await updateInstanceStatus(instanceId, 'disconnected', {
            qr_code: null
        });
    });

    // Evento: Carregando
    client.on('loading_screen', (percent, message) => {
        console.log(`⏳ Instância ${instanceId} carregando: ${percent}% - ${message}`);
    });

    // Evento: Erro
    client.on('error', (error) => {
        console.error(`❌ Erro na instância ${instanceId}:`, error.message);
    });

    // Inicializar cliente
    try {
        await client.initialize();
        instances.set(instanceId, client);
        console.log(`✅ Cliente WhatsApp inicializado para instância ${instanceId}`);
        return client;
    } catch (error) {
        console.error(`❌ Erro ao inicializar instância ${instanceId}:`, error);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🌐 ROTAS DA API
// ═══════════════════════════════════════════════════════════════

// Rota: Health Check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'WhatsApp Multi-Instance Server está rodando!',
        server: 'EKKO Brindes',
        timestamp: new Date().toISOString(),
        instances_active: instances.size,
        sessions_path: SESSIONS_PATH
    });
});

// Rota: Inicializar Instância e Gerar QR Code
app.post('/instance/init', async (req, res) => {
    try {
        const { instance_id, token } = req.body;

        if (!instance_id || !token) {
            return res.status(400).json({
                success: false,
                message: 'instance_id e token são obrigatórios'
            });
        }

        console.log(`📥 Requisição para inicializar instância ${instance_id}`);

        // Verificar se a instância existe no banco
        const [rows] = await pool.query(
            `SELECT * FROM ${process.env.DB_PREFIX}whatsapp_instances WHERE id = ? AND token = ?`,
            [instance_id, token]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Instância não encontrada no banco de dados'
            });
        }

        // Inicializar instância
        await initializeInstance(instance_id, token);

        // Aguardar QR Code ser gerado (timeout de 30 segundos)
        let attempts = 0;
        while (!qrCodes.has(instance_id) && attempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }

        const qrCode = qrCodes.get(instance_id);

        if (qrCode) {
            console.log(`✅ QR Code disponível para instância ${instance_id}`);
        } else {
            console.log(`⏳ Instância ${instance_id} inicializada, aguardando QR Code...`);
        }

        res.json({
            success: true,
            message: qrCode ? 'QR Code gerado' : 'Instância inicializada, aguardando QR Code',
            qr_code: qrCode || null
        });

    } catch (error) {
        console.error('❌ Erro ao inicializar instância:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao inicializar instância',
            error: error.message
        });
    }
});

// Rota: Obter QR Code
app.get('/instance/qr/:instance_id', async (req, res) => {
    try {
        const instanceId = parseInt(req.params.instance_id);
        console.log(`📥 Requisição de QR Code para instância ${instanceId}`);
        
        const qrCode = qrCodes.get(instanceId);

        if (!qrCode) {
            // Verificar no banco de dados
            const [rows] = await pool.query(
                `SELECT qr_code FROM ${process.env.DB_PREFIX}whatsapp_instances WHERE id = ?`,
                [instanceId]
            );

            if (rows.length > 0 && rows[0].qr_code) {
                return res.json({
                    success: true,
                    qr_code: rows[0].qr_code
                });
            }

            return res.status(404).json({
                success: false,
                message: 'QR Code não disponível'
            });
        }

        res.json({
            success: true,
            qr_code: qrCode
        });

    } catch (error) {
        console.error('❌ Erro ao obter QR Code:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao obter QR Code',
            error: error.message
        });
    }
});

// Rota: Verificar Status
app.get('/instance/status/:instance_id', async (req, res) => {
    try {
        const instanceId = parseInt(req.params.instance_id);
        const client = instances.get(instanceId);

        if (!client) {
            return res.json({
                success: true,
                status: 'disconnected',
                message: 'Instância não está ativa no servidor'
            });
        }

        const state = await client.getState();

        res.json({
            success: true,
            status: state === 'CONNECTED' ? 'connected' : 'disconnected',
            state: state
        });

    } catch (error) {
        console.error('❌ Erro ao verificar status:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao verificar status',
            error: error.message
        });
    }
});

// Rota: Desconectar Instância
app.post('/instance/disconnect', async (req, res) => {
    try {
        const { instance_id } = req.body;
        const instanceId = parseInt(instance_id);
        
        console.log(`📥 Requisição para desconectar instância ${instanceId}`);
        
        const client = instances.get(instanceId);

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Instância não está ativa no servidor'
            });
        }

        await client.destroy();
        instances.delete(instanceId);
        qrCodes.delete(instanceId);

        await updateInstanceStatus(instanceId, 'disconnected', {
            qr_code: null,
            session_id: null
        });

        console.log(`✅ Instância ${instanceId} desconectada com sucesso`);

        res.json({
            success: true,
            message: 'Instância desconectada com sucesso'
        });

    } catch (error) {
        console.error('❌ Erro ao desconectar instância:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao desconectar instância',
            error: error.message
        });
    }
});

// Rota: Enviar Mensagem de Texto
app.post('/message/text', authenticateToken, async (req, res) => {
    try {
        const { number, message } = req.body;
        const instanceId = req.instance_data.id;

        if (!number || !message) {
            return res.status(400).json({
                success: false,
                message: 'Parâmetros number e message são obrigatórios'
            });
        }

        console.log(`📥 Enviando texto para ${number} via instância ${instanceId}`);

        const client = instances.get(instanceId);

        if (!client) {
            await logMessage(instanceId, number, 'text', message, 'error', { 
                error: 'Instância não conectada' 
            });
            
            return res.status(503).json({
                success: false,
                message: 'Instância não está conectada no servidor'
            });
        }

        // Formatar número
        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        
        // Enviar mensagem
        const sentMessage = await client.sendMessage(chatId, message);

        await logMessage(instanceId, number, 'text', message, 'success', {
            id: sentMessage.id._serialized,
            timestamp: sentMessage.timestamp
        });

        console.log(`✅ Mensagem enviada com sucesso para ${number}`);

        res.json({
            success: true,
            message: 'Mensagem enviada com sucesso',
            message_id: sentMessage.id._serialized
        });

    } catch (error) {
        console.error('❌ Erro ao enviar mensagem:', error);
        
        const instanceId = req.instance_data.id;
        const { number, message } = req.body;
        
        await logMessage(instanceId, number, 'text', message, 'error', { 
            error: error.message 
        });

        res.status(500).json({
            success: false,
            message: 'Erro ao enviar mensagem',
            error: error.message
        });
    }
});

// Rota: Enviar Imagem
app.post('/message/image', authenticateToken, async (req, res) => {
    try {
        const { number, image_url, caption } = req.body;
        const instanceId = req.instance_data.id;

        if (!number || !image_url) {
            return res.status(400).json({
                success: false,
                message: 'Parâmetros number e image_url são obrigatórios'
            });
        }

        console.log(`📥 Enviando imagem para ${number} via instância ${instanceId}`);

        const client = instances.get(instanceId);

        if (!client) {
            await logMessage(instanceId, number, 'image', `Image: ${image_url}`, 'error', { 
                error: 'Instância não conectada' 
            });
            
            return res.status(503).json({
                success: false,
                message: 'Instância não está conectada no servidor'
            });
        }

        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        const media = await MessageMedia.fromUrl(image_url);
        
        const sentMessage = await client.sendMessage(chatId, media, { 
            caption: caption || '' 
        });

        await logMessage(instanceId, number, 'image', `Image: ${image_url} | Caption: ${caption || 'N/A'}`, 'success', {
            id: sentMessage.id._serialized
        });

        console.log(`✅ Imagem enviada com sucesso para ${number}`);

        res.json({
            success: true,
            message: 'Imagem enviada com sucesso',
            message_id: sentMessage.id._serialized
        });

    } catch (error) {
        console.error('❌ Erro ao enviar imagem:', error);
        
        const instanceId = req.instance_data.id;
        const { number, image_url } = req.body;
        
        await logMessage(instanceId, number, 'image', `Image: ${image_url}`, 'error', { 
            error: error.message 
        });

        res.status(500).json({
            success: false,
            message: 'Erro ao enviar imagem',
            error: error.message
        });
    }
});

// Rota: Enviar Documento
app.post('/message/document', authenticateToken, async (req, res) => {
    try {
        const { number, document_url, filename } = req.body;
        const instanceId = req.instance_data.id;

        if (!number || !document_url) {
            return res.status(400).json({
                success: false,
                message: 'Parâmetros number e document_url são obrigatórios'
            });
        }

        console.log(`📥 Enviando documento para ${number} via instância ${instanceId}`);

        const client = instances.get(instanceId);

        if (!client) {
            await logMessage(instanceId, number, 'document', `Document: ${document_url}`, 'error', { 
                error: 'Instância não conectada' 
            });
            
            return res.status(503).json({
                success: false,
                message: 'Instância não está conectada no servidor'
            });
        }

        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        const media = await MessageMedia.fromUrl(document_url);
        
        if (filename) {
            media.filename = filename;
        }
        
        const sentMessage = await client.sendMessage(chatId, media);

        await logMessage(instanceId, number, 'document', `Document: ${document_url} | Filename: ${filename || 'N/A'}`, 'success', {
            id: sentMessage.id._serialized
        });

        console.log(`✅ Documento enviado com sucesso para ${number}`);

        res.json({
            success: true,
            message: 'Documento enviado com sucesso',
            message_id: sentMessage.id._serialized
        });

    } catch (error) {
        console.error('❌ Erro ao enviar documento:', error);
        
        const instanceId = req.instance_data.id;
        const { number, document_url } = req.body;
        
        await logMessage(instanceId, number, 'document', `Document: ${document_url}`, 'error', { 
            error: error.message 
        });

        res.status(500).json({
            success: false,
            message: 'Erro ao enviar documento',
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════
// 🚀 INICIAR SERVIDOR
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, HOST, () => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🚀 WhatsApp Multi-Instance Server - EKKO Brindes');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ Servidor rodando em http://${HOST}:${PORT}`);
    console.log(`📁 Sessões armazenadas em: ${SESSIONS_PATH}`);
    console.log(`🗄️ Conectado ao banco: ${process.env.DB_NAME}`);
    console.log(`🌐 Site: ekkobrindes.com.br/loja`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📖 Endpoints disponíveis:');
    console.log('   GET  /health');
    console.log('   POST /instance/init');
    console.log('   GET  /instance/qr/:instance_id');
    console.log('   GET  /instance/status/:instance_id');
    console.log('   POST /instance/disconnect');
    console.log('   POST /message/text');
    console.log('   POST /message/image');
    console.log('   POST /message/document');
    console.log('═══════════════════════════════════════════════════════════════');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Encerrando servidor...');
    
    for (const [instanceId, client] of instances) {
        console.log(`📱 Desconectando instância ${instanceId}...`);
        try {
            await client.destroy();
        } catch (error) {
            console.error(`Erro ao desconectar instância ${instanceId}:`, error);
        }
    }
    
    await pool.end();
    console.log('✅ Servidor encerrado com sucesso');
    process.exit(0);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});
