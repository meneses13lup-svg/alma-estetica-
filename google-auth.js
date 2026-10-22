const { google } = require('googleapis');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

function generarUrlAutorizacion(idUsuario) {
    const scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.send'
    ];
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent',
        state: idUsuario ? String(idUsuario) : ''
    });
}

async function obtenerTokens(code) {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
}

function crearClienteAutenticado(refreshToken) {
    const cliente = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    cliente.setCredentials({ refresh_token: refreshToken });
    return cliente;
}

async function crearEventoCalendar(refreshToken, cita, servicio, empleado) {
    const auth = crearClienteAutenticado(refreshToken);
    const calendar = google.calendar({ version: 'v3', auth });

    const fechaInicio = new Date(cita.fecha_cita.replace(' ', 'T') + ':00');
    const fechaFin = new Date(fechaInicio.getTime() + servicio.duracion * 60000);

    const evento = {
        summary: `Cita: ${servicio.nombre} - Alma Estética`,
        location: `Sucursal #${cita.id_sucursal}`,
        description: `Cita agendada con ${empleado.nombre} ${empleado.apellido_paterno || ''}\n\nServicio: ${servicio.nombre}\nDuración: ${servicio.duracion} min\nPrecio: $${servicio.precio}`,
        start: { dateTime: fechaInicio.toISOString(), timeZone: 'America/Mexico_City' },
        end: { dateTime: fechaFin.toISOString(), timeZone: 'America/Mexico_City' },
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'email', minutes: 24 * 60 },
                { method: 'popup', minutes: 60 }
            ]
        }
    };

    try {
        const result = await calendar.events.insert({ calendarId: 'primary', resource: evento });
        console.log('✅ Evento creado:', result.data.htmlLink);
        return result.data.htmlLink;
    } catch (err) {
        console.error('❌ Error creando evento:', err.message);
        return null;
    }
}

module.exports = {
    oauth2Client,
    generarUrlAutorizacion,
    obtenerTokens,
    crearClienteAutenticado,
    crearEventoCalendar
};