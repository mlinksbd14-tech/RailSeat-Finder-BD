<?php
/**
 * dist-php/api/seat-release.php
 * 
 * Release Held Seats from Official Shohoz Railway Cart
 */

require_once __DIR__ . '/helper.php';

header('Content-Type: application/json; charset=utf-8');

$rawInput = file_get_contents('php://input');
$bodyParams = !empty($rawInput) ? json_decode($rawInput, true) : [];
if (!is_array($bodyParams)) $bodyParams = [];
$params = array_merge($_GET, $_POST, $bodyParams);

$ticketIds = $params['ticket_ids'] ?? [];
if (!empty($params['ticket_id'])) {
    $ticketIds[] = $params['ticket_id'];
}
$routeId = (int)($params['route_id'] ?? $params['trip_route_id'] ?? 0);

if (empty($ticketIds) || empty($routeId)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'ticket_id(s) and route_id are required to release seats.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$session = getSavedSession();
if (empty($session['token'])) {
    http_response_code(401);
    echo json_encode([
        'success' => false,
        'error' => 'No active Bangladesh Railway session found.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$devId = $session['deviceId'] ?? $session['device_id'] ?? '34a817c48b87571632d2a7a1d50575a4';
$devKey = $session['deviceKey'] ?? $session['device_key'] ?? generateShohozDeviceKey($session['token']);

$releaseUrl = 'https://railspaapi.shohoz.com/v1.0/web/bookings/bulk-release-seat';
$postData = json_encode([
    'ticket_id' => array_map('intval', (array)$ticketIds),
    'route_id' => $routeId
]);

$ch = curl_init($releaseUrl);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 6);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer ' . $session['token'],
    'x-device-id: ' . $devId,
    'x-device-key: ' . $devKey,
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$json = json_decode($response, true);
if ($httpCode >= 200 && $httpCode < 300) {
    echo json_encode([
        'success' => true,
        'data' => $json
    ], JSON_UNESCAPED_UNICODE);
} else {
    http_response_code($httpCode ?: 500);
    $errMsg = $json['error']['messages'][0] ?? 'Failed to release seat';
    echo json_encode([
        'success' => false,
        'error' => $errMsg
    ], JSON_UNESCAPED_UNICODE);
}
