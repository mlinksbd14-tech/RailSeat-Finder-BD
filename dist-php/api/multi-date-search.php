<?php
require_once __DIR__ . '/helper.php';

$fromCity = $_GET['from_city'] ?? '';
$toCity = $_GET['to_city'] ?? '';
$startDate = $_GET['start_date'] ?? date('Y-m-d');
$days = min(14, max(1, (int)($_GET['days'] ?? 10)));

if (empty($fromCity) || empty($toCity)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'from_city and to_city are required.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$session = getSavedSession();
if (empty($session['token'])) {
    echo json_encode([
        'success' => false,
        'auth_required' => true,
        'error' => 'Live Shohoz session is required. Please click "Connect Live API" to pair your session.',
        'matrix' => []
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$baseTime = strtotime($startDate) ?: time();
$matrix = [];

for ($i = 0; $i < $days; $i++) {
    $currentDate = date('Y-m-d', strtotime("+$i day", $baseTime));
    $searchRes = queryShohozSearch($fromCity, $toCity, $currentDate, $session);
    
    $trains = $searchRes['trains'] ?? [];
    $totalSeats = 0;
    $onlineSeats = 0;
    foreach ($trains as $t) {
        $totalSeats += ($t['total_combined_seats'] ?? 0);
        $onlineSeats += ($t['total_online_seats'] ?? 0);
    }

    $matrix[] = [
        'date' => $currentDate,
        'display_date' => formatShohozDoj($currentDate),
        'total_trains' => count($trains),
        'total_seats' => $totalSeats,
        'online_seats' => $onlineSeats,
        'trains' => $trains
    ];

    // Brief cooldown between day queries to prevent Shohoz IP block
    usleep(100000);
}

echo json_encode([
    'success' => true,
    'from_city' => $fromCity,
    'to_city' => $toCity,
    'days_count' => count($matrix),
    'matrix' => $matrix
], JSON_UNESCAPED_UNICODE);
