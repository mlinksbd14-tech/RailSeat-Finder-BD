<?php
/**
 * RailSeat Finder BD - PHP Shared Hosting API Dispatcher & Router
 * Dispatches requests to specific API handlers or responds directly
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, x-device-id, x-device-key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Extract requested path
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$path = preg_replace('#^.*?/api/#', '', $uri);
$path = trim($path, '/');

// Route table
switch ($path) {
    case 'stations':
        require __DIR__ . '/stations.php';
        break;

    case 'trains-list':
        require __DIR__ . '/trains-list.php';
        break;

    case 'auth/status':
        require __DIR__ . '/auth-status.php';
        break;

    case 'auth/set-token':
        require __DIR__ . '/auth-set-token.php';
        break;

    case 'auth/logout':
        require __DIR__ . '/auth-logout.php';
        break;

    case 'search':
        require __DIR__ . '/search.php';
        break;

    case 'multi-date-search':
        require __DIR__ . '/multi-date-search.php';
        break;

    case 'train-route':
        require __DIR__ . '/train-route.php';
        break;

    case 'train-station-matrix':
        require __DIR__ . '/train-station-matrix.php';
        break;

    case 'user-auth/status':
    case 'user-auth/popular-routes':
    case 'user-auth/firebase-login':
    case 'user-auth/login':
    case 'user-auth/logout':
        require __DIR__ . '/user-auth.php';
        break;

    case 'github-sync':
    case 'deploy-webhook':
        require __DIR__ . '/github-sync.php';
        break;

    default:
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'error' => 'API endpoint not found: ' . htmlspecialchars($path)
        ], JSON_UNESCAPED_UNICODE);
        break;
}
