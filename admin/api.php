<?php
// Datos de conexión de TiDB Cloud
$host = "gateway01.us-west-2.prod.aws.tidbcloud.com "; // El Host de TiDB
$port = 4000; // El puerto de TiDB (usualmente es 4000)
$dbname = "salon_belleza_db"; // El nombre de tu base de datos en TiDB
$username = "2vnigdUhE2wpafE.root"; // El usuario que te dio TiDB (suele tener un ID largo)
$password = "tVFChDdPEZWD8sGE"; // La contraseña que creaste en TiDB

header('Content-Type: application/json; charset=utf-8');

try {
    $pdo = new PDO(
        "mysql:host=$host;port=$port;dbname=$dbname;charset=utf8mb4",
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
    echo json_encode(['success'=>false, 'error'=>'No fue posible conectar con TiDB. Revisa tus credenciales.'], JSON_UNESCAPED_UNICODE);
    exit;
}
?>