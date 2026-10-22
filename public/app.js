const API_URL = 'http://localhost:3000';
const SESSION_ID = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

let servicios = [];
let filtroActivo = "Todos";
let mesActual = new Date().getMonth();
let anioActual = new Date().getFullYear();
let diaSeleccionado = null;
let disponibilidadMes = {};
let citaPendiente = null;
let reservaTemporal = null;

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const HORARIOS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","14:00","14:30","15:00","15:30","16:00","16:30","17:00"];

// ==========================================
// NAVEGACIÓN Y SESIÓN
// ==========================================
function navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');
    
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const link = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (link) link.classList.add('active');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleMenu() { document.getElementById('menu-mobile').classList.toggle('active'); }

function irAAgenda() {
    const usuario = obtenerSesion();
    if (!usuario) { 
        mostrarMensaje('error', '🔒 Inicia sesión para poder agendar una cita.');
        navigate('login'); 
        return; 
    }
    navigate('agenda');
    setTimeout(() => cargarCalendario(), 100);
}

function validarIrAAgenda() {
    const usuario = obtenerSesion();
    if (!usuario) {
        mostrarMensaje('error', '🔒 Inicia sesión para agendar tu cita.');
        navigate('login');
    } else {
        irAAgenda();
    }
}

function irAMiCuenta() {
    const usuario = obtenerSesion();
    if (!usuario) { navigate('login'); return; }
    
    if (usuario.rol === 'admin') {
        navigate('dashboard-admin');
        cargarDashboardAdmin();
    } else if (usuario.rol === 'empleado') {
        navigate('dashboard-empleado');
        cargarDashboardEmpleado();
    } else {
        navigate('dashboard-cliente');
        cargarDashboardCliente();
    }
}

function guardarSesion(u) { localStorage.setItem('usuario', JSON.stringify(u)); }
function obtenerSesion() {
    const d = localStorage.getItem('usuario');
    return d ? JSON.parse(d) : null;
}

function cerrarSesion() {
    mostrarConfirmacion(
        'Cerrar Sesión', 
        '¿Estás segura que quieres salir de tu cuenta?', 
        '👋', 
        () => {
            localStorage.removeItem('usuario');
            actualizarBotonLogin();
            navigate('inicio');
            mostrarMensaje('exito', '👋 Sesión cerrada.');
        }
    );
}

function actualizarBotonLogin() {
    const u = obtenerSesion();
    const btnLogin = document.getElementById('btn-login-nav');
    const btnMiCuenta = document.getElementById('btn-mi-cuenta');
    const btnLogout = document.getElementById('btn-logout-nav');
    const btnAgendarTop = document.getElementById('btn-agendar-nav');
    const aviso = document.getElementById('aviso-login');
    
    if (u) {
        if (btnLogin) btnLogin.style.display = 'none';
        if (btnMiCuenta) btnMiCuenta.style.display = 'block';
        if (btnLogout) btnLogout.style.display = 'block';
        if (btnAgendarTop) btnAgendarTop.style.display = 'block';
        if (aviso) aviso.style.display = 'none';
    } else {
        if (btnLogin) btnLogin.style.display = 'block';
        if (btnMiCuenta) btnMiCuenta.style.display = 'none';
        if (btnLogout) btnLogout.style.display = 'none';
        if (btnAgendarTop) btnAgendarTop.style.display = 'none';
        if (aviso && localStorage.getItem('aviso_cerrado') !== 'true') aviso.style.display = 'flex';
    }
}

// ==========================================
// MODALES Y AVISOS
// ==========================================
function cerrarAviso() {
    const aviso = document.getElementById('aviso-login');
    if (aviso) { aviso.style.display = 'none'; localStorage.setItem('aviso_cerrado', 'true'); }
}

function mostrarModalLogin() {
    const modal = document.createElement('div');
    modal.className = 'modal-login';
    modal.innerHTML = `
        <div class="modal-contenido">
            <div class="modal-icono">🔒</div>
            <h2>Inicia sesión para continuar</h2>
            <p>Para agendar tu cita necesitas tener una cuenta. Es rápido y gratis.</p>
            <div class="modal-botones">
                <button class="btn-primary" onclick="navigate('login'); cerrarModal();">Iniciar Sesión</button>
                <button class="btn-secondary" onclick="navigate('registro'); cerrarModal();">Crear Cuenta</button>
            </div>
            <button class="modal-cerrar" onclick="cerrarModal()">✕</button>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });
}

function cerrarModal() {
    const modal = document.querySelector('.modal-login');
    if (modal) modal.remove();
}

// MODAL DE CONFIRMACIÓN ELEGANTE (Reemplaza a confirm())
function mostrarConfirmacion(titulo, mensaje, icono, callback) {
    document.getElementById('confirm-titulo').textContent = titulo;
    document.getElementById('confirm-mensaje').textContent = mensaje;
    document.getElementById('confirm-icono').textContent = icono;
    
    const btn = document.getElementById('btn-confirmar-accion');
    
    // Remover eventos anteriores clonando el botón
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    // Agregar el nuevo evento
    newBtn.addEventListener('click', () => {
        cerrarConfirmacion();
        callback();
    });

    document.getElementById('modal-confirmacion').classList.add('activo');
}

function cerrarConfirmacion() {
    document.getElementById('modal-confirmacion').classList.remove('activo');
}

function abrirTerminos() { document.getElementById('modal-terminos').classList.add('activo'); }
function cerrarTerminos() { document.getElementById('modal-terminos').classList.remove('activo'); }
function abrirPrivacidad() { document.getElementById('modal-privacidad').classList.add('activo'); }
function cerrarPrivacidad() { document.getElementById('modal-privacidad').classList.remove('activo'); }

function mostrarMensaje(tipo, texto) {
    const div = document.getElementById('mensaje');
    div.className = tipo;
    div.innerHTML = texto;
    div.style.display = 'block';
    setTimeout(() => { div.style.display = 'none'; }, 6000);
}

// ==========================================
// CARGAR SERVICIOS Y CATÁLOGO
// ==========================================
function cargarServicios() {
    fetch(`${API_URL}/api/servicios`)
        .then(res => res.json())
        .then(data => {
            servicios = data;
            renderizarServiciosPreview();
            renderizarCatalogo();
        })
        .catch(err => console.error("Error:", err));
}

function renderizarServiciosPreview() {
    const cont = document.getElementById('services-preview');
    if (!cont) return;
    cont.innerHTML = servicios.slice(0, 3).map(s => {
        let cat = "Facial";
        if (s.nombre.includes("Ácido")) cat = "Rellenos";
        if (s.nombre.includes("Bioestimulación")) cat = "Regeneración";
        return `
            <div class="service-preview-card">
                <span class="service-categoria">${cat}</span>
                <h3 class="service-nombre">${s.nombre}</h3>
                <div class="service-footer">
                    <span class="service-precio">$${s.precio}</span>
                    <span class="service-duracion">${s.duracion} min</span>
                </div>
            </div>`;
    }).join('');
}

function renderizarCatalogo() {
    const cont = document.getElementById('catalogo-grid');
    if (!cont) return;
    const filtrados = filtroActivo === "Todos" ? servicios : servicios.filter(s => {
        if (filtroActivo === "Facial") return s.nombre.includes("Botox") || s.nombre.includes("Lifting");
        if (filtroActivo === "Rellenos") return s.nombre.includes("Ácido");
        if (filtroActivo === "Regeneración") return s.nombre.includes("Bioestimulación");
        return false;
    });
    cont.innerHTML = filtrados.map(s => `
        <div class="catalogo-card">
            <div class="catalogo-card-header">
                <span class="catalogo-categoria">${s.nombre.includes("Botox") ? "Facial" : s.nombre.includes("Ácido") ? "Rellenos" : "Regeneración"}</span>
                <span class="catalogo-duracion">${s.duracion} min</span>
            </div>
            <h3 class="catalogo-nombre">${s.nombre}</h3>
            <div class="catalogo-footer">
                <span class="catalogo-precio">$${s.precio}</span>
                <button onclick="validarIrAAgenda()">Agendar →</button>
            </div>
        </div>`).join('');
}

document.querySelectorAll('.filtro').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filtro').forEach(b => b.classList.remove('activo'));
        btn.classList.add('activo');
        filtroActivo = btn.dataset.categoria;
        renderizarCatalogo();
    });
});

// ==========================================
// SERVICIOS CLÍNICOS
// ==========================================
const serviciosClinicos = [
    { num: "01", title: "Evaluación Inicial", desc: "Consulta de diagnóstico con la Dra.", includes: ["Diagnóstico facial", "Fotografía clínica", "Plan personalizado"] },
    { num: "02", title: "Tratamientos Faciales", desc: "Procedimientos no invasivos.", includes: ["Botox", "Rellenos", "Bioestimuladores"] },
    { num: "03", title: "Rejuvenecimiento", desc: "Protocolos integrales.", includes: ["Global Face", "Harmonización", "Peeling médico"] },
    { num: "04", title: "Seguimiento Clínico", desc: "Acompañamiento continuo.", includes: ["Revisión 15 días", "Control fotográfico", "Ajustes"] }
];

function renderizarServiciosClinicos() {
    const cont = document.getElementById('servicios-grid');
    if (!cont) return;
    cont.innerHTML = serviciosClinicos.map(s => `
        <div class="servicio-card">
            <span class="servicio-num">${s.num}</span>
            <h3 class="servicio-titulo">${s.title}</h3>
            <p class="servicio-desc">${s.desc}</p>
            <ul class="servicio-lista">${s.includes.map(i => `<li>${i}</li>`).join('')}</ul>
        </div>`).join('');
}

// ==========================================
// CALENDARIO Y DISPONIBILIDAD
// ==========================================
function cargarCalendario() {
    const sucursal = document.getElementById('select-sucursal-cal')?.value || '';
    const mes = String(mesActual + 1).padStart(2, '0');
    fetch(`${API_URL}/api/disponibilidad/mes/${anioActual}/${mes}${sucursal ? '?id_sucursal=' + sucursal : ''}`)
        .then(res => res.json())
        .then(data => { disponibilidadMes = data.disponibilidad || {}; renderizarCalendario(); })
        .catch(() => renderizarCalendario());
}

function renderizarCalendario() {
    document.getElementById('calendario-titulo').textContent = `${MESES[mesActual]} ${anioActual}`;
    const grid = document.getElementById('calendario-grid');
    grid.innerHTML = '';
    const primerDia = new Date(anioActual, mesActual, 1).getDay();
    const inicio = primerDia === 0 ? 6 : primerDia - 1;
    const dias = new Date(anioActual, mesActual + 1, 0).getDate();
    const hoy = new Date(); hoy.setHours(0,0,0,0);

    for (let i = 0; i < inicio; i++) grid.innerHTML += `<div class="dia-cal vacio"></div>`;
    for (let dia = 1; dia <= dias; dia++) {
        const fecha = `${anioActual}-${String(mesActual + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        const fechaObj = new Date(anioActual, mesActual, dia);
        const pasado = fechaObj < hoy;
        const tieneDisp = disponibilidadMes[fecha] !== undefined;
        let clases = 'dia-cal';
        if (pasado) clases += ' pasado';
        else if (tieneDisp) clases += ' disponible';
        if (diaSeleccionado === fecha) clases += ' seleccionado';
        grid.innerHTML += `
            <div class="${clases}" onclick="${!pasado ? `seleccionarDia('${fecha}')` : ''}">
                ${dia}
                ${tieneDisp && !pasado ? '<span class="punto"></span>' : ''}
            </div>`;
    }
}

function cambiarMes(delta) {
    mesActual += delta;
    if (mesActual < 0) { mesActual = 11; anioActual--; }
    if (mesActual > 11) { mesActual = 0; anioActual++; }
    diaSeleccionado = null;
    document.getElementById('panel-disponibilidad').style.display = 'none';
    cargarCalendario();
}

function seleccionarDia(fecha) {
    const usuario = obtenerSesion();
    if (!usuario) { mostrarModalLogin(); return; }
    diaSeleccionado = fecha;
    renderizarCalendario();
    const sucursal = document.getElementById('select-sucursal-cal')?.value || '';
    fetch(`${API_URL}/api/disponibilidad/${fecha}${sucursal ? '?id_sucursal=' + sucursal : ''}`)
        .then(res => res.json())
        .then(data => mostrarDisponibilidad(data))
        .catch(err => console.error(err));
}

function mostrarDisponibilidad(data) {
    const panel = document.getElementById('panel-disponibilidad');
    const titulo = document.getElementById('fecha-seleccionada');
    const cont = document.getElementById('especialistas-container');
    const [anio, mes, dia] = data.fecha.split('-');
    titulo.textContent = `📅 ${dia} de ${MESES[parseInt(mes) - 1]} de ${anio}`;
    if (data.especialistas.length === 0) {
        cont.innerHTML = '<p style="color:#888;">No hay especialistas.</p>';
        panel.style.display = 'block';
        return;
    }
    cont.innerHTML = data.especialistas.map(emp => {
        const inicial = emp.nombre.charAt(0).toUpperCase();
        const ocupados = emp.horarios_ocupados || [];
        const horariosHTML = HORARIOS.map(h => {
            const ocupado = ocupados.some(hora => hora.startsWith(h));
            return `<button class="horario-btn ${ocupado ? 'ocupado' : ''}" ${ocupado ? 'disabled' : ''} onclick="seleccionarHorario(${emp.id_usuario}, '${emp.nombre} ${emp.apellido_paterno}', '${h}')">${h}</button>`;
        }).join('');
        return `
            <div class="especialista-card">
                <div class="especialista-header">
                    <div class="especialista-avatar">${inicial}</div>
                    <div class="especialista-info">
                        <h3>${emp.nombre} ${emp.apellido_paterno}</h3>
                        <p>Sucursal ${emp.sucursal}</p>
                    </div>
                </div>
                <div class="horarios-grid">${horariosHTML}</div>
            </div>`;
    }).join('');
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth' });
}

// ==========================================
// NUEVO MODAL DE RESERVA
// ==========================================
function seleccionarHorario(idEmp, nombreEmp, hora) {
    document.querySelectorAll('.horario-btn').forEach(b => b.classList.remove('seleccionado'));
    event.target.classList.add('seleccionado');
    
    reservaTemporal = { idEmp, nombreEmp, hora };
    
    document.getElementById('reserva-empleado').textContent = nombreEmp;
    document.getElementById('reserva-hora').textContent = hora;
    
    const select = document.getElementById('reserva-servicio');
    select.innerHTML = '<option value="">-- Elige un tratamiento --</option>';
    servicios.forEach(s => {
        select.innerHTML += `<option value="${s.id_servicio}">${s.nombre} - $${s.precio}</option>`;
    });
    
    document.getElementById('modal-reserva').classList.add('activo');
}

function cerrarModalReserva() {
    document.getElementById('modal-reserva').classList.remove('activo');
    document.querySelectorAll('.horario-btn').forEach(b => b.classList.remove('seleccionado'));
}

function confirmarReserva() {
    const servicioId = document.getElementById('reserva-servicio').value;
    const edad = document.getElementById('reserva-edad').value;
    
    if (!servicioId || !edad) {
        alert("Por favor, selecciona un tratamiento y escribe tu edad.");
        return;
    }
    
    document.getElementById('modal-reserva').classList.remove('activo');
    agendarCita(reservaTemporal.idEmp, reservaTemporal.hora, parseInt(servicioId), parseInt(edad));
}

// ==========================================
// AGENDAR Y PAGAR
// ==========================================
function agendarCita(idEmp, hora, idServicio, edad) {
    const usuario = obtenerSesion();
    if (!usuario) { mostrarModalLogin(); return; }

    const servicio = servicios.find(s => s.id_servicio === idServicio);
    if (!servicio) { mostrarMensaje('error', '❌ Servicio no encontrado.'); return; }

    const precioTotal = servicio.precio;
    const deposito = Math.round(precioTotal * 0.20);

    citaPendiente = {
        id_cliente: usuario.id_usuario,
        id_servicio: idServicio,
        id_sucursal: 1,
        id_empleado: idEmp,
        id_usuario: usuario.id_usuario,
        fecha_cita: `${diaSeleccionado} ${hora}`,
        edad_cliente: edad,
        notas: null,
        nombre_servicio: servicio.nombre,
        precio_total: precioTotal,
        deposito: deposito
    };

    document.getElementById('dep-servicio').textContent = servicio.nombre;
    document.getElementById('dep-total').textContent = `$${precioTotal.toLocaleString()}`;
    document.getElementById('dep-monto').textContent = `$${deposito.toLocaleString()}`;
    document.getElementById('modal-deposito').classList.add('activo');
}

function cerrarDeposito() {
    document.getElementById('modal-deposito').classList.remove('activo');
    citaPendiente = null;
    document.querySelectorAll('.horario-btn').forEach(b => b.classList.remove('seleccionado'));
}

function confirmarDeposito() {
    if (!citaPendiente) return;

    fetch(`${API_URL}/api/citas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(citaPendiente)
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            mostrarMensaje('error', '❌ ' + data.error);
            cerrarDeposito();
            return;
        }

        localStorage.setItem('cita_pendiente_id', data.id_cita);
        localStorage.setItem('cita_pendiente_deposito', data.deposito);

        fetch(`${API_URL}/api/pagos/crear-preferencia`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_cita: data.id_cita,
                monto: data.deposito,
                nombre_servicio: citaPendiente.nombre_servicio,
                email_cliente: obtenerSesion()?.email
            })
        })
        .then(res => res.json())
        .then(pagoData => {
            if (pagoData.error) {
                mostrarMensaje('error', '❌ ' + pagoData.error);
                return;
            }
            cerrarDeposito();
            window.location.href = pagoData.init_point || pagoData.sandbox_init_point;
        })
        .catch(err => {
            console.error('Error:', err);
            mostrarMensaje('error', '❌ Error al iniciar el pago.');
        });
    })
    .catch(err => {
        console.error(err);
        mostrarMensaje('error', '❌ Error al agendar la cita.');
    });
}

function resetAgenda() {
    diaSeleccionado = null;
    document.querySelectorAll('.agenda-mode').forEach(m => m.classList.remove('active'));
    document.getElementById('agenda-select').classList.add('active');
    document.getElementById('panel-disponibilidad').style.display = 'none';
    cargarCalendario();
}

// ==========================================
// LOGIN Y REGISTRO
// ==========================================
document.getElementById('form-login')?.addEventListener('submit', (e) => {
    e.preventDefault();
    fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: document.getElementById('login-email').value,
            password: document.getElementById('login-password').value
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            mostrarMensaje('error', '❌ ' + data.error);
        } else {
            guardarSesion(data.usuario);
            actualizarBotonLogin();
            mostrarMensaje('exito', `✅ Bienvenido/a, ${data.usuario.nombre}`);
            
            // Verificamos si el usuario necesita vincular Google Calendar
            if (!data.tiene_google_calendar && data.usuario.rol === 'cliente') {
                mostrarMensaje('exito', '⏳ Conectando con Google Calendar...');
                vincularGoogleCalendarSilencioso(data.usuario.id_usuario);
            } else {
                redirigirSegunRol(data.usuario.rol);
            }
        }
    });
});

document.getElementById('form-registro')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!document.getElementById('acepto-terminos').checked) {
        mostrarMensaje('error', '❌ Debes aceptar los Términos y Condiciones.');
        return;
    }
    const p1 = document.getElementById('reg-password').value;
    const p2 = document.getElementById('reg-password-confirm').value;
    if (p1 !== p2) { mostrarMensaje('error', '❌ Las contraseñas no coinciden.'); return; }

    fetch(`${API_URL}/api/registro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nombre: document.getElementById('reg-nombre').value.trim(),
            apellido_paterno: document.getElementById('reg-apellido-paterno').value.trim(),
            apellido_materno: document.getElementById('reg-apellido-materno').value.trim(),
            email: document.getElementById('reg-email').value.trim(),
            telefono: document.getElementById('reg-telefono').value.trim(),
            fecha_nacimiento: document.getElementById('reg-fecha-nacimiento').value,
            password: p1,
            metodo_registro: 'local',
            acepto_terminos: true
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.errores) mostrarMensaje('error', '❌ ' + data.errores.join('<br>❌ '));
        else if (data.error) mostrarMensaje('error', '❌ ' + data.error);
        else {
            guardarSesion(data.usuario);
            actualizarBotonLogin();
            mostrarMensaje('exito', `✅ ¡Bienvenido/a, ${data.usuario.nombre}!`);
            
            // Al registrarse, también lo mandamos a vincular Google Calendar
            mostrarMensaje('exito', '⏳ Conectando con Google Calendar...');
            vincularGoogleCalendarSilencioso(data.usuario.id_usuario);
        }
    });
});

// REGISTRO CON GOOGLE (Sin el prompt feo)
function registroConGoogle() {
    // Simulamos que Google ya nos dio el correo
    const email = "usuario_google@almaestetica.com";
    const nombre = "Usuario Google";

    fetch(`${API_URL}/api/login-google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, nombre, google_id: "google_" + Date.now() })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            mostrarMensaje('error', '❌ ' + data.error);
        } else {
            guardarSesion(data.usuario);
            actualizarBotonLogin();
            mostrarMensaje('exito', `✅ Sesión iniciada con Google.`);
            
            // Lo mandamos directo a la pantalla real de permisos de Google Calendar
            mostrarMensaje('exito', '⏳ Conectando con Google Calendar...');
            vincularGoogleCalendarSilencioso(data.usuario.id_usuario);
        }
    })
    .catch(err => {
        console.error('Error:', err);
        mostrarMensaje('error', '❌ Error al conectar con Google.');
    });
}

// Funciones de ayuda para el login
function redirigirSegunRol(rol) {
    if (rol === 'admin') { navigate('dashboard-admin'); cargarDashboardAdmin(); }
    else if (rol === 'empleado') { navigate('dashboard-empleado'); cargarDashboardEmpleado(); }
    else { navigate('dashboard-cliente'); cargarDashboardCliente(); }
}

function vincularGoogleCalendarSilencioso(idUsuario) {
    fetch(`${API_URL}/api/auth/google?id_usuario=${idUsuario}`)
        .then(res => res.json())
        .then(data => {
            // Redirigimos al usuario a la pantalla de Google
            window.location.href = data.url;
        })
        .catch(err => {
            console.error('Error con Google:', err);
            mostrarMensaje('error', '❌ No se pudo conectar con Google Calendar.');
            redirigirSegunRol('cliente');
        });
}

document.getElementById('reg-telefono')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});

// ==========================================
// DASHBOARDS
// ==========================================
function cargarDashboardCliente() {
    const u = obtenerSesion();
    if (!u || u.rol !== 'cliente') { navigate('login'); return; }
    document.getElementById('cli-nombre').textContent = u.nombre;
    fetch(`${API_URL}/api/historial/${u.id_usuario}`)
        .then(res => res.json())
        .then(citas => {
            document.getElementById('cli-total').textContent = citas.length;
            document.getElementById('cli-pendientes').textContent = citas.filter(c => c.status_pago === 'pendiente' && c.estado !== 'cancelada').length;
            document.getElementById('cli-completadas').textContent = citas.filter(c => c.estado === 'completada' || c.deposito_pagado === 1).length;
            const total = citas.filter(c => c.deposito_pagado === 1).reduce((s, c) => s + (c.deposito || 0), 0);
            document.getElementById('cli-gastado').textContent = `$${total.toLocaleString()}`;
            const cont = document.getElementById('cli-citas');
            if (citas.length === 0) {
                cont.innerHTML = '<p style="padding:20px;text-align:center;color:#888;">Aún no tienes citas.</p>';
                return;
            }
            cont.innerHTML = `<table><thead><tr><th>ID</th><th>Servicio</th><th>Especialista</th><th>Fecha</th><th>Depósito</th><th>Status</th><th>Acciones</th></tr></thead><tbody>${citas.map(c => `
                <tr>
                    <td>#${c.id_cita}</td>
                    <td>${c.servicio_nombre || 'N/A'}</td>
                    <td>${c.empleado_nombre || 'Por asignar'}</td>
                    <td>${c.fecha_cita || '-'}</td>
                    <td>${c.deposito_pagado ? `$${c.deposito} ✅` : `$${c.deposito} ⏳`}</td>
                    <td><span class="badge ${c.status_pago}">${c.status_pago}</span></td>
                    <td>${c.estado !== 'cancelada' && c.status_pago === 'pendiente' ? `<button class="btn-accion cancelar" onclick="cancelarCita(${c.id_cita})">Cancelar</button>` : ''}</td>
                </tr>`).join('')}</tbody></table>`;
        });
}

function cancelarCita(id) {
    mostrarConfirmacion(
        'Cancelar Cita', 
        '¿Estás segura que deseas cancelar esta cita? El depósito no es reembolsable si faltan menos de 24 horas.', 
        '❌', 
        () => {
            fetch(`${API_URL}/api/citas/${id}`, { method: 'DELETE' })
                .then(res => res.json())
                .then(data => {
                    if (data.error) mostrarMensaje('error', '❌ ' + data.error);
                    else { mostrarMensaje('exito', '✅ Cita cancelada.'); cargarDashboardCliente(); }
                });
        }
    );
}

function verHistorialTratamientos() {
    const usuario = obtenerSesion();
    if (!usuario) { navigate('login'); return; }
    fetch(`${API_URL}/api/historial/${usuario.id_usuario}`)
        .then(res => res.json())
        .then(citas => {
            const completadas = citas.filter(c => c.deposito_pagado === 1 || c.estado === 'completada');
            if (completadas.length === 0) {
                mostrarMensaje('error', '📋 Aún no tienes tratamientos completados.');
                return;
            }
            alert(`📋 HISTORIAL DE TRATAMIENTOS\n\nTotal: ${completadas.length} tratamiento(s)\n\n${completadas.map(c => `• ${c.servicio_nombre} - ${c.fecha_cita} - $${c.precio_total || c.precio || 0}`).join('\n')}`);
        });
}

function cargarDashboardEmpleado() {
    const u = obtenerSesion();
    if (!u || u.rol !== 'empleado') { navigate('login'); return; }
    document.getElementById('emp-nombre').textContent = u.nombre;
    document.getElementById('emp-sucursal').textContent = u.sucursal;
    fetch(`${API_URL}/api/dashboard/empleado/${u.id_usuario}`)
        .then(res => res.json())
        .then(data => {
            const citas = data.citas || [];
            document.getElementById('emp-total').textContent = citas.length;
            document.getElementById('emp-pendientes').textContent = citas.filter(c => c.status_pago === 'pendiente').length;
            document.getElementById('emp-pagadas').textContent = citas.filter(c => c.status_pago === 'deposito_pagado' || c.status_pago === 'pagado').length;
            document.getElementById('emp-citas').innerHTML = `<table><thead><tr><th>ID</th><th>Servicio</th><th>Fecha</th><th>Precio</th><th>Status</th></tr></thead><tbody>${citas.map(c => `<tr><td>#${c.id_cita}</td><td>${c.servicio_nombre || 'N/A'}</td><td>${c.fecha_cita || '-'}</td><td>$${c.precio || 0}</td><td><span class="badge ${c.status_pago}">${c.status_pago}</span></td></tr>`).join('')}</tbody></table>`;
        });
}

function cargarDashboardAdmin() {
    const u = obtenerSesion();
    if (!u || u.rol !== 'admin') { navigate('login'); return; }
    document.getElementById('admin-nombre').textContent = u.nombre;
    fetch(`${API_URL}/api/dashboard/admin`)
        .then(res => res.json())
        .then(data => {
            const { estadisticas, por_sucursal, citas } = data;
            document.getElementById('admin-total').textContent = estadisticas.total_citas || 0;
            document.getElementById('admin-pendientes').textContent = estadisticas.pendientes || 0;
            document.getElementById('admin-pagadas').textContent = estadisticas.pagadas || 0;
            const ing = (por_sucursal || []).reduce((s, x) => s + (x.ingresos_totales || 0), 0);
            document.getElementById('admin-ingresos').textContent = `$${ing.toLocaleString()}`;
            document.getElementById('admin-sucursales').innerHTML = (por_sucursal || []).map(s => `
                <div class="sucursal-card">
                    <h3>Sucursal #${s.id_sucursal}</h3>
                    <div class="sucursal-stat"><span>Total citas</span><span>${s.total_citas}</span></div>
                    <div class="sucursal-stat"><span>Ingresos</span><span>$${(s.ingresos_totales || 0).toLocaleString()}</span></div>
                </div>`).join('');
            document.getElementById('admin-citas').innerHTML = `<table><thead><tr><th>ID</th><th>Servicio</th><th>Sucursal</th><th>Fecha</th><th>Precio</th><th>Status</th></tr></thead><tbody>${(citas || []).map(c => `<tr><td>#${c.id_cita}</td><td>${c.servicio_nombre || 'N/A'}</td><td>#${c.id_sucursal || '-'}</td><td>${c.fecha_cita || '-'}</td><td>$${c.precio || 0}</td><td><span class="badge ${c.status_pago}">${c.status_pago}</span></td></tr>`).join('')}</tbody></table>`;
        });
}

// ==========================================
// CMS (PANEL DE CONTROL WEB)
// ==========================================
function abrirGestorWeb() {
    navigate('admin-cms');
    cargarServiciosAdmin();
    cargarTextosWeb();
}

function cambiarTabCMS(tab) {
    document.querySelectorAll('.cms-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.cms-menu-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`cms-tab-${tab}`).classList.add('active');
    document.getElementById(`menu-btn-${tab}`).classList.add('active');
}

function cargarServiciosAdmin() {
    fetch(`${API_URL}/api/servicios`)
        .then(res => res.json())
        .then(servicios => {
            const lista = document.getElementById('admin-lista-servicios');
            if (servicios.length === 0) {
                lista.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #888;">No hay servicios activos.</p>';
                return;
            }
            lista.innerHTML = servicios.map(s => `
                <div class="cms-servicio-card">
                    <div class="cms-card-body">
                        <h3>${s.nombre}</h3>
                        <div class="cms-card-details">
                            <span class="cms-price">$${s.precio}</span>
                            <span class="cms-time">⏱ ${s.duracion} min</span>
                        </div>
                    </div>
                    <div class="cms-card-actions">
                        <button class="btn-edit" onclick="editarServicioAdmin(${s.id_servicio}, '${s.nombre}', ${s.precio}, ${s.duracion})">✏️ Editar</button>
                        <button class="btn-delete" onclick="eliminarServicioAdmin(${s.id_servicio})">🗑️ Borrar</button>
                    </div>
                </div>
            `).join('');
        });
}

function editarServicioAdmin(id, nombre, precio, duracion) {
    document.getElementById('edit-serv-id').value = id;
    document.getElementById('edit-serv-nombre').value = nombre;
    document.getElementById('edit-serv-precio').value = precio;
    document.getElementById('edit-serv-duracion').value = duracion;
    document.getElementById('modal-editar').classList.add('activo');
}

function cerrarModalEditar() {
    document.getElementById('modal-editar').classList.remove('activo');
}

function guardarEdicionServicio(event) {
    event.preventDefault();
    const usuario = obtenerSesion();
    const id = document.getElementById('edit-serv-id').value;
    const nombre = document.getElementById('edit-serv-nombre').value;
    const precio = parseInt(document.getElementById('edit-serv-precio').value);
    const duracion = parseInt(document.getElementById('edit-serv-duracion').value);

    fetch(`${API_URL}/api/admin/servicios/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_usuario: usuario.id_usuario, nombre, precio, duracion })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) mostrarMensaje('error', '❌ ' + data.error);
        else {
            mostrarMensaje('exito', '✅ Servicio actualizado');
            cerrarModalEditar();
            cargarServiciosAdmin();
            cargarServicios();
        }
    });
}

function eliminarServicioAdmin(id) {
    mostrarConfirmacion(
        'Eliminar Servicio', 
        '¿Estás segura que quieres eliminar este servicio? Dejará de aparecer en la página web.', 
        '🗑️', 
        () => {
            const usuario = obtenerSesion();
            fetch(`${API_URL}/api/admin/servicios/${id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_usuario: usuario.id_usuario })
            })
            .then(res => res.json())
            .then(data => {
                if (data.error) mostrarMensaje('error', '❌ ' + data.error);
                else {
                    mostrarMensaje('exito', '✅ Servicio eliminado');
                    cargarServiciosAdmin();
                    cargarServicios();
                }
            });
        }
    );
}

function agregarNuevoServicio(event) {
    event.preventDefault();
    const usuario = obtenerSesion();
    const datos = {
        id_usuario: usuario.id_usuario,
        nombre: document.getElementById('new-serv-nombre').value,
        precio: parseInt(document.getElementById('new-serv-precio').value),
        duracion: parseInt(document.getElementById('new-serv-duracion').value)
    };

    fetch(`${API_URL}/api/admin/servicios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos)
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) mostrarMensaje('error', '❌ ' + data.error);
        else {
            mostrarMensaje('exito', '✅ Servicio agregado correctamente');
            document.getElementById('form-add-servicio').reset();
            document.getElementById('form-add-servicio').style.display = 'none';
            cargarServiciosAdmin();
            cargarServicios();
        }
    });
}

function cargarTextosWeb() {
    fetch(`${API_URL}/api/config`)
        .then(res => res.json())
        .then(config => {
            document.getElementById('cfg-hero_subtitulo').value = config.hero_subtitulo || '';
            document.getElementById('cfg-hero_titulo').value = config.hero_titulo || '';
            document.getElementById('cfg-hero_descripcion').value = config.hero_descripcion || '';
        });
}

function guardarTextosWeb(event) {
    event.preventDefault();
    const usuario = obtenerSesion();
    const nuevaConfig = {
        hero_subtitulo: document.getElementById('cfg-hero_subtitulo').value,
        hero_titulo: document.getElementById('cfg-hero_titulo').value,
        hero_descripcion: document.getElementById('cfg-hero_descripcion').value
    };

    fetch(`${API_URL}/api/admin/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_usuario: usuario.id_usuario, config: nuevaConfig })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) mostrarMensaje('error', '❌ ' + data.error);
        else {
            mostrarMensaje('exito', '✅ Textos guardados correctamente');
            document.getElementById('txt-hero-subtitulo').innerText = nuevaConfig.hero_subtitulo;
            document.getElementById('txt-hero-titulo').innerHTML = nuevaConfig.hero_titulo;
            document.getElementById('txt-hero-descripcion').innerText = nuevaConfig.hero_descripcion;
        }
    });
}

// ==========================================
// CHATBOT
// ==========================================
const chatbotToggle = document.getElementById('chatbot-toggle');
const chatbotWindow = document.getElementById('chatbot-window');
const chatbotClose = document.getElementById('chatbot-close');
const chatbotSend = document.getElementById('chatbot-send');
const chatbotInput = document.getElementById('chatbot-input');
const chatbotMessages = document.getElementById('chatbot-messages');

chatbotToggle?.addEventListener('click', () => chatbotWindow.classList.toggle('activo'));
chatbotClose?.addEventListener('click', () => chatbotWindow.classList.remove('activo'));

function enviarMensajeChatbot() {
    const texto = chatbotInput.value.trim();
    if (!texto) return;
    chatbotMessages.innerHTML += `<div class="chat-msg user"><div class="chat-bubble">${texto}</div></div>`;
    chatbotInput.value = '';
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
    fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: texto, sessionId: SESSION_ID })
    })
    .then(res => res.json())
    .then(data => {
        chatbotMessages.innerHTML += `<div class="chat-msg bot"><div class="chat-bubble">${data.respuesta}</div></div>`;
        chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
    })
    .catch(() => {
        chatbotMessages.innerHTML += `<div class="chat-msg bot"><div class="chat-bubble">Lo siento, hubo un error.</div></div>`;
    });
}

chatbotSend?.addEventListener('click', enviarMensajeChatbot);
chatbotInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') enviarMensajeChatbot(); });

// ==========================================
// INICIALIZACIÓN Y ATAJOS
// ==========================================
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        cerrarTerminos();
        cerrarPrivacidad();
        cerrarDeposito();
        cerrarModalEditar();
        cerrarModalReserva();
        cerrarConfirmacion();
        cerrarModal();
    }
});

document.getElementById('modal-terminos')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-terminos') cerrarTerminos();
});
document.getElementById('modal-privacidad')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-privacidad') cerrarPrivacidad();
});
document.getElementById('modal-deposito')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-deposito') cerrarDeposito();
});
document.getElementById('modal-editar')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-editar') cerrarModalEditar();
});
document.getElementById('modal-reserva')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-reserva') cerrarModalReserva();
});
document.getElementById('modal-confirmacion')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-confirmacion') cerrarConfirmacion();
});

document.addEventListener('DOMContentLoaded', () => {
    cargarServicios();
    renderizarServiciosClinicos();
    actualizarBotonLogin();

    // Cargar textos editables
    fetch(`${API_URL}/api/config`)
        .then(res => res.json())
        .then(config => {
            if (config.hero_subtitulo) document.getElementById('txt-hero-subtitulo').innerText = config.hero_subtitulo;
            if (config.hero_titulo) document.getElementById('txt-hero-titulo').innerHTML = config.hero_titulo;
            if (config.hero_descripcion) document.getElementById('txt-hero-descripcion').innerText = config.hero_descripcion;
        })
        .catch(err => console.error("Error al cargar configuración:", err));

    // Detectar pago exitoso
    const urlParams = new URLSearchParams(window.location.search);
    const citaId = localStorage.getItem('cita_pendiente_id');
    const deposito = localStorage.getItem('cita_pendiente_deposito');
    const status = urlParams.get('status');
    const paymentId = urlParams.get('payment_id');

    if (citaId && status === 'approved') {
        fetch(`${API_URL}/api/pagos/confirmar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_cita: citaId, payment_id: paymentId, metodo_pago: 'mercadopago' })
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) mostrarMensaje('error', '❌ ' + data.error);
            else {
                mostrarMensaje('exito', `✅ ¡Pago exitoso! Depósito de $${deposito} registrado.`);
                localStorage.removeItem('cita_pendiente_id');
                localStorage.removeItem('cita_pendiente_deposito');
            }
            navigate('dashboard-cliente');
            setTimeout(cargarDashboardCliente, 500);
        })
        .catch(err => {
            console.error(err);
            mostrarMensaje('error', '❌ Error al confirmar el pago.');
            navigate('inicio');
        });
    } else {
        navigate('inicio');
    }
});