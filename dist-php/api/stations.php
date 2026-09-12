<?php
require_once __DIR__ . '/helper.php';

$stations = [];
if (file_exists(STATIONS_FILE)) {
    $stations = json_decode(file_get_contents(STATIONS_FILE), true) ?: [];
}

echo json_encode([
    'success' => true,
    'count' => count($stations),
    'stations' => $stations
], JSON_UNESCAPED_UNICODE);
