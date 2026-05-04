<?php
require_once 'config.php';

$action = $_GET['action'] ?? '';

try {
    switch($action) {
        // ==================== OBTENER TORNEO ====================
        case 'getTorneo':
            $stmt = $pdo->query("SELECT * FROM torneo ORDER BY id DESC LIMIT 1");
            $torneo = $stmt->fetch();
            
            if (!$torneo) {
                echo json_encode(['success' => true, 'data' => null]);
                break;
            }
            
            // Obtener equipos
            $stmt = $pdo->prepare("SELECT nombre FROM torneo_equipos WHERE torneo_id = ? ORDER BY orden");
            $stmt->execute([$torneo['id']]);
            $equipos = $stmt->fetchAll();
            
            // Obtener partidos
            $stmt = $pdo->prepare("SELECT * FROM torneo_partidos WHERE torneo_id = ? ORDER BY ronda, orden");
            $stmt->execute([$torneo['id']]);
            $partidos = $stmt->fetchAll();
            
            echo json_encode([
                'success' => true,
                'data' => [
                    'torneo' => $torneo,
                    'equipos' => array_column($equipos, 'nombre'),
                    'partidos' => $partidos
                ]
            ]);
            break;
        
        // ==================== AGREGAR EQUIPO ====================
        case 'addEquipo':
            $data = json_decode(file_get_contents('php://input'), true);
            $nombre = trim($data['nombre']);
            
            if (empty($nombre)) {
                echo json_encode(['success' => false, 'error' => 'El nombre no puede estar vacío']);
                break;
            }
            
            // Buscar torneo activo o en configuración
            $stmt = $pdo->query("SELECT id FROM torneo WHERE estado IN ('activo', 'configuracion') ORDER BY id DESC LIMIT 1");
            $torneo = $stmt->fetch();
            
            if (!$torneo) {
                // Crear nuevo torneo
                $stmt = $pdo->prepare("INSERT INTO torneo (estado) VALUES ('configuracion')");
                $stmt->execute();
                $torneoId = $pdo->lastInsertId();
            } else {
                $torneoId = $torneo['id'];
            }
            
            // Verificar si el equipo ya existe
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM torneo_equipos WHERE torneo_id = ? AND nombre = ?");
            $stmt->execute([$torneoId, $nombre]);
            if ($stmt->fetchColumn() > 0) {
                echo json_encode(['success' => false, 'error' => 'El equipo ya existe']);
                break;
            }
            
            // Obtener último orden
            $stmt = $pdo->prepare("SELECT COALESCE(MAX(orden), -1) + 1 as nuevo_orden FROM torneo_equipos WHERE torneo_id = ?");
            $stmt->execute([$torneoId]);
            $orden = $stmt->fetch()['nuevo_orden'];
            
            $stmt = $pdo->prepare("INSERT INTO torneo_equipos (torneo_id, nombre, orden) VALUES (?, ?, ?)");
            $stmt->execute([$torneoId, $nombre, $orden]);
            
            echo json_encode(['success' => true, 'id' => $pdo->lastInsertId()]);
            break;
        
        // ==================== ELIMINAR EQUIPO ====================
        case 'deleteEquipo':
            $id = $_GET['id'] ?? 0;
            if ($id > 0) {
                $stmt = $pdo->prepare("DELETE FROM torneo_equipos WHERE id = ?");
                $stmt->execute([$id]);
            }
            echo json_encode(['success' => true]);
            break;
        
        // ==================== CREAR TORNEO ====================
        case 'crearTorneo':
            $data = json_decode(file_get_contents('php://input'), true);
            $equipos = $data['equipos'];
            
            if (count($equipos) < 2) {
                echo json_encode(['success' => false, 'error' => 'Se necesitan al menos 2 equipos']);
                break;
            }
            
            // Eliminar torneo anterior
            $pdo->exec("DELETE FROM torneo_partidos");
            $pdo->exec("DELETE FROM torneo_equipos");
            $pdo->exec("UPDATE torneo SET estado = 'configuracion', ganador = NULL");
            
            // Crear nuevo torneo
            $stmt = $pdo->prepare("INSERT INTO torneo (estado) VALUES ('activo')");
            $stmt->execute();
            $torneoId = $pdo->lastInsertId();
            
            // Guardar equipos
            $stmtEquipo = $pdo->prepare("INSERT INTO torneo_equipos (torneo_id, nombre, orden) VALUES (?, ?, ?)");
            foreach ($equipos as $idx => $equipo) {
                $stmtEquipo->execute([$torneoId, $equipo, $idx]);
            }
            
            // Generar partidos del torneo (eliminación directa)
            $numEquipos = count($equipos);
            $numRondas = ceil(log($numEquipos, 2));
            $totalSlots = pow(2, $numRondas);
            
            // Añadir byes (descansos)
            $participantes = $equipos;
            while (count($participantes) < $totalSlots) {
                $participantes[] = null;
            }
            
            // Mezclar aleatoriamente (SORTEO)
            shuffle($participantes);
            
            // Crear primera ronda
            $partidos = [];
            $partidoOrden = 0;
            for ($i = 0; $i < count($participantes); $i += 2) {
                $eq1 = $participantes[$i];
                $eq2 = $participantes[$i + 1];
                
                if ($eq1 !== null || $eq2 !== null) {
                    $ganador = null;
                    $completado = 0;
                    
                    // Si hay bye (descanso), el otro pasa automáticamente
                    if ($eq1 === null && $eq2 !== null) {
                        $ganador = $eq2;
                        $completado = 1;
                    } elseif ($eq2 === null && $eq1 !== null) {
                        $ganador = $eq1;
                        $completado = 1;
                    }
                    
                    $partidos[] = [
                        'ronda' => 1,
                        'orden' => $partidoOrden,
                        'equipo1' => $eq1,
                        'equipo2' => $eq2,
                        'ganador' => $ganador,
                        'completado' => $completado
                    ];
                    $partidoOrden++;
                }
            }
            
            // Insertar partidos de primera ronda
            $stmtPartido = $pdo->prepare("INSERT INTO torneo_partidos (torneo_id, ronda, orden, equipo1, equipo2, ganador, completado) VALUES (?, ?, ?, ?, ?, ?, ?)");
            foreach ($partidos as $p) {
                $stmtPartido->execute([$torneoId, $p['ronda'], $p['orden'], $p['equipo1'], $p['equipo2'], $p['ganador'], $p['completado']]);
            }
            
            // Generar rondas siguientes
            $rondaActual = 1;
            $partidosRonda = $partidos;
            
            while (count($partidosRonda) > 1) {
                $siguienteRonda = [];
                $siguienteOrden = 0;
                
                for ($i = 0; $i < count($partidosRonda); $i += 2) {
                    $siguienteRonda[] = [
                        'ronda' => $rondaActual + 1,
                        'orden' => $siguienteOrden++,
                        'equipo1' => null,
                        'equipo2' => null,
                        'ganador' => null,
                        'completado' => 0
                    ];
                }
                
                // Insertar partidos de la siguiente ronda
                foreach ($siguienteRonda as $p) {
                    $stmtPartido->execute([$torneoId, $p['ronda'], $p['orden'], $p['equipo1'], $p['equipo2'], $p['ganador'], $p['completado']]);
                }
                
                $partidosRonda = $siguienteRonda;
                $rondaActual++;
            }
            
            echo json_encode(['success' => true, 'torneoId' => $torneoId]);
            break;
        
        // ==================== GUARDAR RESULTADO DE PARTIDO ====================
       case 'guardarPartido':
    // Limpiar cualquier salida previa
    if (ob_get_length()) ob_clean();
    
    $data = json_decode(file_get_contents('php://input'), true);
    
    // Verificar que los datos llegaron
    if (!$data) {
        echo json_encode(['success' => false, 'error' => 'No se recibieron datos']);
        break;
    }
    
    // Parsear partidoId
    $parts = explode('_', $data['partidoId']);
    $ronda = intval($parts[0]) + 1;
    $orden = intval($parts[1]);
    
    // Obtener torneo activo
    $stmt = $pdo->query("SELECT id FROM torneo WHERE estado = 'activo' ORDER BY id DESC LIMIT 1");
    $torneo = $stmt->fetch();
    
    if (!$torneo) {
        echo json_encode(['success' => false, 'error' => 'No hay torneo activo']);
        break;
    }
    
    // Verificar si el partido existe
    $stmt = $pdo->prepare("SELECT id FROM torneo_partidos WHERE torneo_id = ? AND ronda = ? AND orden = ?");
    $stmt->execute([$torneo['id'], $ronda, $orden]);
    if ($stmt->rowCount() == 0) {
        echo json_encode(['success' => false, 'error' => 'Partido no encontrado']);
        break;
    }
    
    // Actualizar el partido
    $stmt = $pdo->prepare("UPDATE torneo_partidos SET 
        ganador = ?,
        completado = 1,
        set1_local = ?, 
        set1_visitante = ?,
        set2_local = ?, 
        set2_visitante = ?,
        set3_local = ?, 
        set3_visitante = ?
        WHERE torneo_id = ? AND ronda = ? AND orden = ?");
    
    $resultado = $stmt->execute([
        $data['ganador'],
        $data['set1_local'], $data['set1_visitante'],
        $data['set2_local'], $data['set2_visitante'],
        $data['set3_local'], $data['set3_visitante'],
        $torneo['id'], $ronda, $orden
    ]);
    
    if (!$resultado) {
        echo json_encode(['success' => false, 'error' => 'Error al actualizar el partido']);
        break;
    }
    
    // Actualizar siguiente ronda
    $siguienteOrden = floor($orden / 2);
    $esLocal = ($orden % 2 == 0);
    
    $stmt = $pdo->prepare("SELECT id FROM torneo_partidos WHERE torneo_id = ? AND ronda = ? AND orden = ?");
    $stmt->execute([$torneo['id'], $ronda + 1, $siguienteOrden]);
    $siguientePartido = $stmt->fetch();
    
    if ($siguientePartido) {
        if ($esLocal) {
            $stmt = $pdo->prepare("UPDATE torneo_partidos SET equipo1 = ? WHERE id = ?");
        } else {
            $stmt = $pdo->prepare("UPDATE torneo_partidos SET equipo2 = ? WHERE id = ?");
        }
        $stmt->execute([$data['ganador'], $siguientePartido['id']]);
    }
    
    // Si es la final, actualizar ganador del torneo
    $stmt = $pdo->prepare("SELECT MAX(ronda) as max_ronda FROM torneo_partidos WHERE torneo_id = ?");
    $stmt->execute([$torneo['id']]);
    $maxRonda = $stmt->fetch()['max_ronda'];
    
    if ($ronda == $maxRonda) {
        $stmt = $pdo->prepare("UPDATE torneo SET ganador = ? WHERE id = ?");
        $stmt->execute([$data['ganador'], $torneo['id']]);
    }
    
    // Devolver respuesta limpia
    echo json_encode(['success' => true]);
    break;
        
        // ==================== RESETEAR TORNEO ====================
        case 'resetTorneo':
            $pdo->exec("DELETE FROM torneo_partidos");
            $pdo->exec("DELETE FROM torneo_equipos");
            $pdo->exec("UPDATE torneo SET estado = 'configuracion', ganador = NULL");
            echo json_encode(['success' => true]);
            break;
        
        default:
            echo json_encode(['success' => false, 'error' => 'Acción no válida: ' . $action]);
    }
} catch(Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>