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

// =========================================================
// MIDDLEWARES
// =========================================================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// =========================================================
// MERCADO PAGO
// =========================================================
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
    options: { timeout: 5000 }
});

// =========================================================
// CONEXIÓN A MYSQL - TIDB CLOUD
// =========================================================
if (!process.env.DB_HOST || !process.env.DB_USER ||
    !process.env.DB_PASSWORD || !process.env.DB_SSL_CA) {
    throw new Error(
        'Faltan variables DB_HOST, DB_USER, DB_PASSWORD o DB_SSL_CA en .env'
    );
}

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'salon_belleza_db',

    ssl: {
        rejectUnauthorized: true // <-- ESTO ES LO NUEVO
    },

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
// Conexión con soporte para promesas y transacciones
const dbp = db.promise();

db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error conectando a TiDB Cloud:', err.message);
    } else {
        console.log('✅ Conectado a TiDB Cloud (salon_belleza_db)');
        connection.release();
    }
});

// =========================================================
// GENERADOR SEGURO DE IDENTIFICADORES
// =========================================================

const TABLAS_IDS = {
    personas: 'id_persona',
    login: 'id_usuario',
    cliente: 'id_cliente',
    empleados: 'id_empleado',
    citas: 'id_cita',
    servicios: 'id_servicio',
    sucursales: 'id_sucursal',
    pagos: 'id_pago',
    historial: 'id_historial',
    categoria_servicio: 'id_categoria',
    roles: 'id_rol',
    medicos: 'id_medico'
};

async function obtenerNuevoId(conexion, nombreTabla) {

    if (!Object.prototype.hasOwnProperty.call(TABLAS_IDS, nombreTabla)) {
        throw new Error(`Tabla no permitida: ${nombreTabla}`);
    }

    // Incremento atómico del contador.
    const [resultado] = await conexion.query(
        `UPDATE generador_ids
         SET ultimo_id = ultimo_id + 1
         WHERE nombre_tabla = ?`,
        [nombreTabla]
    );

    if (resultado.affectedRows !== 1) {
        throw new Error(
            `No existe el generador de IDs para ${nombreTabla}`
        );
    }

    // Consultar el valor actualizado dentro de la misma transacción.
    const [filas] = await conexion.query(
        `SELECT ultimo_id
         FROM generador_ids
         WHERE nombre_tabla = ?`,
        [nombreTabla]
    );

    if (!filas.length) {
        throw new Error(`No se pudo obtener el ID de ${nombreTabla}`);
    }

    return Number(filas[0].ultimo_id);
}

// =========================================================
// CARGAR LÉXICO (PLN)
// =========================================================
let lexico = {};

try {
    lexico = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'lexico.json'), 'utf-8')
    );

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
        contextos[sessionId] = {
            ultimoServicio: null,
            ultimaIntencion: null,
            historial: []
        };
    }

    return contextos[sessionId];
}

function actualizarContexto(sessionId, intencion, entidades) {
    const ctx = obtenerContexto(sessionId);

    if (entidades.servicio) {
        ctx.ultimoServicio = entidades.servicio;
    }

    ctx.ultimaIntencion = intencion;

    ctx.historial.push({
        intencion,
        entidades,
        fecha: new Date().toISOString()
    });

    if (ctx.historial.length > 10) {
        ctx.historial.shift();
    }
}

// =========================================================
// MOTOR DE PLN
// =========================================================
function normalizar(texto) {
    return texto.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[.,!?;:]/g, "")
        .trim();
}

function detectarIntencion(texto) {
    const t = normalizar(texto);

    for (const v of lexico.intenciones.saludo.variantes)
        if (t === v || t.startsWith(v + " ")) return "saludo";

    for (const v of lexico.intenciones.despedida.variantes)
        if (t === v || t.startsWith(v + " ")) return "despedida";

    for (const v of lexico.intenciones.confirmacion.variantes)
        if (t === v || t.startsWith(v + " ")) return "confirmacion";

    for (const v of lexico.intenciones.negacion.variantes)
        if (t === v || t.startsWith(v + " ")) return "negacion";

    for (const v of lexico.intenciones.agradecimiento.variantes)
        if (t.includes(v)) return "agradecimiento";

    for (const v of lexico.intenciones.cancelar.variantes)
        if (t.includes(v)) return "cancelar";

    for (const v of lexico.intenciones.reagendar.variantes)
        if (t.includes(v)) return "reagendar";

    for (const v of lexico.intenciones.agendar.variantes)
        if (t.includes(v)) return "agendar";

    for (const v of lexico.intenciones.consultar_precio.variantes)
        if (t.includes(v)) return "consultar_precio";

    for (const v of lexico.intenciones.consultar_duracion.variantes)
        if (t.includes(v)) return "consultar_duracion";

    for (const v of lexico.intenciones.consultar_requisitos.variantes)
        if (t.includes(v)) return "consultar_requisitos";

    for (const v of lexico.intenciones.consultar_servicio.variantes)
        if (t.includes(v)) return "consultar_servicio";

    return "desconocida";
}

function extraerEntidades(texto) {
    const t = normalizar(texto);

    const entidades = {
        servicio: null,
        sucursal: null,
        fecha: null
    };

    for (const [s, data] of Object.entries(lexico.servicios)) {
        for (const v of data.variantes) {
            if (t.includes(v)) {
                entidades.servicio = s;
                break;
            }
        }

        if (entidades.servicio) break;
    }

    for (const [s, vs] of Object.entries(lexico.sucursales)) {
        for (const v of vs) {
            if (t.includes(v)) {
                entidades.sucursal = s;
                break;
            }
        }

        if (entidades.sucursal) break;
    }

    for (const [f, vs] of Object.entries(lexico.fechas)) {
        for (const v of vs) {
            if (t.includes(v)) {
                entidades.fecha = f;
                break;
            }
        }

        if (entidades.fecha) break;
    }

    return entidades;
}

function detectarEmocion(texto) {
    const t = normalizar(texto);

    for (const [e, vs] of Object.entries(lexico.emociones)) {
        for (const v of vs) {
            if (t.includes(v)) return e;
        }
    }

    return null;
}

function generarRespuestaEstructurada(
    intencion,
    entidades,
    contexto = {},
    emocion = null
) {
    const elegir = (arr) => arr[Math.floor(Math.random() * arr.length)];

    if (!entidades.servicio && contexto.ultimoServicio) {
        entidades.servicio = contexto.ultimoServicio;
    }

    const servicio = entidades.servicio
        ? lexico.servicios[entidades.servicio]
        : null;

    const nombreServicio = servicio
        ? servicio.termino_estandar
        : null;

    let prefijo = "";

    if (emocion === "miedo")
        prefijo = "Entiendo tu preocupación, tranquila 💖. ";

    else if (emocion === "urgencia")
        prefijo = "¡Vamos rápido entonces! ⚡ ";

    else if (emocion === "frustracion")
        prefijo = "Lamento la confusión, déjame ayudarte mejor 🙏. ";

    else if (emocion === "entusiasmo")
        prefijo = "¡Me encanta tu energía! ✨ ";

    switch (intencion) {

        case "saludo":
            return elegir([
                "¡Hola! 💖 Soy Alma, tu asistente. ¿En qué te puedo ayudar hoy?",
                "¡Qué gusto saludarte! ✨ ¿Buscas algún tratamiento o quieres agendar?",
                "¡Hola! ¿En qué te puedo ayudar?"
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
                return `¡Perfecto! 💖 Para agendar tu cita de ${nombreServicio}, ve a la sección 'Agenda tu Cita' aquí en la página.`;
            }

            return "¡Perfecto! 💖 ¿Te gustaría agendar una cita o tienes alguna otra duda?";

        case "negacion":
            return "Está bien 💖. Si cambias de opinión, aquí estaremos.";

        case "consultar_precio":
            if (servicio) {
                return `${prefijo}El ${nombreServicio} tiene un precio de ${servicio.precio} y dura ${servicio.duracion} minutos ✨. ¿Te gustaría agendar una cita?`;
            }

            return `${prefijo}Nuestros precios son:

💉 Botox Facial - $3,200
💖 Ácido Hialurónico - $4,500
💆‍♀️ Bioestimulación - $2,800
💄 Lifting de Cejas - $2,200
✨ Mesoterapia - $1,900
🧖‍♀️ Peeling Químico - $1,500

¿Sobre cuál quieres más información?`;

        case "consultar_duracion":
            if (servicio) {
                return `El ${nombreServicio} tiene una duración aproximada de ${servicio.duracion} minutos ⏱️. ¿Te gustaría agendar una cita?`;
            }

            return "Cada tratamiento tiene una duración diferente. ¿Sobre cuál te gustaría saber? ✨";

        case "consultar_requisitos":
            if (servicio) {
                return `Para el ${nombreServicio}, los requisitos son: ${servicio.requisitos} 📋. ¿Tienes alguna otra duda?`;
            }

            return "En general, todos nuestros tratamientos requieren mayoría de edad. ¿Sobre cuál te gustaría saber los requisitos específicos? 💖";

        case "consultar_servicio":
            if (servicio) {
                return `${prefijo}${servicio.descripcion} Dura ${servicio.duracion} minutos, cuesta ${servicio.precio} y ${servicio.efectos}. ¿Te gustaría más información o agendar una cita? ✨`;
            }

            return `${prefijo}Contamos con 6 tratamientos principales:

💉 Botox Facial ($3,200, 30 min)
💖 Ácido Hialurónico ($4,500, 45 min)
💆‍♀️ Bioestimulación ($2,800, 60 min)
💄 Lifting de Cejas ($2,200, 20 min)
✨ Mesoterapia ($1,900, 45 min)
🧖‍♀️ Peeling Químico ($1,500, 50 min)

¿Sobre cuál te gustaría saber más?`;

        case "agendar": {
            let msg = `${prefijo}¡Perfecto! 💖 `;

            if (servicio) {
                msg += `Para tu cita de ${nombreServicio}, solo ve a la sección 'Agenda tu Cita' aquí en la página. `;
            } else {
                msg += "Para agendar solo ve a la sección 'Agenda tu Cita' aquí en la página. ";
            }

            if (entidades.fecha) {
                msg += `Anoté tu preferencia para el ${entidades.fecha}. `;
            }

            msg += "La primera consulta es gratis. ¿Te ayudo con algo más?";

            return msg;
        }

        case "cancelar":
            return "Entiendo que quieras cancelar 💖. Ve a 'Mi Cuenta' → 'Mis Citas' y haz clic en 'Cancelar'.";

        case "reagendar":
            return "¡Claro que sí! 💖 Para cambiar tu cita, cancela la actual en 'Mi Cuenta' y agenda una nueva en 'Agenda tu Cita'.";

        default:
            return null;
    }
}

// =========================================================
// LLM - GEMINI
// =========================================================
const MODELOS_DISPONIBLES = [
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
];

let genAI = null;

if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

async function llamarLLM(mensaje) {
    if (!genAI) return null;

    const systemInstruction = `Eres "Alma", la asistente virtual de Alma Estética.
    Personalidad: Cálida, amable y muy humana. Respuestas BREVES (máx 3 oraciones).
    Servicios: Botox, Ácido Hialurónico, Bioestimulación. Primera consulta gratis.
    Responde SIEMPRE en español.`;

    for (const modelo of MODELOS_DISPONIBLES) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelo,
                systemInstruction
            });

            const result = await model.generateContent(mensaje);

            return result.response.text();

        } catch (err) {
            console.warn(`⚠️ Modelo ${modelo} falló:`, err.message);
        }
    }

    return null;
}

// =========================================================
// ENDPOINTS: CHATBOT
// =========================================================
app.post('/api/chat', async (req, res) => {
    const { mensaje, sessionId = "default" } = req.body;

    if (!mensaje || mensaje.trim() === '') {
        return res.status(400).json({ error: "Mensaje vacío" });
    }

    const contexto = obtenerContexto(sessionId);
    const intencion = detectarIntencion(mensaje);
    const entidades = extraerEntidades(mensaje);
    const emocion = detectarEmocion(mensaje);

    actualizarContexto(sessionId, intencion, entidades);

    if (intencion !== "desconocida") {
        const respuestaBase = generarRespuestaEstructurada(
            intencion,
            entidades,
            contexto,
            emocion
        );

        if (respuestaBase) {
            const prompt = `Usuario: "${mensaje}". Respuesta base: "${respuestaBase}". Reformúlala naturalmente (máx 3 oraciones).`;

            const respuestaLLM = await llamarLLM(prompt);

            return res.json({
                respuesta: respuestaLLM || respuestaBase
            });
        }
    }

    const respuestaLLM = await llamarLLM(mensaje);

    return res.json({
        respuesta: respuestaLLM || "Mmm, no entendí bien 🤔. ¿Podrías reformular?"
    });
});

// =========================================================
// ENDPOINTS: SERVICIOS Y DISPONIBILIDAD
// =========================================================
app.get('/api/servicios', (req, res) => {
    db.query(`
        SELECT id_servicio,
               Nombre_servicio AS nombre,
               Precio AS precio,
               Duracion_estimada AS duracion
        FROM servicios
        WHERE Estado = 'activo'
    `, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json(rows);
    });
});

// Disponibilidad mensual
app.get('/api/disponibilidad/mes/:anio/:mes', (req, res) => {
    const { anio, mes } = req.params;
    const { id_sucursal } = req.query;

    let query = `
        SELECT DATE_FORMAT(Fecha_cita, '%Y-%m-%d') AS dia,
               COUNT(*) AS total
        FROM citas
        WHERE YEAR(Fecha_cita) = ?
          AND MONTH(Fecha_cita) = ?
          AND Estado != 'Cancelada'
    `;

    const params = [anio, mes.padStart(2, '0')];

    if (id_sucursal) {
        query += ` AND id_sucursal = ?`;
        params.push(id_sucursal);
    }

    query += ` GROUP BY dia`;

    db.query(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const disponibilidad = {};

        rows.forEach(r => {
            disponibilidad[r.dia] = r.total;
        });

        res.json({ disponibilidad });
    });
});

// Disponibilidad por fecha
app.get('/api/disponibilidad/:fecha', (req, res) => {
    const { fecha } = req.params;
    const { id_sucursal } = req.query;

    let queryEmp = `
        SELECT e.id_empleado AS id_usuario,
               p.Nombre AS nombre,
               p.Apellido_Paterno AS apellido_paterno,
               e.id_sucursal AS sucursal
        FROM empleados e
        JOIN personas p ON e.id_persona = p.id_persona
        WHERE e.Estado_laboral = 'Activo'
    `;

    const params = [];

    if (id_sucursal) {
        queryEmp += ` AND e.id_sucursal = ?`;
        params.push(id_sucursal);
    }

    db.query(queryEmp, params, (err, especialistas) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (especialistas.length === 0) {
            return res.json({ fecha, especialistas: [] });
        }

        const promesas = especialistas.map(emp => {
            return new Promise((resolve) => {

                db.query(`
                    SELECT Fecha_cita
                    FROM citas
                    WHERE id_empleado = ?
                      AND DATE(Fecha_cita) = ?
                      AND Estado != 'Cancelada'
                `, [emp.id_usuario, fecha], (err, citas) => {

                    const ocupados = (!err && citas)
                        ? citas.map(c => {
                            const fechaCita = new Date(c.Fecha_cita);
                            return fechaCita.toISOString()
                                .split('T')[1].substring(0, 5);
                        })
                        : [];

                    resolve({
                        ...emp,
                        horarios_ocupados: ocupados
                    });
                });
            });
        });

        Promise.all(promesas).then(resultado => {
            res.json({ fecha, especialistas: resultado });
        });
    });
});

// =========================================================
// ENDPOINTS: LOGIN Y REGISTRO
// =========================================================

// LOGIN NORMAL
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    const query = `
        SELECT l.id_usuario,
               l.email,
               l.password_hash,
               r.Ocupacion AS rol,
               p.Nombre AS nombre,
               p.id_persona
        FROM login l
        JOIN personas p ON l.id_persona = p.id_persona
        JOIN roles r ON l.id_rol = r.id_rol
        WHERE l.email = ?
    `;

    db.query(query, [email], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (results.length === 0) {
            return res.status(401).json({
                error: "Credenciales incorrectas"
            });
        }

        const usuario = results[0];

        if (usuario.password_hash !== password) {
            return res.status(401).json({
                error: "Contraseña incorrecta"
            });
        }

        delete usuario.password_hash;

        res.json({
            usuario,
            tiene_google_calendar: false
        });
    });
});

// LOGIN CON GOOGLE
app.post('/api/login-google', async (req, res) => {
    const { email, nombre } = req.body;

    if (!email) {
        return res.status(400).json({
            error: "Se requiere el email."
        });
    }

    let conexion;
    let transaccionIniciada = false;

    try {
        conexion = await dbp.getConnection();

        await conexion.beginTransaction();
        transaccionIniciada = true;

        const [existentes] = await conexion.query(
            "SELECT id_usuario FROM login WHERE email = ?",
            [email]
        );

        if (existentes.length > 0) {

            const [userInfo] = await conexion.query(`
                SELECT l.id_usuario,
                       l.email,
                       r.Ocupacion AS rol,
                       p.Nombre AS nombre
                FROM login l
                JOIN personas p ON l.id_persona = p.id_persona
                JOIN roles r ON l.id_rol = r.id_rol
                WHERE l.id_usuario = ?
            `, [existentes[0].id_usuario]);

            await conexion.commit();
            transaccionIniciada = false;

            return res.json({
                mensaje: "Sesión iniciada",
                usuario: userInfo[0],
                esNuevo: false,
                tiene_google_calendar: false
            });
        }

        const partes = (nombre || "Usuario Google").split(" ");

        const id_persona = await obtenerNuevoId(conexion, 'personas');
        const id_usuario = await obtenerNuevoId(conexion, 'login');
        const id_cliente = await obtenerNuevoId(conexion, 'cliente');

        await conexion.query(`
            INSERT INTO personas
            (id_persona, Nombre, Apellido_Paterno, Celular)
            VALUES (?, ?, ?, '0000000000')
        `, [
            id_persona,
            partes[0] || "Usuario",
            partes[1] || "Google"
        ]);

        await conexion.query(`
            INSERT INTO login
            (id_usuario, id_persona, id_rol, email, password_hash)
            VALUES (?, ?, 3, ?, 'google_auth')
        `, [id_usuario, id_persona, email]);

        await conexion.query(`
            INSERT INTO cliente
            (id_cliente, id_usuario, id_persona)
            VALUES (?, ?, ?)
        `, [id_cliente, id_usuario, id_persona]);

        await conexion.commit();
        transaccionIniciada = false;

        mailer.enviarCorreoBienvenida({
            email,
            nombre: partes[0]
        }).catch(console.error);

        res.json({
            mensaje: "Cuenta creada",
            usuario: {
                id_usuario,
                nombre: partes[0],
                email,
                rol: 'cliente'
            },
            esNuevo: true,
            tiene_google_calendar: false
        });

    } catch (err) {

        if (conexion && transaccionIniciada) {
            await conexion.rollback();
        }

        console.error("Error en login Google:", err);

        res.status(500).json({ error: err.message });

    } finally {
        if (conexion) conexion.release();
    }
});

// REGISTRO NORMAL
app.post('/api/registro', async (req, res) => {
    const {
        nombre,
        apellido_paterno,
        apellido_materno,
        email,
        password,
        telefono,
        fecha_nacimiento
    } = req.body;

    if (!nombre || !email || !password) {
        return res.status(400).json({
            error: "Nombre, correo y contraseña son obligatorios."
        });
    }

    let conexion;
    let transaccionIniciada = false;

    try {
        conexion = await dbp.getConnection();

        await conexion.beginTransaction();
        transaccionIniciada = true;

        // Generar identificadores
        const id_persona = await obtenerNuevoId(conexion, 'personas');
        const id_usuario = await obtenerNuevoId(conexion, 'login');
        const id_cliente = await obtenerNuevoId(conexion, 'cliente');

        // Insertar persona
        await conexion.query(`
            INSERT INTO personas
            (id_persona, Nombre, Apellido_Paterno,
             Apellidos_Materno, Celular, Fecha_nacimiento)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            id_persona,
            nombre,
            apellido_paterno,
            apellido_materno,
            telefono,
            fecha_nacimiento
        ]);

        // Insertar usuario
        await conexion.query(`
            INSERT INTO login
            (id_usuario, id_persona, id_rol, email, password_hash)
            VALUES (?, ?, 3, ?, ?)
        `, [
            id_usuario,
            id_persona,
            email,
            password
        ]);

        // Insertar cliente
        await conexion.query(`
            INSERT INTO cliente
            (id_cliente, id_usuario, id_persona)
            VALUES (?, ?, ?)
        `, [
            id_cliente,
            id_usuario,
            id_persona
        ]);

        await conexion.commit();
        transaccionIniciada = false;

        mailer.enviarCorreoBienvenida({
            email,
            nombre
        }).catch(console.error);

        res.json({
            mensaje: "Cuenta creada",
            usuario: {
                id_usuario,
                nombre,
                email,
                rol: 'cliente'
            }
        });

    } catch (err) {

        if (conexion && transaccionIniciada) {
            await conexion.rollback();
        }

        console.error("Error en registro:", err);

        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: "Este correo electrónico ya está registrado."
            });
        }

        res.status(500).json({ error: err.message });

    } finally {
        if (conexion) conexion.release();
    }
});

// =========================================================
// ENDPOINT: AGENDAR CITA
// =========================================================
app.post('/api/citas', async (req, res) => {

    const {
        id_cliente,
        id_servicio,
        id_sucursal,
        id_empleado,
        fecha_cita
    } = req.body;

    let conexion;
    let transaccionIniciada = false;

    try {
        conexion = await dbp.getConnection();

        await conexion.beginTransaction();
        transaccionIniciada = true;

        // Verificar disponibilidad del horario
        const [ocupadas] = await conexion.query(`
            SELECT id_cita
            FROM citas
            WHERE id_sucursal = ?
              AND id_empleado = ?
              AND Fecha_cita = ?
              AND Estado != 'Cancelada'
            FOR UPDATE
        `, [
            id_sucursal,
            id_empleado,
            fecha_cita
        ]);

        if (ocupadas.length > 0) {
            await conexion.rollback();
            transaccionIniciada = false;

            return res.status(409).json({
                error: "Horario ocupado. Elige otro."
            });
        }

        // Buscar cliente
        const [clientes] = await conexion.query(
            "SELECT id_cliente FROM cliente WHERE id_usuario = ?",
            [id_cliente]
        );

        let id_cliente_real;

        if (clientes.length > 0) {

            id_cliente_real = clientes[0].id_cliente;

        } else {

            const [usuarios] = await conexion.query(
                "SELECT id_persona FROM login WHERE id_usuario = ?",
                [id_cliente]
            );

            if (usuarios.length === 0) {
                throw new Error("Usuario no encontrado");
            }

            id_cliente_real = await obtenerNuevoId(
                conexion,
                'cliente'
            );

            await conexion.query(`
                INSERT INTO cliente
                (id_cliente, id_usuario, id_persona)
                VALUES (?, ?, ?)
            `, [
                id_cliente_real,
                id_cliente,
                usuarios[0].id_persona
            ]);
        }

        // Generar ID de cita
        const id_cita = await obtenerNuevoId(
            conexion,
            'citas'
        );

        // Insertar cita
        await conexion.query(`
            INSERT INTO citas
            (id_cita, id_cliente, id_servicio, id_sucursal,
             id_empleado, Fecha_cita, Estado)
            VALUES (?, ?, ?, ?, ?, ?, 'Pendiente')
        `, [
            id_cita,
            id_cliente_real,
            id_servicio,
            id_sucursal,
            id_empleado,
            fecha_cita
        ]);

        // Consultar precio del servicio
        const [servicios] = await conexion.query(`
            SELECT Precio, Nombre_servicio
            FROM servicios
            WHERE id_servicio = ?
        `, [id_servicio]);

        if (servicios.length === 0) {
            throw new Error("No se encontró el servicio seleccionado.");
        }

        const precio = Number(servicios[0].Precio);
        const deposito = Math.round(precio * 0.20);

        await conexion.commit();
        transaccionIniciada = false;

        res.json({
            mensaje: "Cita creada exitosamente",
            id_cita,
            precio_total: precio,
            deposito,
            deposito_pagado: 0,
            status_pago: "pendiente",
            nombre_servicio: servicios[0].Nombre_servicio
        });

    } catch (err) {

        if (conexion && transaccionIniciada) {
            await conexion.rollback();
        }

        console.error("Error agendando cita:", err);

        res.status(500).json({ error: err.message });

    } finally {
        if (conexion) conexion.release();
    }
});

// =========================================================
// ENDPOINTS: MERCADO PAGO
// =========================================================
app.post('/api/pagos/crear-preferencia', async (req, res) => {

    const {
        id_cita,
        monto,
        nombre_servicio,
        email_cliente
    } = req.body;

    if (!id_cita || !monto) {
        return res.status(400).json({
            error: "Faltan datos para el pago."
        });
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

            payer: {
                email: email_cliente || 'cliente@almaestetica.com'
            },

            back_urls: {
                success: 'https://lively-serve-engine.ngrok-free.dev/?status=approved&payment_id={payment_id}',
                failure: 'https://lively-serve-engine.ngrok-free.dev/pago-fallido',
                pending: 'https://lively-serve-engine.ngrok-free.dev/pago-pendiente'
            },

            auto_return: 'approved',
            external_reference: String(id_cita),
            statement_descriptor: 'ALMA ESTETICA'
        };

        const result = await preference.create({ body });

        res.json({
            init_point: result.init_point,
            sandbox_init_point: result.sandbox_init_point
        });

    } catch (error) {

        console.error('❌ Error Mercado Pago:', error);

        res.status(500).json({
            error: "Error al crear el pago."
        });
    }
});

// CONFIRMAR PAGO
app.post('/api/pagos/confirmar', async (req, res) => {

    const {
        id_cita,
        payment_id,
        metodo_pago
    } = req.body;

    if (!id_cita) {
        return res.status(400).json({
            error: "Falta ID de la cita."
        });
    }

    let conexion;
    let transaccionIniciada = false;

    try {
        conexion = await dbp.getConnection();

        await conexion.beginTransaction();
        transaccionIniciada = true;

        // Actualizar estado de la cita
        const [actualizacion] = await conexion.query(`
            UPDATE citas
            SET Estado = 'Confirmada'
            WHERE id_cita = ?
        `, [id_cita]);

        if (actualizacion.affectedRows === 0) {
            throw new Error("No se encontró la cita.");
        }

        // Consultar precio
        const [rows] = await conexion.query(`
            SELECT s.Precio
            FROM citas c
            JOIN servicios s ON c.id_servicio = s.id_servicio
            WHERE c.id_cita = ?
        `, [id_cita]);

        if (!rows.length) {
            throw new Error("No se encontró el precio del servicio.");
        }

        const precio = Number(rows[0].Precio);
        const deposito = Math.round(precio * 0.20);

        // Generar identificador del pago
        const id_pago = await obtenerNuevoId(
            conexion,
            'pagos'
        );

        // Insertar pago
        await conexion.query(`
            INSERT INTO pagos
            (id_pago, id_cita, Monto, Metodo_pago, Estado, Referencia)
            VALUES (?, ?, ?, ?, 'Completado', ?)
        `, [
            id_pago,
            id_cita,
            deposito,
            metodo_pago || 'mercadopago',
            payment_id || 'SIMULADO'
        ]);

        await conexion.commit();
        transaccionIniciada = false;

        res.json({
            mensaje: "Pago confirmado",
            id_pago,
            id_cita
        });

    } catch (err) {

        if (conexion && transaccionIniciada) {
            await conexion.rollback();
        }

        console.error("Error confirmando pago:", err);

        res.status(500).json({ error: err.message });

    } finally {
        if (conexion) conexion.release();
    }
});

// =========================================================
// ENDPOINTS: HISTORIAL Y CANCELAR
// =========================================================

// HISTORIAL
app.get('/api/historial/:id_usuario', (req, res) => {

    const { id_usuario } = req.params;

    const query = `
        SELECT c.id_cita,
               c.Fecha_cita,
               c.Estado,
               s.Nombre_servicio AS servicio_nombre,
               s.Precio AS precio,
               p.Nombre AS empleado_nombre
        FROM citas c
        JOIN cliente cl ON c.id_cliente = cl.id_cliente
        JOIN servicios s ON c.id_servicio = s.id_servicio
        JOIN empleados e ON c.id_empleado = e.id_empleado
        JOIN personas p ON e.id_persona = p.id_persona
        WHERE cl.id_usuario = ?
        ORDER BY c.Fecha_cita DESC
    `;

    db.query(query, [id_usuario], (err, results) => {

        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json(results);
    });
});

// CANCELAR CITA
app.delete('/api/citas/:id_cita', (req, res) => {

    const { id_cita } = req.params;

    db.query(`
        UPDATE citas
        SET Estado = 'Cancelada'
        WHERE id_cita = ?
    `, [id_cita], (err, result) => {

        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json({
            mensaje: "Cita cancelada",
            cambios: result.affectedRows
        });
    });
});

// =========================================================
// ENDPOINTS: DASHBOARDS
// =========================================================

// DASHBOARD EMPLEADO
app.get('/api/dashboard/empleado/:id_usuario', (req, res) => {

    const idUsuario = req.params.id_usuario;

    db.query(`
        SELECT e.id_sucursal,
               p.Nombre AS nombre,
               e.id_empleado
        FROM empleados e
        JOIN personas p ON e.id_persona = p.id_persona
        JOIN login l ON l.id_persona = p.id_persona
        WHERE l.id_usuario = ?
    `, [idUsuario], (err, empRows) => {

        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!empRows.length) {
            return res.status(404).json({
                error: "Empleado no encontrado"
            });
        }

        const emp = empRows[0];

        db.query(`
            SELECT c.id_cita,
                   c.Fecha_cita,
                   c.Estado,
                   s.Nombre_servicio AS servicio_nombre,
                   s.Precio AS precio,
                   p2.Nombre AS cliente_nombre
            FROM citas c
            JOIN servicios s ON c.id_servicio = s.id_servicio
            JOIN cliente cl ON c.id_cliente = cl.id_cliente
            JOIN personas p2 ON cl.id_persona = p2.id_persona
            WHERE c.id_empleado = ?
            ORDER BY c.Fecha_cita DESC
        `, [emp.id_empleado], (err, citas) => {

            if (err) {
                return res.status(500).json({ error: err.message });
            }

            res.json({
                empleado: emp.nombre,
                sucursal: emp.id_sucursal,
                citas: citas || []
            });
        });
    });
});

// DASHBOARD ADMINISTRADOR
app.get('/api/dashboard/admin', (req, res) => {

    db.query(`
        SELECT COUNT(*) AS total_citas,
               SUM(CASE WHEN Estado = 'Pendiente' THEN 1 ELSE 0 END) AS pendientes,
               SUM(CASE WHEN Estado = 'Confirmada' THEN 1 ELSE 0 END) AS confirmadas
        FROM citas
    `, (err, statsRows) => {

        if (err) {
            return res.status(500).json({ error: err.message });
        }

        db.query(`
            SELECT c.id_sucursal,
                   COUNT(*) AS total_citas,
                   SUM(s.Precio) AS ingresos_totales
            FROM citas c
            JOIN servicios s ON c.id_servicio = s.id_servicio
            GROUP BY c.id_sucursal
        `, (err, porSucursal) => {

            if (err) {
                return res.status(500).json({ error: err.message });
            }

            db.query(`
                SELECT c.id_cita,
                       c.Fecha_cita,
                       c.Estado,
                       s.Nombre_servicio AS servicio_nombre,
                       s.Precio AS precio
                FROM citas c
                JOIN servicios s ON c.id_servicio = s.id_servicio
                ORDER BY c.Fecha_cita DESC
                LIMIT 50
            `, (err, citas) => {

                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                res.json({
                    estadisticas: statsRows[0],
                    por_sucursal: porSucursal,
                    citas
                });
            });
        });
    });
});

// =========================================================
// CONFIGURACIÓN
// =========================================================
app.get('/api/config', (req, res) => {

    res.json({
        hero_subtitulo: 'ESTÉTICA FACIAL',
        hero_titulo: 'Tu belleza<br><em>y juventud,</em><br>redefinidas.',
        hero_descripcion: 'Especialistas en estética facial no quirúrgica.'
    });
});

// =========================================================
// GOOGLE OAUTH
// =========================================================
app.get('/api/auth/google', (req, res) => {

    const idUsuario = req.query.id_usuario || '';

    res.json({
        url: googleAuth.generarUrlAutorizacion(idUsuario)
    });
});

// CALLBACK GOOGLE
app.get('/oauth2callback', async (req, res) => {

    const { code, state } = req.query;

    if (!code) {
        return res.status(400).send('No se recibió código.');
    }

    try {

        const tokens = await googleAuth.obtenerTokens(code);
        const idUsuario = state || 1;

        db.query(`
            UPDATE login
            SET google_refresh_token = ?
            WHERE id_usuario = ?
        `, [
            tokens.refresh_token,
            idUsuario
        ], (err) => {

            if (err) {
                console.error("Error guardando token:", err.message);
                return res.status(500).send('Error al guardar la vinculación.');
            }

            res.send(`
                <html>
                <body style="text-align:center;padding:50px;">
                    <h1>✅ Cuenta vinculada</h1>
                    <a href="/">Volver</a>
                    <script>
                        setTimeout(() => window.location.href='/', 2500);
                    </script>
                </body>
                </html>
            `);
        });

    } catch (err) {

        console.error("Error Google OAuth:", err);

        res.status(500).send('Error al vincular.');
    }
});

// =========================================================
// API ADMINISTRATIVA: AGREGAR SUCURSALES, CATEGORÍAS Y SERVICIOS
// =========================================================
app.post('/api/admin', async (req, res) => {
    let conexion;
    let transaccionIniciada = false;

    try {
        const { action } = req.query;
        const data = req.body || {};

        conexion = await dbp.getConnection();

        await conexion.beginTransaction();
        transaccionIniciada = true;

        // =====================================================
        // AGREGAR SUCURSAL
        // =====================================================
        if (action === 'add_sucursal') {
            const nombre = String(data.Nombre_sucursal || '').trim();
            const direccion = String(data.Direccion || '').trim();
            const telefono = String(data.Telefono || '').trim();
            const horario = String(data.Horario_atencion || '').trim();

            if (!nombre || !direccion) {
                await conexion.rollback();
                transaccionIniciada = false;

                return res.status(400).json({
                    success: false,
                    error: 'El nombre y la dirección son obligatorios'
                });
            }

            const idSucursal = await obtenerNuevoId(
                conexion,
                'sucursales'
            );

            await conexion.query(`
                INSERT INTO sucursales (
                    id_sucursal,
                    Nombre_sucursal,
                    Direccion,
                    Telefono,
                    Horario_atencion
                )
                VALUES (?, ?, ?, ?, ?)
            `, [
                idSucursal,
                nombre,
                direccion,
                telefono || null,
                horario || null
            ]);

            await conexion.commit();
            transaccionIniciada = false;

            return res.status(201).json({
                success: true,
                message: 'Sucursal agregada correctamente',
                id_sucursal: idSucursal
            });
        }

        // =====================================================
        // AGREGAR CATEGORÍA
        // =====================================================
        if (action === 'add_categoria') {
            const nombre = String(data.nombre || '').trim();
            const descripcion = String(data.Descripcion || '').trim();

            if (!nombre) {
                await conexion.rollback();
                transaccionIniciada = false;

                return res.status(400).json({
                    success: false,
                    error: 'El nombre de la categoría es obligatorio'
                });
            }

            const idCategoria = await obtenerNuevoId(
                conexion,
                'categoria_servicio'
            );

            await conexion.query(`
                INSERT INTO categoria_servicio (
                    id_categoria,
                    nombre,
                    Descripcion
                )
                VALUES (?, ?, ?)
            `, [
                idCategoria,
                nombre,
                descripcion || null
            ]);

            await conexion.commit();
            transaccionIniciada = false;

            return res.status(201).json({
                success: true,
                message: 'Categoría agregada correctamente',
                id_categoria: idCategoria
            });
        }

        // =====================================================
        // AGREGAR SERVICIO
        // =====================================================
        if (action === 'add_servicio') {
            const nombre = String(data.Nombre_servicio || '').trim();

            const idCategoria = Number(data.id_categoria);
            const duracion = Number(data.Duracion_estimada);
            const precio = Number(data.Precio);

            const estado = String(data.Estado || 'activo').trim();

            // Validar campos obligatorios
            if (!nombre) {
                await conexion.rollback();
                transaccionIniciada = false;

                return res.status(400).json({
                    success: false,
                    error: 'El nombre del servicio es obligatorio'
                });
            }

            if (!Number.isInteger(idCategoria) || idCategoria <= 0) {
                await conexion.rollback();
                transaccionIniciada = false;

                return res.status(400).json({
                    success: false,
                    error: 'Selecciona una categoría válida'
                });
            }

            if (!Number.isFinite(duracion) || duracion <= 0) {
                await conexion.rollback();
                transaccionIniciada = false;

                return res.status(400).json({
                    success: false,
                    error: 'La duración debe ser mayor que cero'
                });
            }

            if (!Number.isFinite(precio) || precio < 0) {
                await conexion.rollback();
                transaccionIniciada = false;

                return res.status(400).json({
                    success: false,
                    error: 'Ingresa un precio válido'
                });
            }

            // Verificar que exista la categoría
            const [categorias] = await conexion.query(
                `SELECT id_categoria
                 FROM categoria_servicio
                 WHERE id_categoria = ?`,
                [idCategoria]
            );

            if (categorias.length === 0) {
                await conexion.rollback();
                transaccionIniciada = false;

                return res.status(400).json({
                    success: false,
                    error: 'La categoría seleccionada no existe'
                });
            }

            // Generar ID del servicio
            const idServicio = await obtenerNuevoId(
                conexion,
                'servicios'
            );

            // Insertar servicio
            await conexion.query(`
                INSERT INTO servicios (
                    id_servicio,
                    id_categoria,
                    Nombre_servicio,
                    Duracion_estimada,
                    Precio,
                    Estado
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                idServicio,
                idCategoria,
                nombre,
                duracion,
                precio,
                estado
            ]);

            await conexion.commit();
            transaccionIniciada = false;

            return res.status(201).json({
                success: true,
                message: 'Servicio agregado correctamente',
                id_servicio: idServicio
            });
        }

        // =====================================================
        // ACCIÓN NO RECONOCIDA
        // =====================================================
        await conexion.rollback();
        transaccionIniciada = false;

        return res.status(400).json({
            success: false,
            error: 'Acción administrativa no válida'
        });

    } catch (error) {

        if (conexion && transaccionIniciada) {
            try {
                await conexion.rollback();
            } catch (rollbackError) {
                console.error('Error al revertir transacción:', rollbackError);
            }
        }

        console.error('Error en POST /api/admin:', error);

        return res.status(500).json({
            success: false,
            error: error.message || 'Error al guardar información administrativa'
        });

    } finally {
        if (conexion) {
            conexion.release();
        }
    }
});
// =========================================================
// API ADMINISTRATIVA: OBTENER DATOS (GET)
// =========================================================
app.get('/api/admin', async (req, res) => {
    try {
        const { action } = req.query;

        // --- DASHBOARD STATS ---
        if (action === 'get_stats') {
            const [servicios] = await dbp.query("SELECT COUNT(*) AS total FROM servicios WHERE Estado = 'activo'");
            const [sucursales] = await dbp.query("SELECT COUNT(*) AS total FROM sucursales");
            const [empleados] = await dbp.query("SELECT COUNT(*) AS total FROM empleados WHERE Estado_laboral = 'Activo'");
            const [citas] = await dbp.query("SELECT COUNT(*) AS total FROM citas");

            return res.json({
                servicios: servicios[0].total,
                sucursales: sucursales[0].total,
                personal: empleados[0].total,
                citas: citas[0].total
            });
        }

        // --- OBTENER SUCURSALES ---
        if (action === 'get_sucursales') {
            const [rows] = await dbp.query("SELECT * FROM sucursales ORDER BY id_sucursal DESC");
            return res.json(rows);
        }

        // --- OBTENER CATEGORÍAS ---
        if (action === 'get_categorias') {
            const [rows] = await dbp.query("SELECT id_categoria, nombre, Descripcion FROM categoria_servicio ORDER BY nombre");
            return res.json(rows);
        }

        // --- OBTENER SERVICIOS ---
        if (action === 'get_servicios') {
            const [rows] = await dbp.query(`
                SELECT s.*, c.nombre AS categoria_nombre
                FROM servicios s 
                LEFT JOIN categoria_servicio c ON s.id_categoria = c.id_categoria
                ORDER BY s.id_servicio DESC
            `);
            return res.json(rows);
        }

        // --- OBTENER ROLES ---
        if (action === 'get_roles') {
            const [rows] = await dbp.query("SELECT id_rol, Ocupacion, Descripcion FROM roles ORDER BY Ocupacion");
            return res.json(rows);
        }

        // --- OBTENER USUARIOS ---
        if (action === 'get_usuarios') {
            const [rows] = await dbp.query(`
                SELECT l.id_usuario, l.email, l.estado, r.Ocupacion,
                       p.Nombre, p.Apellido_Paterno, p.Apellidos_Materno
                FROM login l
                INNER JOIN personas p ON p.id_persona = l.id_persona
                INNER JOIN roles r ON r.id_rol = l.id_rol
                ORDER BY l.id_usuario DESC
            `);
            return res.json(rows);
        }

        // --- OBTENER EMPLEADOS ---
        if (action === 'get_empleados') {
            const [rows] = await dbp.query(`
                SELECT e.id_empleado, e.Estado_laboral, e.Fecha_ingreso,
                       p.Nombre AS nombre, p.Apellido_Paterno AS apellido_paterno,
                       p.Apellidos_Materno AS apellido_materno, p.Celular AS celular,
                       s.Nombre_sucursal, l.email, r.Ocupacion AS rol
                FROM empleados e
                INNER JOIN personas p ON p.id_persona = e.id_persona
                INNER JOIN login l ON l.id_usuario = e.id_usuario
                INNER JOIN roles r ON r.id_rol = l.id_rol
                LEFT JOIN sucursales s ON s.id_sucursal = e.id_sucursal
                ORDER BY e.id_empleado DESC
            `);
            return res.json(rows);
        }

        // --- OBTENER MÉDICOS ---
        if (action === 'get_medicos') {
            const [rows] = await dbp.query(`
                SELECT m.id_medico, m.Cedula_profesional AS cedula_profesional,
                       m.Especialidad AS especialidad, m.Estado,
                       e.id_empleado, p.Nombre AS nombre, p.Apellido_Paterno AS apellido_paterno,
                       p.Apellidos_Materno AS apellido_materno, p.Celular AS celular,
                       s.Nombre_sucursal
                FROM medicos m
                INNER JOIN empleados e ON e.id_empleado = m.id_empleado
                INNER JOIN personas p ON p.id_persona = e.id_persona
                LEFT JOIN sucursales s ON s.id_sucursal = e.id_sucursal
                ORDER BY m.id_medico DESC
            `);
            return res.json(rows);
        }

        // Si la acción no existe
        return res.status(404).json({ error: 'Acción GET no válida' });

    } catch (error) {
        console.error('Error en GET /api/admin:', error);
        return res.status(500).json({ error: error.message });
    }
});

// =========================================================
// INICIAR SERVIDOR
// =========================================================
app.listen(PORT, () => {

    console.log(`🚀 Servidor Backend corriendo en http://localhost:${PORT}`);
    console.log(`☁️ Base de datos: TiDB Cloud`);
    console.log(`💳 Mercado Pago configurado.`);
});