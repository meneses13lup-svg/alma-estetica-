const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const googleAuth = require('./google-auth');
const mailer = require('./mailer');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// =========================================================
// CONEXIÓN A MYSQL
// =========================================================
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', // <-- Asegúrate de que esta sea tu contraseña de MySQL
    database: 'salon_belleza_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if (err) console.error('❌ Error conectando a MySQL:', err.message);
    else { console.log('✅ Conectado a MySQL (salon_belleza_db)'); connection.release(); }
});

// =========================================================
// MERCADO PAGO
// =========================================================
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
    options: { timeout: 5000 }
});

// =========================================================
// CARGAR LÉXICO (PLN)
// =========================================================
let lexico = {};
try { lexico = JSON.parse(fs.readFileSync(path.join(__dirname, 'lexico.json'), 'utf-8')); } catch (e) { console.error("Error cargando lexico.json"); }

// CONTEXTO DE CONVERSACIÓN
const contextos = {};
function obtenerContexto(sessionId) {
    if (!contextos[sessionId]) contextos[sessionId] = { ultimoServicio: null, historial: [] };
    return contextos[sessionId];
}
function actualizarContexto(sessionId, intencion, entidades) {
    const ctx = obtenerContexto(sessionId);
    if (entidades.servicio) ctx.ultimoServicio = entidades.servicio;
    ctx.historial.push({ intencion, entidades });
}

// MOTOR DE PLN
function normalizar(t) { return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.,!?;:]/g, "").trim(); }

function detectarIntencion(texto) {
    const t = normalizar(texto);
    for (const v of lexico.intenciones.saludo.variantes) if (t === v || t.startsWith(v + " ")) return "saludo";
    for (const v of lexico.intenciones.despedida.variantes) if (t === v || t.startsWith(v + " ")) return "despedida";
    for (const v of lexico.intenciones.confirmacion.variantes) if (t === v || t.startsWith(v + " ")) return "confirmacion";
    for (const v of lexico.intenciones.negacion.variantes) if (t === v || t.startsWith(v + " ")) return "negacion";
    for (const v of lexico.intenciones.agradecimiento.variantes) if (t.includes(v)) return "agradecimiento";
    for (const v of lexico.intenciones.cancelar.variantes) if (t.includes(v)) return "cancelar";
    for (const v of lexico.intenciones.reagendar.variantes) if (t.includes(v)) return "reagendar";
    for (const v of lexico.intenciones.agendar.variantes) if (t.includes(v)) return "agendar";
    for (const v of lexico.intenciones.consultar_precio.variantes) if (t.includes(v)) return "consultar_precio";
    for (const v of lexico.intenciones.consultar_duracion.variantes) if (t.includes(v)) return "consultar_duracion";
    for (const v of lexico.intenciones.consultar_requisitos.variantes) if (t.includes(v)) return "consultar_requisitos";
    for (const v of lexico.intenciones.consultar_servicio.variantes) if (t.includes(v)) return "consultar_servicio";
    return "desconocida";
}

function extraerEntidades(texto) {
    const t = normalizar(texto);
    const entidades = { servicio: null, sucursal: null, fecha: null };
    for (const [s, data] of Object.entries(lexico.servicios)) {
        for (const v of data.variantes) if (t.includes(v)) { entidades.servicio = s; break; }
        if (entidades.servicio) break;
    }
    // ... (lógica de fechas y sucursales igual)
    return entidades;
}

function detectarEmocion(texto) {
    const t = normalizar(texto);
    for (const [e, vs] of Object.entries(lexico.emociones)) {
        for (const v of vs) if (t.includes(v)) return e;
    }
    return null;
}

function generarRespuestaEstructurada(intencion, entidades, contexto = {}, emocion = null) {
    const elegir = (arr) => arr[Math.floor(Math.random() * arr.length)];
    if (!entidades.servicio && contexto.ultimoServicio) entidades.servicio = contexto.ultimoServicio;
    const servicio = entidades.servicio ? lexico.servicios[entidades.servicio] : null;
    const nombreServicio = servicio ? servicio.termino_estandar : null;
    
    let prefijo = "";
    if (emocion === "miedo") prefijo = "Entiendo tu preocupación, tranquila 💖. ";
    else if (emocion === "urgencia") prefijo = "¡Vamos rápido entonces! ⚡ ";
    else if (emocion === "frustracion") prefijo = "Lamento la confusión, déjame ayudarte mejor 🙏. ";
    else if (emocion === "entusiasmo") prefijo = "¡Me encanta tu energía! ✨ ";

    switch (intencion) {
        case "saludo": return elegir(["¡Hola! 💖 Soy Alma, tu asistente. ¿En qué te puedo ayudar hoy?", "¡Qué gusto saludarte! ✨ ¿Buscas algún tratamiento o quieres agendar?", "¡Hola linda! ¿En qué te puedo ayudar?"]);
        case "despedida": return elegir(["¡Gracias por escribirnos! 💖 Que tengas excelente día.", "¡Un gusto ayudarte! ✨ Aquí estaremos si necesitas algo más.", "¡Hasta pronto! No olvides que la primera consulta es gratuita. 😉"]);
        case "agradecimiento": return elegir(["¡De nada! 💖 Estoy aquí para lo que necesites.", "¡Con gusto! ✨ ¿Hay algo más en lo que te pueda ayudar?", "¡Un placer! 😊 Si tienes más dudas, aquí estoy."]);
        case "confirmacion": 
            if (nombreServicio) return `¡Perfecto! 💖 Para agendar tu cita de ${nombreServicio}, ve a la sección 'Agenda tu Cita'.`;
            return "¡Perfecto! 💖 ¿Te gustaría agendar una cita o tienes alguna otra duda?";
        case "negacion": return "Está bien 💖. Si cambias de opinión, aquí estaremos.";
        case "consultar_precio":
            if (servicio) return `${prefijo}El ${nombreServicio} tiene un precio de ${servicio.precio} y dura ${servicio.duracion} minutos ✨. ¿Te gustaría agendar una cita?`;
            return `${prefijo}Nuestros precios son:\n\n💉 Botox Facial - $3,200\n💖 Ácido Hialurónico - $4,500\n\n¿Sobre cuál quieres más información?`;
        case "consultar_servicio":
            if (servicio) return `${prefijo}${servicio.descripcion} Dura ${servicio.duracion} minutos, cuesta ${servicio.precio}. ¿Te gustaría más información o agendar una cita? ✨`;
            return `${prefijo}Contamos con varios tratamientos. ¿Sobre cuál te gustaría saber más?`;
        case "agendar":
            let msg = `${prefijo}¡Perfecto! 💖 `;
            if (servicio) msg += `Para tu cita de ${nombreServicio}, solo ve a la sección 'Agenda tu Cita'. `;
            else msg += `Para agendar solo ve a la sección 'Agenda tu Cita'. `;
            msg += "La primera consulta es gratis. ¿Te ayudo con algo más?";
            return msg;
        case "cancelar": return "Entiendo que quieras cancelar 💖. Ve a 'Mi Cuenta' → 'Mis Citas' y haz clic en 'Cancelar'.";
        case "reagendar": return "¡Claro que sí! 💖 Para cambiar tu cita, cancela la actual y agenda una nueva en 'Agenda tu Cita'.";
        default: return null;
    }
}

// =========================================================
// LLM (GEMINI)
// =========================================================
const MODELOS_DISPONIBLES = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
let genAI = null;
if (process.env.GEMINI_API_KEY) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function llamarLLM(mensaje, serviciosActuales = []) {
    if (!genAI) return null;
    const listaServicios = serviciosActuales.map(s => `- ${s.Nombre_servicio}: $${s.Precio} (${s.Duracion_estimada} min)`).join('\n');
    
    const systemInstruction = `Eres "Alma", la asistente virtual de Alma Estética.
    Personalidad: Cálida, amable, breve.
    Reglas: No repitas frases. Si el usuario ya dijo qué quiere, guíalo al siguiente paso.
    Servicios actuales:\n${listaServicios}
    Sucursales: Centro, Norte. Primera consulta gratis.`;

    for (const modelo of MODELOS_DISPONIBLES) {
        try {
            const model = genAI.getGenerativeModel({ model: modelo, systemInstruction });
            const result = await model.generateContent(mensaje);
            return result.response.text();
        } catch (err) { console.warn(`Modelo ${modelo} falló`); }
    }
    return null;
}

// =========================================================
// ENDPOINTS (API REST)
// =========================================================

// 1. Chatbot
app.post('/api/chat', async (req, res) => {
    const { mensaje, sessionId = "default" } = req.body;
    if (!mensaje) return res.status(400).json({ error: "Mensaje vacío" });

    db.query("SELECT Nombre_servicio, Precio, Duracion_estimada FROM servicios WHERE Estado = 'activo'", async (err, serviciosDB) => {
        const serviciosActuales = err ? [] : serviciosDB;
        
        const contexto = obtenerContexto(sessionId);
        const intencion = detectarIntencion(mensaje);
        const entidades = extraerEntidades(mensaje);
        const emocion = detectarEmocion(mensaje);
        actualizarContexto(sessionId, intencion, entidades);

        if (intencion !== "desconocida") {
            const respuestaBase = generarRespuestaEstructurada(intencion, entidades, contexto, emocion);
            if (respuestaBase) {
                const prompt = `Usuario: "${mensaje}". Intención: "${intencion}". Respuesta base: "${respuestaBase}". Reformúlala naturalmente (máx 3 oraciones).`;
                const respuestaLLM = await llamarLLM(prompt, serviciosActuales);
                if (respuestaLLM) return res.json({ respuesta: respuestaLLM });
                return res.json({ respuesta: respuestaBase });
            }
        }

        const respuestaLLM = await llamarLLM(mensaje, serviciosActuales);
        if (respuestaLLM) return res.json({ respuesta: respuestaLLM });
        return res.json({ respuesta: "Mmm, no entendí bien 🤔. ¿Podrías reformular tu pregunta?" });
    });
});

// 2. Obtener Servicios (Catálogo)
app.get('/api/servicios', (req, res) => {
    db.query("SELECT id_servicio, Nombre_servicio as nombre, Precio as precio, Duracion_estimada as duracion FROM servicios WHERE Estado = 'activo'", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const query = `
        SELECT l.id_usuario, l.email, l.password_hash, r.Ocupacion as rol, p.Nombre as nombre, p.id_persona
        FROM login l
        JOIN personas p ON l.id_persona = p.id_persona
        JOIN roles r ON l.id_rol = r.id_rol
        WHERE l.email = ?
    `;
    db.query(query, [email], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(401).json({ error: "Credenciales incorrectas" });
        
        const usuario = results[0];
        if (usuario.password_hash !== password) return res.status(401).json({ error: "Contraseña incorrecta" });

        res.json({ usuario, tiene_google_calendar: false });
    });
});

// 4. Registro
app.post('/api/registro', (req, res) => {
    const { nombre, apellido_paterno, apellido_materno, email, password, telefono, fecha_nacimiento } = req.body;
    
    db.query(`INSERT INTO personas (Nombre, Apellido_Paterno, Apellidos_Materno, Celular, Fecha_nacimiento) VALUES (?, ?, ?, ?, ?)`,
        [nombre, apellido_paterno, apellido_materno, telefono, fecha_nacimiento],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            const id_persona = result.insertId;

            db.query(`INSERT INTO login (id_persona, id_rol, email, password_hash) VALUES (?, 3, ?, ?)`,
                [id_persona, email, password],
                (err, resultLogin) => {
                    if (err) return res.status(500).json({ error: err.message });
                    const id_usuario = resultLogin.insertId;

                    db.query(`INSERT INTO cliente (id_usuario, id_persona) VALUES (?, ?)`, [id_usuario, id_persona], (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        
                        mailer.enviarCorreoBienvenida({ email, nombre }).catch(console.error);
                        res.json({ mensaje: "Cuenta creada", usuario: { id_usuario, nombre, email, rol: 'cliente' } });
                    });
                });
        });
});

// 5. Agendar Cita (Se guarda en la tabla citas)
app.post('/api/citas', (req, res) => {
    const { id_cliente, id_servicio, id_sucursal, id_empleado, fecha_cita } = req.body;
    
    // En este esquema, el depósito no está en la tabla citas, está en "pagos"
    db.query(`INSERT INTO citas (id_cliente, id_servicio, id_sucursal, id_empleado, Fecha_cita, Estado) VALUES (?, ?, ?, ?, ?, 'Pendiente')`,
        [id_cliente, id_servicio, id_sucursal, id_empleado, fecha_cita],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: "Cita agendada", id_cita: result.insertId });
        });
});

// 6. Historial de Citas Cliente (Haciendo JOIN)
app.get('/api/historial/:id_usuario', (req, res) => {
    const { id_usuario } = req.params;
    const query = `
        SELECT c.id_cita, c.Fecha_cita, c.Estado,
               s.Nombre_servicio as servicio_nombre, s.Precio as precio,
               p.Nombre as empleado_nombre
        FROM citas c
        JOIN cliente cl ON c.id_cliente = cl.id_cliente
        JOIN servicios s ON c.id_servicio = s.id_servicio
        JOIN empleados e ON c.id_empleado = e.id_empleado
        JOIN personas p ON e.id_persona = p.id_persona
        WHERE cl.id_usuario = ?
        ORDER BY c.Fecha_cita DESC
    `;
    db.query(query, [id_usuario], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 7. Mercado Pago (Crear Preferencia)
app.post('/api/pagos/crear-preferencia', async (req, res) => {
    const { id_cita, monto, nombre_servicio, email_cliente } = req.body;
    try {
        const preference = new Preference(mpClient);
        const body = {
            items: [{ id: String(id_cita), title: `Depósito - ${nombre_servicio}`, quantity: 1, unit_price: Number(monto), currency_id: 'MXN' }],
            payer: { email: email_cliente || 'cliente@almaestetica.com' },
            back_urls: { success: 'http://localhost:3000/?status=approved', failure: 'http://localhost:3000/pago-fallido' },
            external_reference: String(id_cita)
        };
        const result = await preference.create({ body });
        res.json({ init_point: result.init_point });
    } catch (error) {
        res.status(500).json({ error: "Error al crear el pago." });
    }
});

// 8. Obtener configuración (CMS)
app.get('/api/config', (req, res) => {
    // Como no tienes tabla configuracion en MySQL, lo dejamos vacío por ahora
    res.json({ hero_subtitulo: 'ESTÉTICA FACIAL', hero_titulo: 'Tu belleza', hero_descripcion: '...' });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📧 Servicio de correo activo.`);
});