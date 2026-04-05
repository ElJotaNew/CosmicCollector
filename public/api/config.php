<?php
// Configuración de la base de datos de AlwaysData
// REEMPLAZA ESTOS DATOS con los que aparecen en tu panel de AlwaysData
$host = 'mysql-jota.alwaysdata.net'; // Tu MySQL Host
$dbname = 'jota_cosmictop'; // Tu Database Name
$username = 'jota';     // Tu MySQL User
$password = 'zQwi42X.wbkmUt2';  // Tu MySQL Password

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    die(json_encode(['error' => 'Conexión fallida: ' . $e->getMessage()]));
}
?>
