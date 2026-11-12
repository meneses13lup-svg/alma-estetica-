<?php
require_once 'conexion.php';

$action = $_GET['action'] ?? '';
$inputData = json_decode(file_get_contents('php://input'), true) ?? [];

function responder($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    switch ($action) {
        case 'get_stats':
            $servicios = $pdo->query("SELECT COUNT(*) FROM Servicios WHERE Estado = 'activo'")->fetchColumn();
            $sucursales = $pdo->query("SELECT COUNT(*) FROM Sucursales")->fetchColumn();
            $empleados = $pdo->query("SELECT COUNT(*) FROM Empleados WHERE Estado_laboral = 'Activo'")->fetchColumn();
            $citas = $pdo->query("SELECT COUNT(*) FROM Citas")->fetchColumn();
            responder(['servicios'=>(int)$servicios, 'sucursales'=>(int)$sucursales, 'personal'=>(int)$empleados, 'citas'=>(int)$citas]);
            break;

        case 'get_sucursales':
            responder($pdo->query("SELECT * FROM Sucursales ORDER BY id_sucursal DESC")->fetchAll());
            break;

        case 'add_sucursal':
            $stmt = $pdo->prepare("INSERT INTO Sucursales (Nombre_sucursal, Direccion, Telefono, Horario_atencion) VALUES (?, ?, ?, ?)");
            $stmt->execute([$inputData['Nombre_sucursal'] ?? '', $inputData['Direccion'] ?? '', $inputData['Telefono'] ?? null, $inputData['Horario_atencion'] ?? null]);
            responder(['success'=>true, 'id'=>$pdo->lastInsertId()]);
            break;

        case 'get_categorias':
            responder($pdo->query("SELECT id_categoria, nombre, Descripcion FROM Categoria_Servicio ORDER BY nombre")->fetchAll());
            break;

        case 'add_categoria':
            $stmt = $pdo->prepare("INSERT INTO Categoria_Servicio (nombre, Descripcion) VALUES (?, ?)");
            $stmt->execute([trim($inputData['nombre'] ?? ''), $inputData['Descripcion'] ?? null]);
            responder(['success'=>true, 'id'=>$pdo->lastInsertId()]);
            break;

        case 'get_servicios':
            $sql = "SELECT s.*, c.nombre AS categoria_nombre
                    FROM Servicios s LEFT JOIN Categoria_Servicio c ON s.id_categoria=c.id_categoria
                    ORDER BY s.id_servicio DESC";
            responder($pdo->query($sql)->fetchAll());
            break;

        case 'add_servicio':
            $stmt = $pdo->prepare("INSERT INTO Servicios (id_categoria, Nombre_servicio, Duracion_estimada, Precio, Estado) VALUES (?, ?, ?, ?, 'activo')");
            $stmt->execute([(int)$inputData['id_categoria'], trim($inputData['Nombre_servicio']), (int)$inputData['Duracion_estimada'], (float)$inputData['Precio']]);
            responder(['success'=>true, 'id'=>$pdo->lastInsertId()]);
            break;

        case 'get_roles':
            responder($pdo->query("SELECT id_rol, Ocupacion, Descripcion FROM Roles ORDER BY Ocupacion")->fetchAll());
            break;

        case 'add_role':
            $ocupacion = trim($inputData['Ocupacion'] ?? '');
            if ($ocupacion === '') responder(['success'=>false, 'error'=>'Escribe el nombre del rol.'], 422);
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM Roles WHERE LOWER(Ocupacion)=LOWER(?)");
            $stmt->execute([$ocupacion]);
            if ($stmt->fetchColumn()) responder(['success'=>false, 'error'=>'Ya existe un rol con ese nombre.'], 409);
            $stmt = $pdo->prepare("INSERT INTO Roles (Ocupacion, Descripcion) VALUES (?, ?)");
            $stmt->execute([$ocupacion, trim($inputData['Descripcion'] ?? '')]);
            responder(['success'=>true, 'id'=>$pdo->lastInsertId()]);
            break;

        case 'get_usuarios':
            $sql = "SELECT l.id_usuario, l.email, l.estado, r.Ocupacion,
                           p.Nombre, p.Apellido_Paterno, p.Apellidos_Materno
                    FROM Login l
                    INNER JOIN Personas p ON p.id_persona=l.id_persona
                    INNER JOIN Roles r ON r.id_rol=l.id_rol
                    ORDER BY l.id_usuario DESC";
            responder($pdo->query($sql)->fetchAll());
            break;

        case 'get_empleados':
            $sql = "SELECT e.id_empleado, e.Estado_laboral, e.Fecha_ingreso,
                           p.Nombre AS nombre, p.Apellido_Paterno AS apellido_paterno,
                           p.Apellidos_Materno AS apellido_materno, p.Celular AS celular,
                           s.Nombre_sucursal, l.email, r.Ocupacion AS rol
                    FROM Empleados e
                    INNER JOIN Personas p ON p.id_persona=e.id_persona
                    INNER JOIN Login l ON l.id_usuario=e.id_usuario
                    INNER JOIN Roles r ON r.id_rol=l.id_rol
                    LEFT JOIN Sucursales s ON s.id_sucursal=e.id_sucursal
                    ORDER BY e.id_empleado DESC";
            responder($pdo->query($sql)->fetchAll());
            break;

        case 'get_medicos':
            $sql = "SELECT m.id_medico, m.Cedula_profesional AS cedula_profesional,
                           m.Especialidad AS especialidad, m.Estado,
                           e.id_empleado, p.Nombre AS nombre, p.Apellido_Paterno AS apellido_paterno,
                           p.Apellidos_Materno AS apellido_materno, p.Celular AS celular,
                           s.Nombre_sucursal
                    FROM Medicos m
                    INNER JOIN Empleados e ON e.id_empleado=m.id_empleado
                    INNER JOIN Personas p ON p.id_persona=e.id_persona
                    LEFT JOIN Sucursales s ON s.id_sucursal=e.id_sucursal
                    ORDER BY m.id_medico DESC";
            responder($pdo->query($sql)->fetchAll());
            break;

        case 'add_usuario_empleado':
            $required = ['nombre','apellido_paterno','celular','email','password','id_rol','id_sucursal'];
            foreach ($required as $field) {
                if (!isset($inputData[$field]) || trim((string)$inputData[$field]) === '') {
                    responder(['success'=>false, 'error'=>"El campo {$field} es obligatorio."], 422);
                }
            }
            if (!filter_var($inputData['email'], FILTER_VALIDATE_EMAIL)) responder(['success'=>false, 'error'=>'El correo electrónico no es válido.'], 422);
            if (strlen($inputData['password']) < 8) responder(['success'=>false, 'error'=>'La contraseña debe tener al menos 8 caracteres.'], 422);

            $pdo->beginTransaction();
            try {
                $checkRole = $pdo->prepare("SELECT COUNT(*) FROM Roles WHERE id_rol=?");
                $checkRole->execute([(int)$inputData['id_rol']]);
                if (!$checkRole->fetchColumn()) throw new Exception('El rol seleccionado no existe. Registra primero los roles.');
                $checkEmail = $pdo->prepare("SELECT COUNT(*) FROM Login WHERE email=?");
                $checkEmail->execute([trim($inputData['email'])]);
                if ($checkEmail->fetchColumn()) throw new Exception('Ese correo ya está registrado.');

                $stmt = $pdo->prepare("INSERT INTO Personas (Nombre, Apellido_Paterno, Apellidos_Materno, Celular) VALUES (?, ?, ?, ?)");
                $stmt->execute([trim($inputData['nombre']), trim($inputData['apellido_paterno']), trim($inputData['apellido_materno'] ?? ''), trim($inputData['celular'])]);
                $idPersona = (int)$pdo->lastInsertId();

                $hash = password_hash($inputData['password'], PASSWORD_DEFAULT);
                $stmt = $pdo->prepare("INSERT INTO Login (id_rol, id_persona, email, password_hash, estado) VALUES (?, ?, ?, ?, 'activo')");
                $stmt->execute([(int)$inputData['id_rol'], $idPersona, trim($inputData['email']), $hash]);
                $idUsuario = (int)$pdo->lastInsertId();

                $stmt = $pdo->prepare("INSERT INTO Empleados (id_persona, id_usuario, id_sucursal, Fecha_ingreso, Estado_laboral) VALUES (?, ?, ?, CURDATE(), 'Activo')");
                $stmt->execute([$idPersona, $idUsuario, (int)$inputData['id_sucursal']]);
                $idEmpleado = (int)$pdo->lastInsertId();

                if (!empty($inputData['es_medico'])) {
                    if (empty($inputData['cedula_profesional']) || empty($inputData['especialidad'])) {
                        throw new Exception('La cédula profesional y la especialidad son obligatorias para registrar un médico.');
                    }
                    // La tabla Medicos del SQL no contiene columna Universidad.
                    $stmt = $pdo->prepare("INSERT INTO Medicos (id_empleado, Cedula_profesional, Especialidad, Estado) VALUES (?, ?, ?, 'Activo')");
                    $stmt->execute([$idEmpleado, trim($inputData['cedula_profesional']), trim($inputData['especialidad'])]);
                }

                $pdo->commit();
                responder(['success'=>true, 'mensaje'=>'Empleado registrado correctamente.', 'id_empleado'=>$idEmpleado, 'id_usuario'=>$idUsuario]);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }
            break;

        default:
            responder(['error'=>'Acción no válida.'], 404);
    }
} catch (Throwable $e) {
    responder(['success'=>false, 'error'=>$e->getMessage()], 500);
}
?>
