<?php
require_once __DIR__ . '/helper.php';

$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true);

if (!is_array($body) || empty($body['token'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Token is required.']);
    exit;
}

$token = trim($body['token']);
$token = preg_replace('/^Bearer\s+/i', '', $token);

$deviceId = trim($body['device_id'] ?? $body['deviceId'] ?? '');
if (empty($deviceId) || $deviceId === 'null' || $deviceId === 'undefined') {
    $deviceId = generateShohozDeviceId();
}

$deviceKey = trim($body['device_key'] ?? $body['deviceKey'] ?? '');
if (strtolower($deviceKey) === 'web' || $deviceKey === 'null' || $deviceKey === 'undefined') {
    $deviceKey = '';
}

// Preserve genuine device key if already saved on server, or generate valid 160-char SSDK fingerprint
if (empty($deviceKey) || strlen($deviceKey) < 32) {
    $existingSession = getSavedSession();
    if (!empty($existingSession['deviceKey']) && strtolower($existingSession['deviceKey']) !== 'web' && strlen($existingSession['deviceKey']) >= 32) {
        $deviceKey = $existingSession['deviceKey'];
    } else {
        $deviceKey = generateShohozDeviceKey($deviceId . $token);
    }
}

// Try decoding payload from JWT if present
$user = [
    'name' => 'Verified Passenger',
    'phone' => '01XXXXXXXXX',
    'email' => 'eticket@railway.gov.bd',
    'nid' => '************'
];

$parts = explode('.', $token);
if (count($parts) >= 2) {
    $decoded = decodeShohozPayload($parts[1]);
    if (is_array($decoded)) {
        if (!empty($decoded['name'])) $user['name'] = $decoded['name'];
        if (!empty($decoded['display_name'])) $user['name'] = $decoded['display_name'];
        if (!empty($decoded['phone_number'])) $user['phone'] = $decoded['phone_number'];
        elseif (!empty($decoded['phone'])) $user['phone'] = $decoded['phone'];
        if (!empty($decoded['email'])) $user['email'] = $decoded['email'];
        if (!empty($decoded['nida'])) $user['nid'] = $decoded['nida'];
        elseif (!empty($decoded['nid'])) $user['nid'] = $decoded['nid'];
        elseif (!empty($decoded['nidn'])) $user['nid'] = $decoded['nidn'];
        if (!empty($decoded['exp'])) $user['expiresAt'] = date('c', $decoded['exp']);
    }
}

$sessionData = [
    'token' => $token,
    'deviceId' => $deviceId,
    'deviceKey' => $deviceKey,
    'user' => $user,
    'updated_at' => date('c')
];

saveSessionData($sessionData);

echo json_encode([
    'success' => true,
    'message' => 'Live Shohoz session saved permanently on server.',
    'user' => $user,
    'token_preview' => substr($token, 0, 10) . '...' . substr($token, -6),
    'device_id' => $deviceId,
    'device_key' => $deviceKey
], JSON_UNESCAPED_UNICODE);
