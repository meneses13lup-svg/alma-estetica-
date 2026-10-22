const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// MERCADO PAGO - CLIENTE
// =========================================================
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
    options: { timeout: 5000 }
});

// =========================================================
// CONEXIÓN A SQLITE Y TABLAS
// =========================================================
const db = new sqlite3.Database('./salon.db', (err) => {
    if (err) console.error(err.message);
    else console.log('✅ Conectado a la base de datos SQLite.');
});

db.serialize(() => {
    // 1. Tabla Servicios
    db.run(`CREATE TABLE IF NOT EXISTS servicios (
        id_servicio INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        precio REAL NOT NULL,
        duracion INTEGER,
        status TEXT DEFAULT 'activo'
    )`);

    // 2. Tabla Usuarios
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        apellido_paterno TEXT NOT NULL,
        apellido_materno TEXT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        telefono TEXT NOT NULL,
        fecha_nacimiento TEXT NOT NULL,
        rol TEXT DEFAULT 'cliente',
        sucursal INTEGER,
        metodo_registro TEXT DEFAULT 'local',
        google_id TEXT,
        google_refresh_token TEXT,
        acepto_terminos INTEGER DEFAULT 1,
        fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
        activo INTEGER DEFAULT 1
    )`);

    // 3. Tabla Citas
    db.run(`CREATE TABLE IF NOT EXISTS citas (
        id_cita INTEGER PRIMARY KEY AUTOINCREMENT,
        id_cliente INTEGER,
        id_servicio INTEGER,
        id_sucursal INTEGER,
        id_empleado INTEGER,
        id_usuario INTEGER,
        fecha_cita TEXT,
        notas TEXT,
        precio_total REAL DEFAULT 0,
        deposito REAL DEFAULT 0,
        deposito_pagado INTEGER DEFAULT 0,
        metodo_pago TEXT,
        referencia_pago TEXT,
        status_pago TEXT DEFAULT 'pendiente',
        estado TEXT DEFAULT 'pendiente',
        recordatorio_enviado INTEGER DEFAULT NULL,
        fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(id_servicio) REFERENCES servicios(id_servicio),
        FOREIGN KEY(id_usuario) REFERENCES usuarios(id_usuario),
        FOREIGN KEY(id_empleado) REFERENCES usuarios(id_usuario)
    )`);

    // 4. Tabla Configuración (CMS para Esmeralda)
    db.run(`CREATE TABLE IF NOT EXISTS configuracion (
        clave TEXT PRIMARY KEY,
        valor TEXT
    )`);

    // Insertar datos de prueba iniciales
    db.get("SELECT COUNT(*) as count FROM servicios", (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO servicios (nombre, precio, duracion) VALUES 
                ('Botox Facial', 3200, 30),
                ('Ácido Hialurónico', 4500, 45),
                ('Bioestimulación', 2800, 60),
                ('Lifting de Cejas', 2200, 20),
                ('Mesoterapia', 1900, 45),
                ('Peeling Químico', 1500, 50)`);
            console.log('✅ Servicios insertados.');
        }
    });

    db.get("SELECT COUNT(*) as count FROM usuarios", (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO usuarios 
                (nombre, apellido_paterno, apellido_materno, email, password, telefono, fecha_nacimiento, rol, sucursal, metodo_registro) 
                VALUES 
                ('Esmeralda', 'Ruiz', 'Hernández', 'jefa@alma.com', '1234', '5511111111', '1985-03-15', 'admin', NULL, 'local'),
                ('Ana', 'López', 'García', 'empleado@alma.com', '1234', '5522222222', '1995-07-20', 'empleado', 1, 'local'),
                ('Carlos', 'Ruiz', 'Martínez', 'empleado2@alma.com', '1234', '5533333333', '1990-11-10', 'empleado', 2, 'local')`);
            console.log('✅ Usuarios de prueba insertados.');
        }
    });

    db.get("SELECT COUNT(*) as count FROM configuracion", (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO configuracion (clave, valor) VALUES 
                ('hero_subtitulo', 'ESTÉTICA FACIAL NO QUIRÚRGICA'),
                ('hero_titulo', 'Tu belleza<br><em>y juventud,</em><br>redefinidas.'),
                ('hero_descripcion', 'Especialistas en estética facial no quirúrgica. Botox, rejuvenecimiento, rellenos y más.')`);
            console.log('✅ Textos por defecto insertados.');
        }
    });
});

// =========================================================
// CARGAR LÉXICO (PLN)
// =========================================================
let lexico = {};
try {
    lexico = JSON.parse(fs.readFileSync(path.join(__dirname, 'lexico.json'), 'utf-8'));
    console.log('✅ Léxico cargado correctamente.');
} catch (err) {
    console.error('❌ Error cargando léxico:', err.message);
}

// =========================================================
// CONTEXTO DE CONVERSACIÓN
// =========================================================
const contextos = {};

function obtenerContexto(sessionId) {
    if (!contextos[sessionId]) {
        contextos[sessionId] = { ultimoServicio: null, ultimaIntencion: null, historial: [] };
    }
    return contextos[sessionId];
}

function actualizarContexto(sessionId, intencion, entidades) {
    const ctx = obtenerContexto(sessionId);
    if (entidades.servicio) ctx.ultimoServicio = entidades.servicio;
    ctx.ultimaIntencion = intencion;
    ctx.historial.push({ intencion, entidades, fecha: new Date().toISOString() });
    if (ctx.historial.length > 10) ctx.historial.shift();
}

// =========================================================
// MOTOR DE PLN
// =========================================================
function normalizar(texto) {
    return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.,!?;:]/g, "").trim();
}

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
    for (const [s, vs] of Object.entries(lexico.sucursales)) {
        for (const v of vs) if (t.includes(v)) { entidades.sucursal = s; break; }
        if (entidades.sucursal) break;
    }
    for (const [f, vs] of Object.entries(lexico.fechas)) {
        for (const v of vs) if (t.includes(v)) { entidades.fecha = f; break; }
        if (entidades.fecha) break;
    }
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
        case "saludo": 
            return elegir([
                "¡Hola! 💖 Soy Alma, tu asistente. ¿En qué te puedo ayudar hoy?", 
                "¡Qué gusto saludarte! ✨ ¿Buscas algún tratamiento o quieres agendar?", 
                "¡Hola linda! ¿En qué te puedo ayudar?"
            ]);
        case "despedida": 
            return elegir([
                "¡Gracias por escribirnos! 💖 Que tengas excelente día.", 
                "¡Un gusto ayudarte! ✨ Aquí estaremos si necesitas algo más.", 
                "¡Hasta pronto! No olvides que la primera consulta es gratuita. 😉"
            ]);
        case "agradecimiento": 
            return elegir([
                "¡De nada! 💖 Estoy aquí para lo que necesites.", 
                "¡Con gusto! ✨ ¿Hay algo más en lo que te pueda ayudar?", 
                "¡Un placer! 😊 Si tienes más dudas, aquí estoy."
            ]);
        case "confirmacion": 
            if (nombreServicio) {
                return elegir([
                    `¡Perfecto! 💖 Para agendar tu cita de ${nombreServicio}, ve a la sección 'Agenda tu Cita' aquí en la página.`,
                    `¡Genial! ✨ Solo entra a 'Agenda tu Cita', selecciona el día y hora para tu ${nombreServicio}, y listo.`,
                    `¡Claro que sí! 💆‍♀️ Ve a 'Agenda tu Cita' aquí arriba y agenda tu ${nombreServicio}. ¡La primera consulta es gratis!`
                ]);
            }
            return elegir([
                "¡Perfecto! 💖 ¿Te gustaría agendar una cita o tienes alguna otra duda?", 
                "¡Genial! ✨ ¿Quieres que te ayude con algo más?", 
                "¡Claro! ¿En qué más te puedo ayudar? 💆‍♀️"
            ]);
        case "negacion": 
            return elegir([
                "Está bien 💖. Si cambias de opinión, aquí estaremos.", 
                "¡Sin problema! ✨ Aquí estoy para cuando me necesites.", 
                "Entendido 😊. ¿Hay algo más en lo que pueda ayudarte?"
            ]);
        case "consultar_precio":
            if (servicio) {
                return elegir([
                    `${prefijo}El ${nombreServicio} tiene un precio de ${servicio.precio} y dura ${servicio.duracion} minutos ✨. ¿Te gustaría agendar una cita?`,
                    `${prefijo}Mira, el ${nombreServicio} cuesta ${servicio.precio}. Es una excelente opción. ¿Quieres más información o agendar?`
                ]);
            }
            return `${prefijo}Nuestros precios son:\n\n💉 Botox Facial - $3,200\n💖 Ácido Hialurónico - $4,500\n💆‍♀️ Bioestimulación - $2,800\n💄 Lifting de Cejas - $2,200\n✨ Mesoterapia - $1,900\n🧖‍♀️ Peeling Químico - $1,500\n\n¿Sobre cuál quieres más información?`;
        case "consultar_duracion":
            if (servicio) return `El ${nombreServicio} tiene una duración aproximada de ${servicio.duracion} minutos ⏱️. ¿Te gustaría agendar una cita?`;
            return "Cada tratamiento tiene una duración diferente. ¿Sobre cuál te gustaría saber? ✨";
        case "consultar_requisitos":
            if (servicio) return `Para el ${nombreServicio}, los requisitos son: ${servicio.requisitos} 📋. ¿Tienes alguna otra duda?`;
            return "En general, todos nuestros tratamientos requieren mayoría de edad. ¿Sobre cuál te gustaría saber los requisitos específicos? 💖";
        case "consultar_servicio":
            if (servicio) {
                return elegir([
                    `${prefijo}${servicio.descripcion} Dura ${servicio.duracion} minutos, cuesta ${servicio.precio} y ${servicio.efectos}. ¿Te gustaría más información o agendar una cita? ✨`,
                    `${prefijo}El ${nombreServicio} es ideal para ti. ${servicio.descripcion} ¿Quieres saber el precio o agendar tu consulta gratis?`
                ]);
            }
            return `${prefijo}Contamos con 6 tratamientos principales:\n\n💉 Botox Facial ($3,200, 30 min)\n💖 Ácido Hialurónico ($4,500, 45 min)\n💆‍♀️ Bioestimulación ($2,800, 60 min)\n💄 Lifting de Cejas ($2,200, 20 min)\n✨ Mesoterapia ($1,900, 45 min)\n🧖‍♀️ Peeling Químico ($1,500, 50 min)\n\n¿Sobre cuál te gustaría saber más?`;
        case "agendar":
            let msg = `${prefijo}¡Perfecto! 💖 `;
            if (servicio) msg += `Para tu cita de ${nombreServicio}, solo ve a la sección 'Agenda tu Cita' aquí en la página. `;
            else msg += `Para agendar solo ve a la sección 'Agenda tu Cita' aquí en la página. `;
            if (entidades.fecha) msg += `Anoté tu preferencia para el ${entidades.fecha}. `;
            msg += elegir([
                "La primera consulta es gratis. ¿Te ayudo con algo más?",
                "¡Recuerda que tu primera consulta no tiene costo! ¿Hay algo más que quieras saber?",
                "Ahí mismo puedes elegir el día y la hora que mejor te acomode. 😉"
            ]);
            return msg;
        case "cancelar": 
            return "Entiendo que quieras cancelar 💖. Ve a 'Mi Cuenta' → 'Mis Citas' y haz clic en 'Cancelar'.";
        case "reagendar": 
            return "¡Claro que sí! 💖 Para cambiar tu cita, cancela la actual en 'Mi Cuenta' y agenda una nueva en 'Agenda tu Cita'.";
        default: 
            return null;
    }
}

// =========================================================
// CONFIGURACIÓN DEL LLM (Con reglas para no ser repetitivo)
// =========================================================
const MODELOS_DISPONIBLES = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
let genAI = null;
if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('✅ Cliente de Gemini configurado.');
} else {
    console.warn('⚠️  No hay GEMINI_API_KEY.');
}

async function llamarLLM(mensaje) {
    if (!genAI) return null;
    
    const systemInstruction = `Eres "Alma", la asistente virtual de Alma Estética, un salón de belleza especializado en estética facial no quirúrgica.
    
    Tu personalidad:
    - Cálida, amable y muy humana. Como una recepcionista amigable.
    - Usa lenguaje natural, nada robótico.
    - Emojis ocasionales (💆‍♀️, ✨, 💖).
    - Respuestas BREVES (máximo 3 oraciones).
    
    Reglas estrictas:
    1. NUNCA repitas la misma frase dos veces en la misma conversación.
    2. Si el usuario ya expresó que quiere agendar, NO le vuelvas a preguntar qué servicio quiere si ya lo dijo antes.
    3. Si el usuario te da una respuesta corta (ej. "si", "ok", "claro"), NO repitas toda la información, solo guíalo al siguiente paso.
    4. Si ya le dijiste que vaya a la sección "Agenda tu Cita", en la siguiente interacción solo recuérdale brevemente o despídete amablemente.
    
    Información del negocio:
    - Servicios: Botox ($3,200), Ácido Hialurónico ($4,500), Bioestimulación ($2,800), Lifting ($2,200), Mesoterapia ($1,900), Peeling ($1,500).
    - Sucursales: Centro, Norte y Sur.
    - Primera consulta gratuita.
    - Botox requiere mayoría de edad.
    
    Responde SIEMPRE en español.`;

    for (const modelo of MODELOS_DISPONIBLES) {
        try {
            const model = genAI.getGenerativeModel({ model: modelo, systemInstruction });
            const result = await model.generateContent(mensaje);
            return result.response.text();
        } catch (err) {
            console.warn(`⚠️  Modelo ${modelo} falló: ${err.message.substring(0, 80)}...`);
        }
    }
    return null;
}

// =========================================================
// ENDPOINTS: CHATBOT
// =========================================================
app.post('/api/chat', async (req, res) => {
    const { mensaje, sessionId = "default" } = req.body;
    if (!mensaje || mensaje.trim() === '') return res.status(400).json({ error: "El mensaje no puede estar vacío." });

    const contexto = obtenerContexto(sessionId);
    const intencion = detectarIntencion(mensaje);
    const entidades = extraerEntidades(mensaje);
    const emocion = detectarEmocion(mensaje);
    actualizarContexto(sessionId, intencion, entidades);

    if (intencion !== "desconocida") {
        const respuestaBase = generarRespuestaEstructurada(intencion, entidades, contexto, emocion);
        if (respuestaBase) {
            const prompt = `Usuario: "${mensaje}". Intención: "${intencion}". Entidades: ${JSON.stringify(entidades)}. Respuesta base: "${respuestaBase}". Reformúlala de forma más natural y cálida, manteniendo la misma información. Máximo 3 oraciones.`;
            const respuestaLLM = await llamarLLM(prompt);
            if (respuestaLLM) return res.json({ respuesta: respuestaLLM, _debug: { fuente: "PLN + LLM", intencion, entidades } });
            return res.json({ respuesta: respuestaBase, _debug: { fuente: "PLN", intencion, entidades } });
        }
    }

    const respuestaLLM = await llamarLLM(mensaje);
    if (respuestaLLM) return res.json({ respuesta: respuestaLLM, _debug: { fuente: "LLM (fallback)" } });
    return res.json({ respuesta: "Mmm, no entendí bien 🤔. ¿Podrías reformular tu pregunta?", _debug: { fuente: "sin LLM" } });
});

// =========================================================
// ENDPOINTS: SERVICIOS Y SUCURSALES
// =========================================================
app.get('/api/servicios', (req, res) => {
    db.all("SELECT * FROM servicios WHERE status = 'activo'", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/sucursales', (req, res) => {
    res.json([
        { id: 1, nombre: "Sucursal Centro" },
        { id: 2, nombre: "Sucursal Norte" },
        { id: 3, nombre: "Sucursal Sur" }
    ]);
});

app.get('/api/especialistas/:id_sucursal', (req, res) => {
    const { id_sucursal } = req.params;
    db.all(`SELECT id_usuario, nombre, apellido_paterno, apellido_materno, sucursal FROM usuarios WHERE rol = 'empleado' AND sucursal = ? AND activo = 1`,
        [id_sucursal], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
});

// =========================================================
// ENDPOINTS: DISPONIBILIDAD
// =========================================================
app.get('/api/disponibilidad/:fecha', (req, res) => {
    const { fecha } = req.params;
    const { id_sucursal } = req.query;

    let queryEmp = `SELECT id_usuario, nombre, apellido_paterno, sucursal FROM usuarios WHERE rol = 'empleado' AND activo = 1`;
    const params = [];
    if (id_sucursal) { queryEmp += ` AND sucursal = ?`; params.push(id_sucursal); }

    db.all(queryEmp, params, (err, especialistas) => {
        if (err) return res.status(500).json({ error: err.message });

        const promesas = especialistas.map(emp => {
            return new Promise((resolve) => {
                db.all(`SELECT fecha_cita FROM citas WHERE id_empleado = ? AND DATE(fecha_cita) = ? AND estado != 'cancelada'`,
                    [emp.id_usuario, fecha], (err, citas) => {
                        const ocupados = citas.map(c => c.fecha_cita.split(' ')[1]);
                        resolve({ ...emp, horarios_ocupados: ocupados });
                    });
            });
        });

        Promise.all(promesas).then(resultado => {
            res.json({ fecha, especialistas: resultado });
        });
    });
});

app.get('/api/disponibilidad/mes/:anio/:mes', (req, res) => {
    const { anio, mes } = req.params;
    const { id_sucursal } = req.query;

    let query = `SELECT DATE(fecha_cita) as dia, COUNT(*) as total FROM citas WHERE strftime('%Y', fecha_cita) = ? AND strftime('%m', fecha_cita) = ? AND estado != 'cancelada'`;
    const params = [anio, mes.padStart(2, '0')];
    if (id_sucursal) { query += ` AND id_sucursal = ?`; params.push(id_sucursal); }
    query += ` GROUP BY dia`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const disponibilidad = {};
        rows.forEach(r => { disponibilidad[r.dia] = r.total; });
        res.json({ disponibilidad });
    });
});

// =========================================================
// ENDPOINT: REGISTRO
// =========================================================
app.post('/api/registro', (req, res) => {
    const { nombre, apellido_paterno, apellido_materno, email, password, telefono, fecha_nacimiento, metodo_registro, acepto_terminos } = req.body;
    const errores = [];

    if (!nombre || nombre.trim().length < 2) errores.push("El nombre es obligatorio (mínimo 2 caracteres).");
    if (!apellido_paterno || apellido_paterno.trim().length < 2) errores.push("El apellido paterno es obligatorio.");
    if (!email || !email.trim()) errores.push("El correo electrónico es obligatorio.");
    if (!telefono || !telefono.trim()) errores.push("El teléfono es obligatorio.");
    if (!fecha_nacimiento) errores.push("La fecha de nacimiento es obligatoria.");
    if (!password || password.length < 6) errores.push("La contraseña debe tener al menos 6 caracteres.");
    if (!acepto_terminos) errores.push("Debes aceptar los Términos y Condiciones.");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) errores.push("El correo electrónico no es válido.");

    const telefonoLimpio = (telefono || "").replace(/\D/g, "");
    if (telefonoLimpio.length < 10) errores.push("El teléfono debe tener al menos 10 dígitos.");

    if (fecha_nacimiento) {
        const nacimiento = new Date(fecha_nacimiento);
        const hoy = new Date();
        let edad = hoy.getFullYear() - nacimiento.getFullYear();
        const mes = hoy.getMonth() - nacimiento.getMonth();
        if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
        if (edad < 18) errores.push("Debes ser mayor de edad para registrarte.");
    }

    if (errores.length > 0) return res.status(400).json({ errores });

    db.get("SELECT id_usuario FROM usuarios WHERE email = ?", [email], (err, existente) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existente) return res.status(409).json({ error: "Este correo ya está registrado. ¿Quieres iniciar sesión?" });

        db.run(`INSERT INTO usuarios (nombre, apellido_paterno, apellido_materno, email, password, telefono, fecha_nacimiento, rol, metodo_registro, acepto_terminos) VALUES (?, ?, ?, ?, ?, ?, ?, 'cliente', ?, 1)`,
            [nombre, apellido_paterno, apellido_materno || "", email, password, telefono, fecha_nacimiento, metodo_registro || 'local'],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                db.get("SELECT id_usuario, nombre, apellido_paterno, email, rol, telefono, fecha_nacimiento FROM usuarios WHERE id_usuario = ?",
                    [this.lastID], (err, nuevo) => {
                        if (err) return res.status(500).json({ error: err.message });

                        mailer.enviarCorreoBienvenida(nuevo)
                            .catch(err => console.error('Error enviando correo:', err));

                        res.json({ mensaje: "Cuenta creada exitosamente", usuario: nuevo });
                    });
            });
    });
});

// =========================================================
// ENDPOINT: LOGIN (Con validación de Google Calendar)
// =========================================================
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM usuarios WHERE email = ? AND password = ?", [email, password], (err, usuario) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!usuario) return res.status(401).json({ error: "Credenciales incorrectas" });
        
        const tiene_google_calendar = !!usuario.google_refresh_token;
        const { password: _, google_refresh_token: __, ...resto } = usuario;
        
        res.json({ 
            usuario: resto,
            tiene_google_calendar: tiene_google_calendar 
        });
    });
});

app.post('/api/login-google', (req, res) => {
    const { email, nombre, google_id } = req.body;
    if (!email) return res.status(400).json({ error: "Se requiere el email de Google." });

    db.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, usuario) => {
        if (err) return res.status(500).json({ error: err.message });
        if (usuario) {
            const { password: _, google_refresh_token: __, ...resto } = usuario;
            return res.json({ 
                mensaje: "Sesión iniciada con Google", 
                usuario: resto, 
                esNuevo: false,
                tiene_google_calendar: !!usuario.google_refresh_token
            });
        }
        const partes = (nombre || "Usuario Google").split(" ");
        db.run(`INSERT INTO usuarios (nombre, apellido_paterno, email, password, telefono, fecha_nacimiento, rol, metodo_registro, google_id) VALUES (?, ?, ?, ?, ?, ?, 'cliente', 'google', ?)`,
            [partes[0] || "Usuario", partes[1] || "Google", email, 'google_auth_' + Date.now(), '0000000000', '2000-01-01', google_id || 'google_' + Date.now()],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                db.get("SELECT id_usuario, nombre, apellido_paterno, email, rol FROM usuarios WHERE id_usuario = ?",
                    [this.lastID], (err, nuevo) => {
                        if (err) return res.status(500).json({ error: err.message });

                        mailer.enviarCorreoBienvenida(nuevo)
                            .catch(err => console.error('Error enviando correo:', err));

                        res.json({ 
                            mensaje: "Cuenta creada con Google", 
                            usuario: nuevo, 
                            esNuevo: true,
                            tiene_google_calendar: false
                        });
                    });
            });
    });
});

// =========================================================
// ENDPOINT: AGENDAR CITA
// =========================================================
app.post('/api/citas', (req, res) => {
    const { id_cliente, id_servicio, id_sucursal, id_empleado, id_usuario, fecha_cita, edad_cliente, notas } = req.body;

    if (id_servicio === 1 && edad_cliente < 18) {
        return res.status(400).json({ error: "Lo siento, para Botox se requiere ser mayor de edad." });
    }

    db.get(`SELECT precio FROM servicios WHERE id_servicio = ?`, [id_servicio], (err, servicio) => {
        if (err || !servicio) return res.status(400).json({ error: "Servicio no encontrado." });

        const precioTotal = servicio.precio;
        const deposito = Math.round(precioTotal * 0.20);

        db.run(`INSERT INTO citas (id_cliente, id_servicio, id_sucursal, id_empleado, id_usuario, fecha_cita, notas, precio_total, deposito) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id_cliente, id_servicio, id_sucursal, id_empleado || null, id_usuario, fecha_cita, notas || null, precioTotal, deposito],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                const idCita = this.lastID;

                // Google Calendar
                db.get(`SELECT * FROM usuarios WHERE id_usuario = ?`, [id_usuario], (err, usuario) => {
                    if (err || !usuario || !usuario.google_refresh_token) return;
                    db.get(`SELECT * FROM servicios WHERE id_servicio = ?`, [id_servicio], (err, servicio) => {
                        if (err || !servicio) return;
                        const getEmp = id_empleado
                            ? new Promise((resolve) => db.get(`SELECT * FROM usuarios WHERE id_usuario = ?`, [id_empleado], (err, e) => resolve(e || { nombre: 'Por asignar', apellido_paterno: '' })))
                            : Promise.resolve({ nombre: 'Por asignar', apellido_paterno: '' });
                        getEmp.then(empleado => {
                            googleAuth.crearEventoCalendar(usuario.google_refresh_token, { id_sucursal, fecha_cita }, servicio, empleado)
                                .catch(err => console.error('Error Calendar:', err));
                        });
                    });
                });

                // Correo de Cita
                db.get(`
                    SELECT c.*, s.nombre as servicio_nombre, s.duracion, s.precio,
                           u.email, u.nombre as cliente_nombre,
                           e.nombre as empleado_nombre, e.apellido_paterno as empleado_apellido
                    FROM citas c
                    LEFT JOIN servicios s ON c.id_servicio = s.id_servicio
                    LEFT JOIN usuarios u ON c.id_usuario = u.id_usuario
                    LEFT JOIN usuarios e ON c.id_empleado = e.id_usuario
                    WHERE c.id_cita = ?
                `, [idCita], (err, citaCompleta) => {
                    if (!err && citaCompleta && citaCompleta.email) {
                        mailer.enviarCorreoCitaConfirmada(
                            { nombre: citaCompleta.cliente_nombre, email: citaCompleta.email },
                            citaCompleta,
                            { nombre: citaCompleta.servicio_nombre, duracion: citaCompleta.duracion },
                            { nombre: citaCompleta.empleado_nombre || 'Por asignar', apellido_paterno: citaCompleta.empleado_apellido || '' }
                        ).catch(err => console.error('Error enviando correo de cita:', err));
                    }
                });

                res.json({ 
                    mensaje: "Cita creada exitosamente", 
                    id_cita: idCita,
                    precio_total: precioTotal,
                    deposito: deposito,
                    deposito_pagado: 0,
                    status_pago: "pendiente"
                });
            }
        );
    });
});

// =========================================================
// ENDPOINTS: MERCADO PAGO
// =========================================================
app.post('/api/pagos/crear-preferencia', async (req, res) => {
    const { id_cita, monto, nombre_servicio, email_cliente } = req.body;

    if (!id_cita || !monto) {
        return res.status(400).json({ error: "Faltan datos para el pago." });
    }

    try {
        const preference = new Preference(mpClient);
        const body = {
            items: [{
                id: String(id_cita),
                title: `Depósito 20% - ${nombre_servicio}`,
                quantity: 1,
                unit_price: Number(monto),
                currency_id: 'MXN'
            }],
            payer: { email: email_cliente || 'cliente@almaestetica.com' },
            back_urls: {
                success: 'http://localhost:3000/?status=approved',
                failure: 'http://localhost:3000/pago-fallido',
                pending: 'http://localhost:3000/pago-pendiente'
            },
            external_reference: String(id_cita),
            statement_descriptor: 'ALMA ESTETICA'
        };

        const result = await preference.create({ body });
        console.log('✅ Preferencia creada:', result.id);

        res.json({
            id: result.id,
            init_point: result.init_point,
            sandbox_init_point: result.sandbox_init_point
        });

    } catch (error) {
        console.error('❌ Error creando preferencia:', error);
        res.status(500).json({ error: "Error al crear el pago." });
    }
});

app.post('/api/pagos/confirmar', (req, res) => {
    const { id_cita, payment_id, metodo_pago } = req.body;

    if (!id_cita) return res.status(400).json({ error: "Falta el ID de la cita." });

    db.run(`UPDATE citas SET 
        deposito_pagado = 1, 
        metodo_pago = ?, 
        referencia_pago = ?,
        status_pago = 'deposito_pagado'
        WHERE id_cita = ?`,
        [metodo_pago || 'mercadopago', payment_id || 'MP-' + Date.now(), id_cita],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });

            db.get(`
                SELECT c.*, s.nombre as servicio_nombre, u.email, u.nombre as cliente_nombre
                FROM citas c
                LEFT JOIN servicios s ON c.id_servicio = s.id_servicio
                LEFT JOIN usuarios u ON c.id_usuario = u.id_usuario
                WHERE c.id_cita = ?
            `, [id_cita], (err, cita) => {
                if (!err && cita && cita.email) {
                    mailer.enviarCorreoPagoExitoso(
                        { nombre: cita.cliente_nombre, email: cita.email },
                        cita,
                        cita.deposito
                    ).catch(err => console.error('Error enviando correo de pago:', err));
                }
            });

            res.json({ 
                mensaje: "Pago confirmado exitosamente",
                id_cita,
                cambios: this.changes
            });
        }
    );
});

app.get('/pago-exitoso', (req, res) => {
    res.send(`<html><head><title>Pago exitoso</title></head><body style="font-family: Arial; text-align: center; padding: 50px; background: #f9f9f9;"><div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px;"><div style="font-size: 60px;">✅</div><h1>¡Pago exitoso!</h1><p>Tu depósito ha sido registrado.</p><a href="http://localhost:3000" style="display: inline-block; background: #000; color: white; padding: 14px 32px; text-decoration: none; border-radius: 4px; margin-top: 20px;">Volver</a></div></body></html>`);
});

app.get('/pago-fallido', (req, res) => {
    res.send(`<html><head><title>Pago fallido</title></head><body style="font-family: Arial; text-align: center; padding: 50px; background: #f9f9f9;"><div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px;"><div style="font-size: 60px;">❌</div><h1>Pago no completado</h1><a href="http://localhost:3000">Intentar de nuevo</a></div></body></html>`);
});

app.get('/pago-pendiente', (req, res) => {
    res.send(`<html><head><title>Pago pendiente</title></head><body style="font-family: Arial; text-align: center; padding: 50px; background: #f9f9f9;"><div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px;"><div style="font-size: 60px;">⏳</div><h1>Pago pendiente</h1><a href="http://localhost:3000">Volver</a></div></body></html>`);
});

// =========================================================
// ENDPOINTS: HISTORIAL Y CANCELAR
// =========================================================
app.get('/api/historial/:id_usuario', (req, res) => {
    const { id_usuario } = req.params;
    db.all(`
        SELECT c.id_cita, c.fecha_cita, c.fecha_creacion, c.status_pago, c.estado, c.notas,
               c.precio_total, c.deposito, c.deposito_pagado, c.metodo_pago,
               s.nombre as servicio_nombre, s.precio, s.duracion, c.id_sucursal, c.id_empleado,
               u.nombre || ' ' || u.apellido_paterno as empleado_nombre
        FROM citas c
        LEFT JOIN servicios s ON c.id_servicio = s.id_servicio
        LEFT JOIN usuarios u ON c.id_empleado = u.id_usuario
        WHERE c.id_cliente = ? OR c.id_usuario = ?
        ORDER BY c.fecha_cita DESC
    `, [id_usuario, id_usuario], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.delete('/api/citas/:id_cita', (req, res) => {
    const { id_cita } = req.params;
    db.run(`UPDATE citas SET estado = 'cancelada' WHERE id_cita = ?`, [id_cita], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: "Cita cancelada", cambios: this.changes });
    });
});

// =========================================================
// ENDPOINTS: DASHBOARDS
// =========================================================
app.get('/api/dashboard/empleado/:id_usuario', (req, res) => {
    const idUsuario = req.params.id_usuario;
    db.get("SELECT * FROM usuarios WHERE id_usuario = ?", [idUsuario], (err, usuario) => {
        if (err || !usuario) return res.status(403).json({ error: "No autorizado" });
        db.all(`SELECT c.*, s.nombre as servicio_nombre, s.precio FROM citas c LEFT JOIN servicios s ON c.id_servicio = s.id_servicio WHERE c.id_sucursal = ? ORDER BY c.fecha_cita DESC`,
            [usuario.sucursal], (err, citas) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ empleado: usuario.nombre, sucursal: usuario.sucursal, citas });
            });
    });
});

app.get('/api/dashboard/admin', (req, res) => {
    db.get(`SELECT COUNT(*) as total_citas, SUM(CASE WHEN status_pago = 'pendiente' THEN 1 ELSE 0 END) as pendientes, SUM(CASE WHEN status_pago = 'deposito_pagado' THEN 1 ELSE 0 END) as pagadas FROM citas`, [], (err, stats) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all(`SELECT c.id_sucursal, COUNT(*) as total_citas, SUM(s.precio) as ingresos_totales FROM citas c LEFT JOIN servicios s ON c.id_servicio = s.id_servicio GROUP BY c.id_sucursal`, [], (err, porSucursal) => {
            if (err) return res.status(500).json({ error: err.message });
            db.all(`SELECT c.*, s.nombre as servicio_nombre, s.precio FROM citas c LEFT JOIN servicios s ON c.id_servicio = s.id_servicio ORDER BY c.fecha_cita DESC LIMIT 50`, [], (err, citas) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ estadisticas: stats, por_sucursal: porSucursal, citas });
            });
        });
    });
});

// =========================================================
// ENDPOINTS DE ADMINISTRACIÓN (CMS)
// =========================================================
app.get('/api/config', (req, res) => {
    db.all("SELECT clave, valor FROM configuracion", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const config = {};
        rows.forEach(r => { config[r.clave] = r.valor; });
        res.json(config);
    });
});

app.put('/api/admin/config', (req, res) => {
    const { id_usuario, config } = req.body;
    db.get("SELECT rol FROM usuarios WHERE id_usuario = ?", [id_usuario], (err, user) => {
        if (err || !user || user.rol !== 'admin') return res.status(403).json({ error: "No autorizado" });

        const promesas = Object.entries(config).map(([clave, valor]) => {
            return new Promise((resolve) => {
                db.run(`INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)`, [clave, valor], resolve);
            });
        });

        Promise.all(promesas).then(() => {
            res.json({ mensaje: "Textos actualizados exitosamente" });
        });
    });
});

app.post('/api/admin/servicios', (req, res) => {
    const { id_usuario, nombre, precio, duracion } = req.body;
    db.get("SELECT rol FROM usuarios WHERE id_usuario = ?", [id_usuario], (err, user) => {
        if (err || !user || user.rol !== 'admin') return res.status(403).json({ error: "No autorizado" });
        
        db.run(`INSERT INTO servicios (nombre, precio, duracion) VALUES (?, ?, ?)`,
            [nombre, precio, duracion], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ mensaje: "Servicio agregado", id_servicio: this.lastID });
            });
    });
});

app.put('/api/admin/servicios/:id', (req, res) => {
    const { id_usuario, nombre, precio, duracion, status } = req.body;
    const { id } = req.params;
    db.get("SELECT rol FROM usuarios WHERE id_usuario = ?", [id_usuario], (err, user) => {
        if (err || !user || user.rol !== 'admin') return res.status(403).json({ error: "No autorizado" });

        db.run(`UPDATE servicios SET nombre = COALESCE(?, nombre), precio = COALESCE(?, precio), duracion = COALESCE(?, duracion), status = COALESCE(?, status) WHERE id_servicio = ?`,
            [nombre, precio, duracion, status, id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ mensaje: "Servicio actualizado" });
            });
    });
});

app.delete('/api/admin/servicios/:id', (req, res) => {
    const { id_usuario } = req.body;
    const { id } = req.params;
    db.get("SELECT rol FROM usuarios WHERE id_usuario = ?", [id_usuario], (err, user) => {
        if (err || !user || user.rol !== 'admin') return res.status(403).json({ error: "No autorizado" });

        db.run(`UPDATE servicios SET status = 'inactivo' WHERE id_servicio = ?`, [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: "Servicio eliminado" });
        });
    });
});

// =========================================================
// GOOGLE OAUTH
// =========================================================
app.get('/api/auth/google', (req, res) => {
    const idUsuario = req.query.id_usuario || '';
    const url = googleAuth.generarUrlAutorizacion(idUsuario);
    res.json({ url });
});

app.get('/oauth2callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('No se recibió código.');
    try {
        const tokens = await googleAuth.obtenerTokens(code);
        const idUsuario = state || 1;
        db.run(`UPDATE usuarios SET google_refresh_token = ? WHERE id_usuario = ?`,
            [tokens.refresh_token, idUsuario], function(err) {
                if (err) return res.status(500).send('Error guardando token.');
                res.send(`
                    <html>
                        <head><meta charset="UTF-8"><title>Éxito</title></head>
                        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f9f9f9;">
                            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                                <div style="font-size: 60px; margin-bottom: 20px;">✅</div>
                                <h1 style="color: #000; margin-bottom: 10px;">¡Cuenta vinculada!</h1>
                                <p style="color: #666; margin-bottom: 30px;">Tus citas ahora aparecerán en tu Google Calendar.</p>
                                <a href="/" style="display: inline-block; background: #000; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600;">Volver a Alma Estética</a>
                            </div>
                            <script>
                                // Redirigir automáticamente después de 2.5 segundos
                                setTimeout(() => { window.location.href = '/'; }, 2500);
                            </script>
                        </body>
                    </html>
                `);
            });
    } catch (err) {
        console.error('Error OAuth:', err);
        res.status(500).send('Error al vincular.');
    }
});

// =========================================================
// INICIAR SERVIDOR
// =========================================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor Backend corriendo en http://localhost:${PORT}`);
    console.log(`💳 Mercado Pago configurado.`);
    console.log(`📧 Servicio de correo activo.`);
});