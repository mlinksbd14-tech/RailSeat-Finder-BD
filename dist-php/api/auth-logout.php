<?php
require_once __DIR__ . '/helper.php';

if (file_exists(SESSION_FILE)) {
    @unlink(SESSION_FILE);
}

echo json_encode([
    'success' => true,
    'message' => 'Logged out successfully. Live session cleared.'
], JSON_UNESCAPED_UNICODE);
