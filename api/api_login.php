<?php
require_once 'config.php';

$action = $_GET['action'] ?? '';

if ($action === 'verify') {
    $data = json_decode(file_get_contents('php://input'), true);
    $password = $data['password'] ?? '';
    
    // En producción, usar password_verify()
    if ($password === 'admin123') {
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Contraseña incorrecta']);
    }
} else {
    echo json_encode(['success' => false, 'error' => 'Acción no válida']);
}
?>