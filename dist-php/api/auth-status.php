<?php
require_once __DIR__ . '/helper.php';

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
header('Content-Type: application/json; charset=utf-8');

$session = getSavedSession();
$isAuthenticated = !empty($session['token']);

$user = $session['user'] ?? null;
if (!$user && $isAuthenticated) {
    $user = [
        'name' => 'Live Passenger',
        'email' => 'railway@live.bd',
        'phone' => '017XXXXXXXX',
        'nid' => '************'
    ];
}

$tokenPreview = $isAuthenticated ? substr($session['token'], 0, 10) . '...' . substr($session['token'], -6) : '';

echo json_encode([
    'authenticated' => $isAuthenticated,
    'has_saved_session' => $isAuthenticated,
    'user' => $user,
    'token_preview' => $tokenPreview,
    'device_id' => $session['deviceId'] ?? '',
    'device_key' => (!empty($session['deviceKey']) && strtolower($session['deviceKey']) !== 'web') ? $session['deviceKey'] : (!empty($session['token']) ? generateShohozDeviceKey($session['token']) : '')
], JSON_UNESCAPED_UNICODE);
