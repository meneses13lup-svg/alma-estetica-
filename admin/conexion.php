<?php
$host = "localhost";
$dbname = "salon_belleza_db";
$username = "root";
$password = "hector"; // Cambia este valor si tu MySQL usa otra contraseña.

header('Content-Type: application/json; charset=utf-8');

try {
    $pdo = new PDO(
        "mysql:host=$host;dbname=$dbname;charset=utf8mb4",
        $username,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false, 'error'=>'No fue posible conectar con MySQL. Verifica conexion.php y que MySQL esté iniciado.'], JSON_UNESCAPED_UNICODE);
    exit;
}
?>
