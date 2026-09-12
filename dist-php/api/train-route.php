<?php
require_once __DIR__ . '/helper.php';

$model = trim($_GET['model'] ?? '');
if (empty($model)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'model parameter is required.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$cleanModel = preg_replace('/\D/', '', $model) ?: $model;
$session = getSavedSession();

$routeData = getTrainRouteDataPHP($cleanModel, $session);

if ($routeData && !empty($routeData['routes'])) {
    echo json_encode([
        'success' => true,
        'data' => $routeData
    ], JSON_UNESCAPED_UNICODE);
} else {
    echo json_encode([
        'success' => false,
        'error' => 'No route schedule found for train #' . htmlspecialchars($cleanModel)
    ], JSON_UNESCAPED_UNICODE);
}
