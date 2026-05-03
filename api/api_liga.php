<?php
require_once 'config.php';

$action = $_GET['action'] ?? '';
$liga = $_GET['liga'] ?? 'masculino_avanzado';

try {
    switch($action) {
        // Obtener equipos de una liga
        case 'getEquipos':
            $stmt = $pdo->prepare("SELECT * FROM equipos_liga WHERE liga = ? ORDER BY puntos DESC, pg DESC");
            $stmt->execute([$liga]);
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;
        
        // Agregar equipo
        case 'addEquipo':
            $data = json_decode(file_get_contents('php://input'), true);
            $nombre = trim($data['nombre']);
            
            if (empty($nombre)) {
                echo json_encode(['success' => false, 'error' => 'El nombre no puede estar vacío']);
                break;
            }
            
            $stmt = $pdo->prepare("INSERT INTO equipos_liga (liga, nombre) VALUES (?, ?)");
            $stmt->execute([$data['liga'], $nombre]);
            echo json_encode(['success' => true, 'id' => $pdo->lastInsertId()]);
            break;
        
        // Eliminar equipo
        case 'deleteEquipo':
            $id = $_GET['id'] ?? 0;
            
            // Verificar si el equipo tiene partidos
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM calendario_liga WHERE liga = ? AND (local = (SELECT nombre FROM equipos_liga WHERE id = ?) OR visitante = (SELECT nombre FROM equipos_liga WHERE id = ?))");
            $stmt->execute([$liga, $id, $id]);
            if ($stmt->fetchColumn() > 0) {
                echo json_encode(['success' => false, 'error' => 'No se puede eliminar un equipo con partidos asignados']);
                break;
            }
            
            $stmt = $pdo->prepare("DELETE FROM equipos_liga WHERE id = ? AND liga = ?");
            $stmt->execute([$id, $liga]);
            echo json_encode(['success' => true]);
            break;
        
        // Obtener calendario
        case 'getCalendario':
            $stmt = $pdo->prepare("SELECT * FROM calendario_liga WHERE liga = ? ORDER BY jornada, id");
            $stmt->execute([$liga]);
            $calendario = $stmt->fetchAll();
            
            // Agrupar por jornada
            $jornadas = [];
            foreach ($calendario as $partido) {
                $jornada = $partido['jornada'];
                if (!isset($jornadas[$jornada])) $jornadas[$jornada] = [];
                $jornadas[$jornada][] = $partido;
            }
            
            echo json_encode(['success' => true, 'data' => $jornadas]);
            break;
        
        // Generar calendario
        case 'generarCalendario':
            $data = json_decode(file_get_contents('php://input'), true);
            $liga = $data['liga'];
            $calendario = $data['calendario'];
            
            // Limpiar calendario anterior
            $pdo->prepare("DELETE FROM calendario_liga WHERE liga = ?")->execute([$liga]);
            
            // Insertar nuevo calendario
            $stmt = $pdo->prepare("INSERT INTO calendario_liga (liga, jornada, local, visitante) VALUES (?, ?, ?, ?)");
            foreach ($calendario as $jornada => $partidos) {
                foreach ($partidos as $partido) {
                    $stmt->execute([$liga, $jornada + 1, $partido['local'], $partido['visitante']]);
                }
            }
            
            echo json_encode(['success' => true]);
            break;
        
        // Guardar resultado
        case 'guardarResultado':
            $data = json_decode(file_get_contents('php://input'), true);
            
            // Calcular puntos
            $setsLocal = 0;
            $setsVisitante = 0;
            $puntosLocal = 0;
            $puntosVisitante = 0;
            
            // Contar sets ganados
            if ($data['set1_local'] > $data['set1_visitante']) $setsLocal++;
            else $setsVisitante++;
            
            if ($data['set2_local'] > $data['set2_visitante']) $setsLocal++;
            else $setsVisitante++;
            
            if (isset($data['set3_local']) && isset($data['set3_visitante']) && $data['set3_local'] !== '' && $data['set3_visitante'] !== '') {
                if ($data['set3_local'] > $data['set3_visitante']) $setsLocal++;
                else $setsVisitante++;
            }
            
            // Asignar puntos (3/1/0)
            if ($setsLocal > $setsVisitante) {
                $puntosLocal = 3;
                $puntosVisitante = ($setsVisitante > 0) ? 1 : 0;
            } else {
                $puntosVisitante = 3;
                $puntosLocal = ($setsLocal > 0) ? 1 : 0;
            }
            
            // Guardar resultado
            $stmt = $pdo->prepare("UPDATE calendario_liga SET 
                completado = TRUE,
                set1_local = ?, set1_visitante = ?,
                set2_local = ?, set2_visitante = ?,
                set3_local = ?, set3_visitante = ?,
                puntos_local = ?, puntos_visitante = ?
                WHERE liga = ? AND jornada = ? AND local = ? AND visitante = ?");
            
            $stmt->execute([
                $data['set1_local'], $data['set1_visitante'],
                $data['set2_local'], $data['set2_visitante'],
                $data['set3_local'], $data['set3_visitante'],
                $puntosLocal, $puntosVisitante,
                $data['liga'], $data['jornada'], $data['local'], $data['visitante']
            ]);
            
            // Actualizar estadísticas de equipos
            actualizarEstadisticasEquipo($pdo, $data['liga'], $data['local'], $puntosLocal, $setsLocal);
            actualizarEstadisticasEquipo($pdo, $data['liga'], $data['visitante'], $puntosVisitante, $setsVisitante);
            
            echo json_encode(['success' => true]);
            break;
        
        // Resetear liga
        case 'resetLiga':
            $liga = $_GET['liga'] ?? '';
            
            $pdo->beginTransaction();
            try {
                // Eliminar partidos
                $pdo->prepare("DELETE FROM calendario_liga WHERE liga = ?")->execute([$liga]);
                // Resetear estadísticas de equipos
                $pdo->prepare("UPDATE equipos_liga SET pj = 0, pg = 0, pp1 = 0, pp0 = 0, puntos = 0 WHERE liga = ?")->execute([$liga]);
                $pdo->commit();
                echo json_encode(['success' => true]);
            } catch(Exception $e) {
                $pdo->rollBack();
                echo json_encode(['success' => false, 'error' => $e->getMessage()]);
            }
            break;
        
        // Resetear todo el sistema
        case 'resetAll':
            $pdo->beginTransaction();
            try {
                $pdo->exec("DELETE FROM calendario_liga");
                $pdo->exec("UPDATE equipos_liga SET pj = 0, pg = 0, pp1 = 0, pp0 = 0, puntos = 0");
                $pdo->exec("DELETE FROM torneo_partidos");
                $pdo->exec("DELETE FROM torneo_equipos");
                $pdo->exec("UPDATE torneo SET estado = 'configuracion', ganador = NULL");
                $pdo->commit();
                echo json_encode(['success' => true]);
            } catch(Exception $e) {
                $pdo->rollBack();
                echo json_encode(['success' => false, 'error' => $e->getMessage()]);
            }
            break;
        
        default:
            echo json_encode(['success' => false, 'error' => 'Acción no válida']);
    }
} catch(Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}

function actualizarEstadisticasEquipo($pdo, $liga, $nombre, $puntosPartido, $setsGanados) {
    // Obtener el equipo
    $stmt = $pdo->prepare("SELECT * FROM equipos_liga WHERE liga = ? AND nombre = ?");
    $stmt->execute([$liga, $nombre]);
    $equipo = $stmt->fetch();
    
    if (!$equipo) return;
    
    $pj = $equipo['pj'] + 1;
    $puntos = $equipo['puntos'] + $puntosPartido;
    
    if ($puntosPartido == 3) {
        $pg = $equipo['pg'] + 1;
        $pp1 = $equipo['pp1'];
        $pp0 = $equipo['pp0'];
    } elseif ($puntosPartido == 1) {
        $pg = $equipo['pg'];
        $pp1 = $equipo['pp1'] + 1;
        $pp0 = $equipo['pp0'];
    } else {
        $pg = $equipo['pg'];
        $pp1 = $equipo['pp1'];
        $pp0 = $equipo['pp0'] + 1;
    }
    
    $stmt = $pdo->prepare("UPDATE equipos_liga SET pj = ?, pg = ?, pp1 = ?, pp0 = ?, puntos = ? WHERE liga = ? AND nombre = ?");
    $stmt->execute([$pj, $pg, $pp1, $pp0, $puntos, $liga, $nombre]);
}
?>