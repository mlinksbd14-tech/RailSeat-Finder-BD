<?php
require_once __DIR__ . '/helper.php';

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
    'device_key' => $session['deviceKey'] ?? 'web'
], JSON_UNESCAPED_UNICODE);
