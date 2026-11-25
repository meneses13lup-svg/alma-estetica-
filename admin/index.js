const configs = {
    servicios: [
        ['Nombre_servicio', 'Nombre del servicio', 'text', true],
        ['id_categoria', 'Categoría', 'category', true],
        ['Duracion_estimada', 'Duración estimada (minutos)', 'number', true],
        ['Precio', 'Precio (MXN)', 'number', true]
    ],
    categorias: [
        ['nombre', 'Nombre de categoría', 'text', true],
        ['Descripcion', 'Descripción', 'textarea', false]
    ],
    sucursales: [
        ['Nombre_sucursal', 'Nombre de sucursal', 'text', true],
        ['Direccion', 'Dirección', 'text', true],
        ['Telefono', 'Teléfono', 'tel', false],
        ['Horario_atencion', 'Horario de atención', 'text', false]
    ],
    empleados: [
        ['nombre', 'Nombre', 'text', true],
        ['apellido_paterno', 'Apellido paterno', 'text', true],
        ['apellido_materno', 'Apellido materno', 'text', false],
        ['celular', 'Celular', 'tel', true],
        ['email', 'Correo electrónico', 'email', true],
        ['password', 'Contraseña provisional (mínimo 8 caracteres)', 'password', true],
        ['id_rol', 'Rol de acceso', 'role', true],
        ['id_sucursal', 'Sucursal', 'branch', true]
    ],
    medicos: [
        ['nombre', 'Nombre', 'text', true],
        ['apellido_paterno', 'Apellido paterno', 'text', true],
        ['apellido_materno', 'Apellido materno', 'text', false],
        ['celular', 'Celular', 'tel', true],
        ['email', 'Correo electrónico', 'email', true],
        ['password', 'Contraseña provisional (mínimo 8 caracteres)', 'password', true],
        ['id_rol', 'Rol de acceso', 'role', true],
        ['id_sucursal', 'Sucursal', 'branch', true],
        ['cedula_profesional', 'Cédula profesional', 'text', true],
        ['especialidad', 'Especialidad', 'text', true]
    ]
};

const titles = {
    dashboard:'Resumen', servicios:'Servicios y precios', categorias:'Categorías',
    sucursales:'Sucursales', citas:'Citas y agenda', pagos:'Pagos',
    empleados:'Empleados', medicos:'Médicos', clientes:'Clientes',
    historial:'Historial de atención', imagenes:'Imágenes del sitio', usuarios:'Usuarios y roles'
};


// URL del API administrativo de Node.js
const API_URL = 'http://localhost:3000/api/admin';

async function api(action, data = null) {
    const url = `${API_URL}?action=${encodeURIComponent(action)}`;

    const options = {
        method: data !== null ? 'POST' : 'GET',
        headers: {
            'Accept': 'application/json'
        }
    };

    if (data !== null) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(data);
    }

    let response;

    try {
        response = await fetch(url, options);
    } catch (error) {
        throw new Error(
            'No se pudo conectar con el servidor Node.js. Verifica que esté ejecutándose.'
        );
    }

    let result;

    try {
        result = await response.json();
    } catch (error) {
        throw new Error(
            `El servidor no devolvió JSON válido. Código HTTP: ${response.status}`
        );
    }

    if (!response.ok || result.error || result.success === false) {
        throw new Error(
            result.error || result.message || `Error HTTP ${response.status}`
        );
    }

    return Array.isArray(result.data) ? result.data : result;
}


function navigate(page) {
    document.querySelectorAll('.page').forEach(x => x.classList.add('hidden'));
    document.getElementById('page-' + page)?.classList.remove('hidden');
    document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    document.getElementById('topTitle').textContent = titles[page] || page;
    document.getElementById('sidebar').classList.remove('open');

    const loaders = {
        dashboard:cargarDatosDashboard, servicios:cargarServiciosTabla,
        categorias:cargarCategoriasTabla, sucursales:cargarSucursalesTabla,
        empleados:cargarEmpleadosTabla, medicos:cargarMedicosTabla, usuarios:cargarUsuariosRoles
    };
    if (loaders[page]) loaders[page]();
}

document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.page)));
document.getElementById('menuBtn').onclick = () => document.getElementById('sidebar').classList.toggle('open');

async function cargarDatosDashboard() {
    try {
        const s = await api('get_stats');
        document.getElementById('statServices').textContent = s.servicios ?? 0;
        document.getElementById('statBranches').textContent = s.sucursales ?? 0;
        document.getElementById('statStaff').textContent = s.personal ?? 0;
        document.getElementById('statAppointments').textContent = s.citas ?? 0;
        const servicios = await api('get_servicios');
        document.getElementById('recentServices').innerHTML = servicios.slice(0,4).map(x => `
            <div class="recentrow"><div><strong>${esc(x.Nombre_servicio)}</strong>
            <div class="muted">${esc(x.categoria_nombre || 'Sin categoría')}</div></div>
            <strong>$${Number(x.Precio).toFixed(2)}</strong></div>`).join('') || '<div class="empty">Todavía no hay servicios registrados.</div>';
    } catch(e) { toast(e.message, true); }
}

async function cargarServiciosTabla() {
    try {
        const data = await api('get_servicios');
        document.getElementById('table-servicios').innerHTML = data.length ? table(
            ['ID','Servicio','Categoría','Duración','Precio','Estado'],
            data.map(x => [x.id_servicio,esc(x.Nombre_servicio),esc(x.categoria_nombre || 'General'),x.Duracion_estimada+' min','$'+Number(x.Precio).toFixed(2),esc(x.Estado)])
        ) : empty('No hay servicios registrados.');
    } catch(e) { toast(e.message,true); }
}
async function cargarCategoriasTabla() {
    try {
        const data = await api('get_categorias');
        document.getElementById('table-categorias').innerHTML = data.length ? table(['ID','Nombre','Descripción'],data.map(x=>[x.id_categoria,esc(x.nombre),esc(x.Descripcion || '—')])) : empty('No hay categorías registradas.');
    } catch(e) { toast(e.message,true); }
}
async function cargarSucursalesTabla() {
    try {
        const data = await api('get_sucursales');
        document.getElementById('table-sucursales').innerHTML = data.length ? table(['ID','Sucursal','Dirección','Teléfono','Horario'],data.map(x=>[x.id_sucursal,esc(x.Nombre_sucursal),esc(x.Direccion),esc(x.Telefono || '—'),esc(x.Horario_atencion || '—')])) : empty('No hay sucursales registradas.');
    } catch(e) { toast(e.message,true); }
}
async function cargarEmpleadosTabla() {
    try {
        const data = await api('get_empleados');
        document.getElementById('table-empleados').innerHTML = data.length ? table(
            ['ID','Nombre completo','Celular','Correo','Rol','Sucursal','Estado'],
            data.map(x=>[x.id_empleado,esc(`${x.nombre} ${x.apellido_paterno} ${x.apellido_materno || ''}`),esc(x.celular || '—'),esc(x.email),esc(x.rol),esc(x.Nombre_sucursal || '—'),esc(x.Estado_laboral)])
        ) : empty('No hay empleados registrados.');
    } catch(e) { toast(e.message,true); }
}
async function cargarMedicosTabla() {
    try {
        const data = await api('get_medicos');
        document.getElementById('table-medicos').innerHTML = data.length ? table(
            ['ID','Nombre completo','Especialidad','Cédula','Sucursal','Estado'],
            data.map(x=>[x.id_medico,esc(`${x.nombre} ${x.apellido_paterno}`),esc(x.especialidad),esc(x.cedula_profesional),esc(x.Nombre_sucursal || '—'),esc(x.Estado)])
        ) : empty('No hay médicos registrados.');
    } catch(e) { toast(e.message,true); }
}
async function cargarUsuariosRoles() {
    try {
        const [usuarios, roles] = await Promise.all([api('get_usuarios'),api('get_roles')]);
        document.getElementById('table-usuarios').innerHTML = usuarios.length ? table(
            ['ID','Nombre','Correo','Rol','Estado'],
            usuarios.map(x=>[x.id_usuario,esc(`${x.Nombre} ${x.Apellido_Paterno} ${x.Apellidos_Materno || ''}`),esc(x.email),esc(x.Ocupacion),esc(x.estado)])
        ) : empty('No hay usuarios registrados.');
        document.getElementById('table-roles').innerHTML = roles.length ? table(
            ['ID','Rol','Descripción'],
            roles.map(x=>[x.id_rol,esc(x.Ocupacion),esc(x.Descripcion || '—')])
        ) : empty('Todavía no hay roles. Registra los roles iniciales para poder dar de alta empleados.');
    } catch(e) { toast(e.message,true); }
}

function table(headers, rows) {
    return `<div class="tablewrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function empty(msg) { return `<div class="empty">${esc(msg)}</div>`; }

async function openForm(type) {
    if (type === 'roles') return openRoleForm();
    const fields = configs[type];
    if (!fields) { toast('Este formulario todavía no está disponible.', true); return; }

    try {
        const [categorias,sucursales,roles] = await Promise.all([
            type === 'servicios' ? api('get_categorias') : Promise.resolve([]),
            ['empleados','medicos'].includes(type) ? api('get_sucursales') : Promise.resolve([]),
            ['empleados','medicos'].includes(type) ? api('get_roles') : Promise.resolve([])
        ]);
        if (['empleados','medicos'].includes(type) && !roles.length) {
            toast('Primero registra los roles en Usuarios y roles.', true);
            navigate('usuarios');
            return;
        }
        if (['empleados','medicos'].includes(type) && !sucursales.length) {
            toast('Primero registra una sucursal.', true);
            navigate('sucursales');
            return;
        }

        const fieldsHTML = fields.map(([key,label,inputType,required]) => {
            let control = '';
            if (inputType === 'category') control = selectHTML(key,'Seleccione una categoría',categorias,'id_categoria','nombre');
            else if (inputType === 'branch') control = selectHTML(key,'Seleccione una sucursal',sucursales,'id_sucursal','Nombre_sucursal');
            else if (inputType === 'role') control = selectHTML(key,'Seleccione un rol',roles,'id_rol','Ocupacion');
            else if (inputType === 'textarea') control = `<textarea name="${key}" rows="3"></textarea>`;
            else control = `<input name="${key}" type="${inputType}" ${key==='password'?'minlength="8"':''} ${required?'required':''}>`;
            return `<div class="${inputType==='textarea'?'full':''}"><label>${label}${required?' *':''}</label>${control}</div>`;
        }).join('');

        document.getElementById('modalRoot').innerHTML = `
        <div class="modalback" onclick="if(event.target===this)closeModal()"><div class="modal">
            <div class="modalhead"><h2>Registrar ${type==='medicos'?'médico':type==='empleados'?'empleado':type}</h2><button class="xbtn" onclick="closeModal()">✕</button></div>
            <form id="recordForm"><div class="formgrid">${fieldsHTML}</div>
            <div class="modalfoot"><button type="button" class="btn-light" onclick="closeModal()">Cancelar</button><button class="btn-primary" type="submit">Guardar en MySQL</button></div></form>
        </div></div>`;
        document.getElementById('recordForm').onsubmit = async e => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = Object.fromEntries(new FormData(form).entries());
            ['id_categoria','id_sucursal','id_rol','Duracion_estimada'].forEach(k=>{if(data[k])data[k]=Number(data[k]);});
            if(data.Precio) data.Precio=Number(data.Precio);
            if(type==='medicos') data.es_medico=true;
            const submit=form.querySelector('[type=submit]');
            submit.disabled=true; submit.textContent='Guardando...';
            try {
                const action = {servicios:'add_servicio',categorias:'add_categoria',sucursales:'add_sucursal',empleados:'add_usuario_empleado',medicos:'add_usuario_empleado'}[type];
                await api(action,data);
                closeModal(); toast('Registro guardado correctamente.');
                const refresh={servicios:cargarServiciosTabla,categorias:cargarCategoriasTabla,sucursales:cargarSucursalesTabla,empleados:cargarEmpleadosTabla,medicos:cargarMedicosTabla}[type];
                if(refresh) refresh();
                cargarDatosDashboard();
                        } catch(err) {
            console.error('ERROR AL REGISTRAR:', err);
            console.log('DATOS ENVIADOS:', data);

            toast(err.message, true);
            submit.disabled = false;
            submit.textContent = 'Guardar en MySQL';
        }
    };

    } catch(e) {
        console.error('ERROR AL ABRIR FORMULARIO:', e);
        toast(e.message, true);
    }
}

function selectHTML(name,placeholder,items,idField,labelField) {
    return `<select name="${name}" required><option value="">${placeholder}...</option>${items.map(x=>`<option value="${x[idField]}">${esc(x[labelField])}</option>`).join('')}</select>`;
}

async function openRoleForm() {
    document.getElementById('modalRoot').innerHTML = `
    <div class="modalback" onclick="if(event.target===this)closeModal()"><div class="modal">
        <div class="modalhead"><h2>Crear nuevo rol</h2><button class="xbtn" onclick="closeModal()">✕</button></div>
        <form id="roleForm"><div class="formgrid">
            <div class="full"><label>Nombre del rol *</label><input name="Ocupacion" maxlength="100" required placeholder="Ej. Recepcionista"></div>
            <div class="full"><label>Descripción</label><textarea name="Descripcion" rows="3" placeholder="Describe los permisos o responsabilidades del rol"></textarea></div>
        </div><div class="modalfoot"><button type="button" class="btn-light" onclick="closeModal()">Cancelar</button><button class="btn-primary" type="submit">Crear rol</button></div></form>
    </div></div>`;
    document.getElementById('roleForm').onsubmit = async e => {
        e.preventDefault();
        try {
            await api('add_role',Object.fromEntries(new FormData(e.currentTarget).entries()));
            closeModal(); toast('Rol creado correctamente.'); cargarUsuariosRoles();
        } catch(err) { toast(err.message,true); }
    };
}
function closeModal() { document.getElementById('modalRoot').innerHTML=''; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(message,error=false) {
    const root=document.getElementById('toastRoot');
    root.innerHTML=`<div class="toast ${error?'toast-error':''}">${esc(message)}</div>`;
    setTimeout(()=>root.innerHTML='',3500);
}
cargarDatosDashboard();
