<?php
require_once __DIR__ . '/helper.php';

// Safe User Auth endpoints (Relies on Firebase Auth on client side)
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if (strpos($uri, 'popular-routes') !== false) {
    $routesFile = DATA_DIR . '/popular_routes.json';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = file_get_contents('php://input');
        $body = json_decode($input, true);
        if (isset($body['routes'])) {
            file_put_contents($routesFile, json_encode($body['routes'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode(['success' => true]);
            exit;
        }
    }

    $saved = file_exists($routesFile) ? json_decode(file_get_contents($routesFile), true) : null;
    $defaultRoutes = [
        ['from' => 'Dhaka', 'to' => 'Chattogram'],
        ['from' => 'Chattogram', 'to' => 'Dhaka'],
        ['from' => 'Dhaka', 'to' => 'Sylhet'],
        ['from' => 'Dhaka', 'to' => 'Rajshahi'],
        ['from' => "Dhaka", 'to' => "Cox's Bazar"]
    ];

    echo json_encode([
        'success' => true,
        'routes' => $saved ?: $defaultRoutes
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// User auth status fallback
echo json_encode([
    'success' => true,
    'authenticated' => true,
    'user' => [
        'username' => 'guest',
        'role' => 'user',
        'name' => 'Dashboard User'
    ]
], JSON_UNESCAPED_UNICODE);
