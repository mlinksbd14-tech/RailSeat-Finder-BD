<?php
require_once __DIR__ . '/helper.php';

$model = trim($_GET['model'] ?? '');
$doj = trim($_GET['date_of_journey'] ?? '');

if (empty($model) || empty($doj)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'model and date_of_journey are required.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$cleanModel = preg_replace('/\D/', '', $model) ?: $model;
$session = getSavedSession();

echo json_encode([
    'success' => true,
    'train_model' => $cleanModel,
    'date' => $doj,
    'display_date' => formatShohozDoj($doj),
    'stoppages' => [],
    'segments' => []
], JSON_UNESCAPED_UNICODE);
