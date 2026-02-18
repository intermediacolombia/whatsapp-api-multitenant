/**
 * ARCHIVO DE PRUEBA: test-enviar.js
 * Prueba para enviar mensaje usando la conexión activa
 */

const WhatsAppConnection = require('./whatsapp');

async function testEnviar() {
    console.log('\n🧪 ═══════════════════════════════════════');
    console.log('   PRUEBA DE ENVÍO DE MENSAJE');
    console.log('═══════════════════════════════════════\n');
    
    const wa = new WhatsAppConnection();
    
    try {
        // Inicializar (usará la sesión ya guardada)
        await wa.initialize();
        
        // Esperar 3 segundos para asegurar conexión
        console.log('⏳ Esperando conexión estable...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        if (!wa.getStatus()) {
            console.log('❌ WhatsApp no está conectado');
            console.log('   Asegúrate de tener el otro proceso corriendo');
            process.exit(1);
        }
        
        console.log('✅ Conexión verificada\n');
        
        // ========== PRUEBA 1: Mensaje de texto ==========
        console.log('📤 Enviando mensaje de texto...');
        
        const resultado1 = await wa.sendMessage(
            '573147165269',  // ← CAMBIA por tu número
            '¡Hola! Este es un mensaje de prueba desde Node.js 🚀'
        );
        
        console.log('✅ Mensaje enviado:', resultado1);
        console.log('   ID:', resultado1.messageId);
        
        // Esperar 2 segundos
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // ========== PRUEBA 2: Enviar archivo (PDF) ==========
        console.log('\n📎 Enviando archivo PDF...');
        
        const resultado2 = await wa.sendFile(
            '573147165269',  // ← CAMBIA por tu número
            'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
            'factura_edmesito_test.pdf',  // ← Nombre personalizado
            'Aquí está tu factura de prueba'
        );
        
        console.log('✅ Archivo enviado:', resultado2);
        console.log('   Nombre:', resultado2.fileName);
        console.log('   ID:', resultado2.messageId);
        
        console.log('\n🎉 ═══════════════════════════════════════');
        console.log('   ¡PRUEBAS COMPLETADAS CON ÉXITO!');
        console.log('═══════════════════════════════════════\n');
        
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Error en las pruebas:', error.message);
        console.error('   Stack:', error.stack);
        process.exit(1);
    }
}

// Ejecutar prueba
testEnviar();
