const http = require('http');

const PORT = process.env.PORT || 3000;

console.log('🚀 Iniciando servidor...');

const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const response = {
        success: true,
        message: 'WhatsApp Multi-Instance Server está rodando!',
        server: 'EKKO Brindes',
        timestamp: new Date().toISOString(),
        instances_active: 0,
        url: req.url,
        method: req.method
    };
    
    res.writeHead(200);
    res.end(JSON.stringify(response, null, 2));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🚀 WhatsApp Multi-Instance Server - EKKO Brindes');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`✅ Teste: http://0.0.0.0:${PORT}/health`);
    console.log('═══════════════════════════════════════════════════════════════');
});

server.on('error', (error) => {
    console.error('❌ Erro no servidor:', error);
    process.exit(1);
});

process.on('SIGTERM', () => {
    console.log('⚠️  Desligando servidor...');
    server.close(() => {
        console.log('✅ Servidor desligado');
        process.exit(0);
    });
});
