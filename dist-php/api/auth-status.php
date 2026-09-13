<?php
require_once __DIR__ . '/helper.php';

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
header('Content-Type: application/json; charset=utf-8');

$session = getSavedSession();
$isAuthenticated = !empty($session['token']);

$profile = decodeShohozProfile($session['token']);
if (is_array($profile)) {
    $user = $profile;
} elseif (!empty($session['user']) && empty($session['user']['custom_token'])) {
    $user = $session['user'];
} else {
    $stored = $session['user'] ?? [];
    $user = [
        'name' => 'Railway Passenger',
        'phone' => $stored['phone'] ?? '01XXXXXXXXX',
        'email' => $stored['email'] ?? null,
        'nid' => $stored['nid'] ?? $stored['nidn'] ?? null,
        'custom_token' => true
    ];
}
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
