<?php
require 'config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $username = $data['username'];
    $score = (int)$data['score'];

    // 1. Actualizar o crear usuario
    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user) {
        $newTotal = $user['total_stardust'] + $score;
        $newHigh = max($user['high_score'], $score);
        $stmt = $pdo->prepare("UPDATE users SET total_stardust = ?, high_score = ? WHERE username = ?");
        $stmt->execute([$newTotal, $newHigh, $username]);
    } else {
        $stmt = $pdo->prepare("INSERT INTO users (username, total_stardust, high_score, completed_missions) VALUES (?, ?, ?, '[]')");
        $stmt->execute([$username, $score, $score]);
    }

    // 2. Guardar en el ranking global
    $stmt = $pdo->prepare("INSERT INTO leaderboard (username, score) VALUES (?, ?)");
    $stmt->execute([$username, $score]);

    echo json_encode(['success' => true]);
}

if ($method === 'GET') {
    $stmt = $pdo->query("SELECT username as displayName, score FROM leaderboard ORDER BY score DESC LIMIT 10");
    $leaderboard = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode($leaderboard);
}
?>
