const nodemailer = require('nodemailer');
require('dotenv').config();

// Configurar transporte de correo
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    }
});

// Verificar conexión al iniciar
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Error configurando el correo:', error.message);
    } else {
        console.log('✅ Servidor de correo listo.');
    }
});

// =========================================================
// CORREO DE BIENVENIDA
// =========================================================
async function enviarCorreoBienvenida(usuario) {
    const mailOptions = {
        from: `"Alma Estética" <${process.env.MAIL_USER}>`,
        to: usuario.email,
        subject: '💖 ¡Bienvenida a Alma Estética!',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 40px;">
                <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
                    <h1 style="font-family: Georgia, serif; font-size: 32px; color: #000; text-align: center; margin-bottom: 8px;">
                        Alma Estética
                    </h1>
                    <p style="text-align: center; font-size: 12px; letter-spacing: 3px; color: #888; text-transform: uppercase; margin-bottom: 32px;">
                        Estética facial no quirúrgica
                    </p>

                    <h2 style="font-family: Georgia, serif; font-size: 24px; color: #000; margin-bottom: 16px;">
                        ¡Hola, ${usuario.nombre}! 💖
                    </h2>

                    <p style="font-size: 15px; color: #555; line-height: 1.7; margin-bottom: 20px;">
                        ¡Gracias por registrarte en <strong>Alma Estética</strong>! Estamos muy contentas de tenerte con nosotras.
                    </p>

                    <p style="font-size: 15px; color: #555; line-height: 1.7; margin-bottom: 24px;">
                        Con tu cuenta ya puedes:
                    </p>

                    <ul style="font-size: 14px; color: #555; line-height: 2; padding-left: 20px; margin-bottom: 32px;">
                        <li>📅 Agendar citas en línea</li>
                        <li>💉 Consultar nuestros tratamientos y precios</li>
                        <li>👩‍⚕️ Elegir al especialista de tu preferencia</li>
                        <li>📋 Ver tu historial de tratamientos</li>
                        <li>💬 Chatear con nuestra asistente virtual Alma</li>
                    </ul>

                    <div style="text-align: center; margin-bottom: 32px;">
                        <a href="http://localhost:3000" style="display: inline-block; background: #000; color: white; padding: 16px 40px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 1px;">
                            Ir a Alma Estética →
                        </a>
                    </div>

                    <div style="background: #f0f8ff; border-left: 4px solid #2196f3; padding: 16px; border-radius: 6px; margin-bottom: 24px;">
                        <p style="font-size: 13px; color: #555; margin: 0;">
                            🎁 <strong>Primera consulta de valoración GRATIS</strong><br>
                            Agenda tu cita y aprovecha este beneficio exclusivo para nuevos clientes.
                        </p>
                    </div>

                    <p style="font-size: 13px; color: #888; text-align: center; margin-top: 32px;">
                        ¿Tienes dudas? Contáctanos por WhatsApp o visita nuestras sucursales.
                    </p>

                    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

                    <p style="font-size: 12px; color: #aaa; text-align: center;">
                        © 2026 Alma Estética. Todos los derechos reservados.<br>
                        Este correo fue enviado a ${usuario.email} porque te registraste en nuestra plataforma.
                    </p>
                </div>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Correo de bienvenida enviado a ${usuario.email}`);
        return info;
    } catch (error) {
        console.error('❌ Error enviando correo de bienvenida:', error.message);
        return null;
    }
}

// =========================================================
// CORREO DE CONFIRMACIÓN DE CITA
// =========================================================
async function enviarCorreoCitaConfirmada(usuario, cita, servicio, empleado) {
    const mailOptions = {
        from: `"Alma Estética" <${process.env.MAIL_USER}>`,
        to: usuario.email,
        subject: `✅ Cita confirmada - ${servicio.nombre}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 40px;">
                <div style="background: white; padding: 40px; border-radius: 12px;">
                    <h1 style="font-family: Georgia, serif; font-size: 28px; color: #000; text-align: center; margin-bottom: 8px;">
                        ¡Cita Confirmada! ✅
                    </h1>
                    <p style="text-align: center; font-size: 12px; letter-spacing: 3px; color: #888; text-transform: uppercase; margin-bottom: 32px;">
                        Alma Estética
                    </p>

                    <p style="font-size: 15px; color: #555; line-height: 1.7; margin-bottom: 24px;">
                        Hola <strong>${usuario.nombre}</strong>, tu cita ha sido registrada exitosamente.
                    </p>

                    <div style="background: #f5f5f5; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
                        <p style="margin: 8px 0;"><strong>Servicio:</strong> ${servicio.nombre}</p>
                        <p style="margin: 8px 0;"><strong>Fecha:</strong> ${cita.fecha_cita}</p>
                        <p style="margin: 8px 0;"><strong>Especialista:</strong> ${empleado.nombre} ${empleado.apellido_paterno || ''}</p>
                        <p style="margin: 8px 0;"><strong>Duración:</strong> ${servicio.duracion} minutos</p>
                        <p style="margin: 8px 0;"><strong>Precio total:</strong> $${cita.precio_total}</p>
                        <p style="margin: 8px 0; color: #28a745;"><strong>Depósito pagado:</strong> $${cita.deposito} ✅</p>
                        <p style="margin: 8px 0; font-size: 14px; color: #888;"><strong>Saldo pendiente:</strong> $${cita.precio_total - cita.deposito}</p>
                    </div>

                    <p style="font-size: 14px; color: #555; margin-bottom: 16px;">
                        📍 Recuerda llegar 10 minutos antes de tu cita.
                    </p>

                    <p style="font-size: 13px; color: #888; text-align: center; margin-top: 24px;">
                        Si necesitas cancelar o reagendar, hazlo con al menos 24 horas de anticipación.
                    </p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Correo de cita enviado a ${usuario.email}`);
    } catch (error) {
        console.error('❌ Error enviando correo de cita:', error.message);
    }
}

// =========================================================
// CORREO DE PAGO EXITOSO
// =========================================================
async function enviarCorreoPagoExitoso(usuario, cita, monto) {
    const mailOptions = {
        from: `"Alma Estética" <${process.env.MAIL_USER}>`,
        to: usuario.email,
        subject: '💳 Pago recibido - Alma Estética',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 40px;">
                <div style="background: white; padding: 40px; border-radius: 12px;">
                    <div style="text-align: center; font-size: 60px; margin-bottom: 16px;">💳</div>
                    <h1 style="font-family: Georgia, serif; font-size: 28px; color: #000; text-align: center; margin-bottom: 24px;">
                        Pago Recibido
                    </h1>

                    <p style="font-size: 15px; color: #555; line-height: 1.7; margin-bottom: 24px;">
                        Hola <strong>${usuario.nombre}</strong>, hemos recibido tu depósito exitosamente.
                    </p>

                    <div style="background: #d4edda; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
                        <p style="font-size: 14px; color: #155724; margin: 0 0 8px;">Depósito pagado</p>
                        <p style="font-size: 32px; font-weight: 700; color: #155724; margin: 0;">$${monto}</p>
                    </div>

                    <p style="font-size: 14px; color: #555;">
                        📅 Cita: <strong>${cita.fecha_cita}</strong><br>
                        💉 Servicio: <strong>${cita.servicio_nombre}</strong>
                    </p>

                    <p style="font-size: 13px; color: #888; text-align: center; margin-top: 32px;">
                        ¡Te esperamos en Alma Estética! 💖
                    </p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Correo de pago enviado a ${usuario.email}`);
    } catch (error) {
        console.error('❌ Error enviando correo de pago:', error.message);
    }
}

module.exports = {
    transporter,
    enviarCorreoBienvenida,
    enviarCorreoCitaConfirmada,
    enviarCorreoPagoExitoso
};