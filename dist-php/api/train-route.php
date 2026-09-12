<?php
require_once __DIR__ . '/helper.php';

$model = trim($_GET['model'] ?? '');
if (empty($model)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'model parameter is required.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$cleanModel = preg_replace('/\D/', '', $model);
if (empty($cleanModel)) $cleanModel = $model;

$session = getSavedSession();

$headers = [
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept: application/json, text/plain, */*',
    'Content-Type: application/json',
    'Origin: https://eticket.railway.gov.bd',
    'Referer: https://eticket.railway.gov.bd/train-information'
];

if (!empty($session['token'])) {
    $headers[] = 'Authorization: Bearer ' . trim($session['token']);
}
if (!empty($session['deviceId'])) {
    $headers[] = 'x-device-id: ' . trim($session['deviceId']);
}
if (!empty($session['deviceKey'])) {
    $headers[] = 'x-device-key: ' . trim($session['deviceKey']);
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://railspaapi.shohoz.com/v1.0/web/train-routes');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['model' => $cleanModel]));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

$rawResponse = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$data = json_decode($rawResponse, true);

if ($httpCode === 200 && isset($data['data'])) {
    echo json_encode([
        'success' => true,
        'data' => $data['data']
    ], JSON_UNESCAPED_UNICODE);
} else {
    echo json_encode([
        'success' => false,
        'error' => 'No route schedule found for train #' . htmlspecialchars($cleanModel)
    ], JSON_UNESCAPED_UNICODE);
}
