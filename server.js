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
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// =========================================================
// MERCADO PAGO (Con tu URL de ngrok)
// =========================================================
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
    options: { timeout: 5000 }
});

// =========================================================
// CONEXIÓN A MYSQL
// =========================================================
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', // Vacío para XAMPP
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
        case "saludo": return elegir(["¡Hola! 💖 Soy Alma, tu asistente. ¿En qué te puedo ayudar hoy?", "¡Qué gusto saludarte! ✨ ¿Buscas algún tratamiento o quieres agendar?", "¡Hola linda! ¿En qué te puedo ayudar?"]);
        case "despedida": return elegir(["¡Gracias por escribirnos! 💖 Que tengas excelente día.", "¡Un gusto ayudarte! ✨ Aquí estaremos si necesitas algo más.", "¡Hasta pronto! No olvides que la primera consulta es gratuita. 😉"]);
        case "agradecimiento": return elegir(["¡De nada! 💖 Estoy aquí para lo que necesites.", "¡Con gusto! ✨ ¿Hay algo más en lo que te pueda ayudar?", "¡Un placer! 😊 Si tienes más dudas, aquí estoy."]);
        case "confirmacion": 
            if (nombreServicio) return `¡Perfecto! 💖 Para agendar tu cita de ${nombreServicio}, ve a la sección 'Agenda tu Cita' aquí en la página.`;
            return "¡Perfecto! 💖 ¿Te gustaría agendar una cita o tienes alguna otra duda?";
        case "negacion": return "Está bien 💖. Si cambias de opinión, aquí estaremos.";
        case "consultar_precio":
            if (servicio) return `${prefijo}El ${nombreServicio} tiene un precio de ${servicio.precio} y dura ${servicio.duracion} minutos ✨. ¿Te gustaría agendar una cita?`;
            return `${prefijo}Nuestros precios son:\n\n💉 Botox Facial - $3,200\n💖 Ácido Hialurónico - $4,500\n💆‍♀️ Bioestimulación - $2,800\n💄 Lifting de Cejas - $2,200\n✨ Mesoterapia - $1,900\n🧖‍♀️ Peeling Químico - $1,500\n\n¿Sobre cuál quieres más información?`;
        case "consultar_duracion":
            if (servicio) return `El ${nombreServicio} tiene una duración aproximada de ${servicio.duracion} minutos ⏱️. ¿Te gustaría agendar una cita?`;
            return "Cada tratamiento tiene una duración diferente. ¿Sobre cuál te gustaría saber? ✨";
        case "consultar_requisitos":
            if (servicio) return `Para el ${nombreServicio}, los requisitos son: ${servicio.requisitos} 📋. ¿Tienes alguna otra duda?`;
            return "En general, todos nuestros tratamientos requieren mayoría de edad. ¿Sobre cuál te gustaría saber los requisitos específicos? 💖";
        case "consultar_servicio":
            if (servicio) return `${prefijo}${servicio.descripcion} Dura ${servicio.duracion} minutos, cuesta ${servicio.precio} y ${servicio.efectos}. ¿Te gustaría más información o agendar una cita? ✨`;
            return `${prefijo}Contamos con 6 tratamientos principales:\n\n💉 Botox Facial ($3,200, 30 min)\n💖 Ácido Hialurónico ($4,500, 45 min)\n💆‍♀️ Bioestimulación ($2,800, 60 min)\n💄 Lifting de Cejas ($2,200, 20 min)\n✨ Mesoterapia ($1,900, 45 min)\n🧖‍♀️ Peeling Químico ($1,500, 50 min)\n\n¿Sobre cuál te gustaría saber más?`;
        case "agendar":
            let msg = `${prefijo}¡Perfecto! 💖 `;
            if (servicio) msg += `Para tu cita de ${nombreServicio}, solo ve a la sección 'Agenda tu Cita' aquí en la página. `;
            else msg += `Para agendar solo ve a la sección 'Agenda tu Cita' aquí en la página. `;
            if (entidades.fecha) msg += `Anoté tu preferencia para el ${entidades.fecha}. `;
            msg += "La primera consulta es gratis. ¿Te ayudo con algo más?";
            return msg;
        case "cancelar": return "Entiendo que quieras cancelar 💖. Ve a 'Mi Cuenta' → 'Mis Citas' y haz clic en 'Cancelar'.";
        case "reagendar": return "¡Claro que sí! 💖 Para cambiar tu cita, cancela la actual en 'Mi Cuenta' y agenda una nueva en 'Agenda tu Cita'.";
        default: return null;
    }
}

// =========================================================
// LLM (GEMINI)
// =========================================================
const MODELOS_DISPONIBLES = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
let genAI = null;
if (process.env.GEMINI_API_KEY) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function llamarLLM(mensaje) {
    if (!genAI) return null;
    const systemInstruction = `Eres "Alma", la asistente virtual de Alma Estética. 
    Personalidad: Cálida, amable y muy humana. Respuestas BREVES (máx 3 oraciones).
    Servicios: Botox, Ácido Hialurónico, Bioestimulación. Primera consulta gratis.
    Responde SIEMPRE en español.`;

    for (const modelo of MODELOS_DISPONIBLES) {
        try {
            const model = genAI.getGenerativeModel({ model: modelo, systemInstruction });
            const result = await model.generateContent(mensaje);
            return result.response.text();
        } catch (err) { console.warn(`⚠️ Modelo ${modelo} falló`); }
    }
    return null;
}

// =========================================================
// ENDPOINTS: CHATBOT
// =========================================================
app.post('/api/chat', async (req, res) => {
    const { mensaje, sessionId = "default" } = req.body;
    if (!mensaje || mensaje.trim() === '') return res.status(400).json({ error: "Mensaje vacío" });

    const contexto = obtenerContexto(sessionId);
    const intencion = detectarIntencion(mensaje);
    const entidades = extraerEntidades(mensaje);
    const emocion = detectarEmocion(mensaje);
    actualizarContexto(sessionId, intencion, entidades);

    if (intencion !== "desconocida") {
        const respuestaBase = generarRespuestaEstructurada(intencion, entidades, contexto, emocion);
        if (respuestaBase) {
            const prompt = `Usuario: "${mensaje}". Respuesta base: "${respuestaBase}". Reformúlala naturalmente (máx 3 oraciones).`;
            const respuestaLLM = await llamarLLM(prompt);
            return res.json({ respuesta: respuestaLLM || respuestaBase });
        }
    }
    const respuestaLLM = await llamarLLM(mensaje);
    return res.json({ respuesta: respuestaLLM || "Mmm, no entendí bien 🤔. ¿Podrías reformular?" });
});

// =========================================================
// ENDPOINTS: SERVICIOS Y DISPONIBILIDAD
// =========================================================
app.get('/api/servicios', (req, res) => {
    db.query("SELECT id_servicio, Nombre_servicio as nombre, Precio as precio, Duracion_estimada as duracion FROM servicios WHERE Estado = 'activo'", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/disponibilidad/mes/:anio/:mes', (req, res) => {
    const { anio, mes } = req.params;
    const { id_sucursal } = req.query;

    let query = `SELECT DATE_FORMAT(Fecha_cita, '%Y-%m-%d') as dia, COUNT(*) as total 
                 FROM citas WHERE YEAR(Fecha_cita) = ? AND MONTH(Fecha_cita) = ? AND Estado != 'Cancelada'`;
    const params = [anio, mes.padStart(2, '0')];
    if (id_sucursal) { query += ` AND id_sucursal = ?`; params.push(id_sucursal); }
    query += ` GROUP BY dia`;

    db.query(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const disponibilidad = {};
        rows.forEach(r => { disponibilidad[r.dia] = r.total; });
        res.json({ disponibilidad });
    });
});

app.get('/api/disponibilidad/:fecha', (req, res) => {
    const { fecha } = req.params;
    const { id_sucursal } = req.query;

    let queryEmp = `SELECT e.id_empleado as id_usuario, p.Nombre as nombre, p.Apellido_Paterno as apellido_paterno, e.id_sucursal as sucursal 
        FROM empleados e JOIN personas p ON e.id_persona = p.id_persona WHERE e.Estado_laboral = 'Activo'`;
    const params = [];
    if (id_sucursal) { queryEmp += ` AND e.id_sucursal = ?`; params.push(id_sucursal); }

    db.query(queryEmp, params, (err, especialistas) => {
        if (err) return res.status(500).json({ error: err.message });
        if (especialistas.length === 0) return res.json({ fecha, especialistas: [] });

        const promesas = especialistas.map(emp => {
            return new Promise((resolve) => {
                db.query(`SELECT Fecha_cita FROM citas WHERE id_empleado = ? AND DATE(Fecha_cita) = ? AND Estado != 'Cancelada'`, [emp.id_usuario, fecha], (err, citas) => {
                    const ocupados = citas ? citas.map(c => c.Fecha_cita.toISOString().split('T')[1].substring(0, 5)) : [];
                    resolve({ ...emp, horarios_ocupados: ocupados });
                });
            });
        });
        Promise.all(promesas).then(resultado => res.json({ fecha, especialistas: resultado }));
    });
});

// =========================================================
// ENDPOINTS: LOGIN Y REGISTRO
// =========================================================
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const query = `SELECT l.id_usuario, l.email, l.password_hash, r.Ocupacion as rol, p.Nombre as nombre, p.id_persona
        FROM login l JOIN personas p ON l.id_persona = p.id_persona JOIN roles r ON l.id_rol = r.id_rol WHERE l.email = ?`;
    db.query(query, [email], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(401).json({ error: "Credenciales incorrectas" });
        const usuario = results[0];
        if (usuario.password_hash !== password) return res.status(401).json({ error: "Contraseña incorrecta" });
        delete usuario.password_hash;
        res.json({ usuario, tiene_google_calendar: false });
    });
});

app.post('/api/login-google', (req, res) => {
    const { email, nombre } = req.body;
    if (!email) return res.status(400).json({ error: "Se requiere el email." });
    db.query("SELECT id_usuario FROM login WHERE email = ?", [email], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length) {
            db.query(`SELECT l.id_usuario, l.email, r.Ocupacion as rol, p.Nombre as nombre FROM login l JOIN personas p ON l.id_persona = p.id_persona JOIN roles r ON l.id_rol = r.id_rol WHERE l.id_usuario = ?`, [results[0].id_usuario], (err, userInfo) => {
                res.json({ mensaje: "Sesión iniciada", usuario: userInfo[0], esNuevo: false, tiene_google_calendar: false });
            });
        } else {
            const partes = (nombre || "Usuario Google").split(" ");
            db.query(`INSERT INTO personas (Nombre, Apellido_Paterno, Celular) VALUES (?, ?, '0000000000')`, [partes[0] || "Usuario", partes[1] || "Google"], (err, resPersona) => {
                if (err) return res.status(500).json({ error: err.message });
                const id_persona = resPersona.insertId;
                db.query(`INSERT INTO login (id_persona, id_rol, email, password_hash) VALUES (?, 3, ?, 'google_auth')`, [id_persona, email], (err, resLogin) => {
                    if (err) return res.status(500).json({ error: err.message });
                    const id_usuario = resLogin.insertId;
                    db.query(`INSERT INTO cliente (id_usuario, id_persona) VALUES (?, ?)`, [id_usuario, id_persona], (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        mailer.enviarCorreoBienvenida({ email, nombre: partes[0] }).catch(console.error);
                        res.json({ mensaje: "Cuenta creada", usuario: { id_usuario, nombre: partes[0], email, rol: 'cliente' }, esNuevo: true, tiene_google_calendar: false });
                    });
                });
            });
        }
    });
});

app.post('/api/registro', (req, res) => {
    const { nombre, apellido_paterno, apellido_materno, email, password, telefono, fecha_nacimiento } = req.body;
    db.query(`INSERT INTO personas (Nombre, Apellido_Paterno, Apellidos_Materno, Celular, Fecha_nacimiento) VALUES (?, ?, ?, ?, ?)`, [nombre, apellido_paterno, apellido_materno, telefono, fecha_nacimiento], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const id_persona = result.insertId;
        db.query(`INSERT INTO login (id_persona, id_rol, email, password_hash) VALUES (?, 3, ?, ?)`, [id_persona, email, password], (err, resultLogin) => {
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

// =========================================================
// ENDPOINT: AGENDAR CITA (Con el fix del depósito)
// =========================================================
app.post('/api/citas', (req, res) => {
    const { id_cliente, id_servicio, id_sucursal, id_empleado, fecha_cita } = req.body;
    
    const checkQuery = `SELECT id_cita FROM citas WHERE id_sucursal = ? AND id_empleado = ? AND Fecha_cita = ? AND Estado != 'Cancelada'`;
    db.query(checkQuery, [id_sucursal, id_empleado, fecha_cita], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) return res.status(409).json({ error: "Horario ocupado. Elige otro." });

        db.query("SELECT id_cliente FROM cliente WHERE id_usuario = ?", [id_cliente], (err, clienteResult) => {
            if (err) return res.status(500).json({ error: err.message });

            const guardarCita = (id_cliente_real) => {
                db.query(`INSERT INTO citas (id_cliente, id_servicio, id_sucursal, id_empleado, Fecha_cita, Estado) VALUES (?, ?, ?, ?, ?, 'Pendiente')`, [id_cliente_real, id_servicio, id_sucursal, id_empleado, fecha_cita], (err, result) => {
                    if (err) return res.status(500).json({ error: err.message });
                    const idCita = result.insertId;

                    // Aquí devolvemos el depósito para que Mercado Pago funcione
                    db.query(`SELECT Precio, Nombre_servicio FROM servicios WHERE id_servicio = ?`, [id_servicio], (err, servRows) => {
                        if (err || !servRows.length) return res.json({ mensaje: "Cita agendada", id_cita: idCita, deposito: 0 });
                        const precio = Number(servRows[0].Precio);
                        const deposito = Math.round(precio * 0.20);
                        
                        res.json({
                            mensaje: "Cita creada exitosamente",
                            id_cita: idCita,
                            precio_total: precio,
                            deposito: deposito,
                            deposito_pagado: 0,
                            status_pago: "pendiente",
                            nombre_servicio: servRows[0].Nombre_servicio
                        });
                    });
                });
            };

            if (clienteResult.length > 0) {
                guardarCita(clienteResult[0].id_cliente);
            } else {
                db.query("SELECT id_persona FROM login WHERE id_usuario = ?", [id_cliente], (err, loginResult) => {
                    if (err || !loginResult.length) return res.status(500).json({ error: "Usuario no encontrado" });
                    db.query("INSERT INTO cliente (id_usuario, id_persona) VALUES (?, ?)", [id_cliente, loginResult[0].id_persona], (err, insertResult) => {
                        if (err) return res.status(500).json({ error: err.message });
                        guardarCita(insertResult.insertId);
                    });
                });
            }
        });
    });
});

// =========================================================
// ENDPOINTS: MERCADO PAGO (Con tu URL de ngrok)
// =========================================================
app.post('/api/pagos/crear-preferencia', async (req, res) => {
    const { id_cita, monto, nombre_servicio, email_cliente } = req.body;

    if (!id_cita || !monto) return res.status(400).json({ error: "Faltan datos para el pago." });

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
                // 👇 AQUÍ ESTÁ TU URL DE NGROK 👇
                success: 'https://lively-serve-engine.ngrok-free.dev/?status=approved&payment_id={payment_id}',
                failure: 'https://lively-serve-engine.ngrok-free.dev/pago-fallido',
                pending: 'https://lively-serve-engine.ngrok-free.dev/pago-pendiente'
            },
            auto_return: 'approved',
            external_reference: String(id_cita),
            statement_descriptor: 'ALMA ESTETICA'
        };

        const result = await preference.create({ body });
        res.json({ init_point: result.init_point, sandbox_init_point: result.sandbox_init_point });
    } catch (error) {
        console.error('❌ Error Mercado Pago:', error);
        res.status(500).json({ error: "Error al crear el pago." });
    }
});

app.post('/api/pagos/confirmar', (req, res) => {
    const { id_cita, payment_id, metodo_pago } = req.body;
    if (!id_cita) return res.status(400).json({ error: "Falta ID de la cita." });

    db.query(`UPDATE citas SET Estado = 'Confirmada' WHERE id_cita = ?`, [id_cita], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        db.query(`SELECT Precio FROM citas c JOIN servicios s ON c.id_servicio = s.id_servicio WHERE c.id_cita = ?`, [id_cita], (err, rows) => {
            const precio = (!err && rows.length) ? Number(rows[0].Precio) : 0;
            const deposito = Math.round(precio * 0.20);

            db.query(`INSERT INTO pagos (id_cita, Monto, Metodo_pago, Estado, Referencia) VALUES (?, ?, ?, 'Completado', ?)`, 
                [id_cita, deposito, metodo_pago || 'mercadopago', payment_id || 'SIMULADO'], (err) => {
                if (err) console.error("Error insertando pago:", err);
                res.json({ mensaje: "Pago confirmado", id_cita, cambios: result.affectedRows });
            });
        });
    });
});

// =========================================================
// ENDPOINTS: HISTORIAL Y CANCELAR
// =========================================================
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

app.delete('/api/citas/:id_cita', (req, res) => {
    const { id_cita } = req.params;
    db.query(`UPDATE citas SET Estado = 'Cancelada' WHERE id_cita = ?`, [id_cita], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: "Cita cancelada", cambios: result.affectedRows });
    });
});

// =========================================================
// ENDPOINTS: DASHBOARDS
// =========================================================
app.get('/api/dashboard/empleado/:id_usuario', (req, res) => {
    const idUsuario = req.params.id_usuario;
    db.query(`SELECT e.id_sucursal, p.Nombre as nombre, e.id_empleado FROM empleados e JOIN personas p ON e.id_persona = p.id_persona JOIN login l ON l.id_persona = p.id_persona WHERE l.id_usuario = ?`, [idUsuario], (err, empRows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!empRows.length) return res.status(404).json({ error: "Empleado no encontrado" });

        const emp = empRows[0];
        db.query(`SELECT c.id_cita, c.Fecha_cita, c.Estado, s.Nombre_servicio as servicio_nombre, s.Precio as precio, p2.Nombre as cliente_nombre FROM citas c JOIN servicios s ON c.id_servicio = s.id_servicio JOIN cliente cl ON c.id_cliente = cl.id_cliente JOIN personas p2 ON cl.id_persona = p2.id_persona WHERE c.id_empleado = ? ORDER BY c.Fecha_cita DESC`, [emp.id_empleado], (err, citas) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ empleado: emp.nombre, sucursal: emp.id_sucursal, citas: citas || [] });
        });
    });
});

app.get('/api/dashboard/admin', (req, res) => {
    db.query(`SELECT COUNT(*) as total_citas, SUM(CASE WHEN Estado = 'Pendiente' THEN 1 ELSE 0 END) as pendientes, SUM(CASE WHEN Estado = 'Confirmada' THEN 1 ELSE 0 END) as confirmadas FROM citas`, (err, statsRows) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query(`SELECT c.id_sucursal, COUNT(*) as total_citas, SUM(s.Precio) as ingresos_totales FROM citas c JOIN servicios s ON c.id_servicio = s.id_servicio GROUP BY c.id_sucursal`, (err, porSucursal) => {
            db.query(`SELECT c.id_cita, c.Fecha_cita, c.Estado, s.Nombre_servicio as servicio_nombre, s.Precio as precio FROM citas c JOIN servicios s ON c.id_servicio = s.id_servicio ORDER BY c.Fecha_cita DESC LIMIT 50`, (err, citas) => {
                res.json({ estadisticas: statsRows[0], por_sucursal: porSucursal, citas });
            });
        });
    });
});

// =========================================================
// CONFIG Y GOOGLE OAUTH
// =========================================================
app.get('/api/config', (req, res) => {
    res.json({ 
        hero_subtitulo: 'ESTÉTICA FACIAL', 
        hero_titulo: 'Tu belleza<br><em>y juventud,</em><br>redefinidas.', 
        hero_descripcion: 'Especialistas en estética facial no quirúrgica.' 
    });
});

app.get('/api/auth/google', (req, res) => {
    const idUsuario = req.query.id_usuario || '';
    res.json({ url: googleAuth.generarUrlAutorizacion(idUsuario) });
});

app.get('/oauth2callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('No se recibió código.');
    try {
        const tokens = await googleAuth.obtenerTokens(code);
        const idUsuario = state || 1;
        db.query(`UPDATE login SET google_refresh_token = ? WHERE id_usuario = ?`, [tokens.refresh_token, idUsuario], (err) => {
            res.send(`<html><body style="text-align:center;padding:50px;"><h1>✅ Cuenta vinculada</h1><a href="/">Volver</a><script>setTimeout(()=>window.location.href='/',2500)</script></body></html>`);
        });
    } catch (err) { res.status(500).send('Error al vincular.'); }
});

// =========================================================
// INICIAR SERVIDOR
// =========================================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor Backend corriendo en http://localhost:${PORT}`);
    console.log(`💳 Mercado Pago configurado y apuntando a ngrok.`);
});