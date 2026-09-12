<?php
require_once __DIR__ . '/helper.php';

$trains = [];
if (file_exists(TRAINS_FILE)) {
    $trains = json_decode(file_get_contents(TRAINS_FILE), true) ?: [];
}

echo json_encode([
    'success' => true,
    'count' => count($trains),
    'trains' => $trains
], JSON_UNESCAPED_UNICODE);
