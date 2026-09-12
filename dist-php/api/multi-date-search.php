<?php
/**
 * 10-Day Availability Matrix API
 * Queries multi-date consecutive availability across all trains in parallel
 */
require_once __DIR__ . '/helper.php';

$fromCity = trim($_GET['from_city'] ?? '');
$toCity = trim($_GET['to_city'] ?? '');
$startDate = trim($_GET['start_date'] ?? date('Y-m-d'));
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
$dates = [];
$queries = [];

for ($i = 0; $i < $days; $i++) {
    $dStr = date('Y-m-d', strtotime("+$i day", $baseTime));
    $dates[] = $dStr;
    $queries[] = [
        'key' => $dStr,
        'from' => $fromCity,
        'to' => $toCity,
        'date' => $dStr
    ];
}

// Run all day queries in parallel batches using curl_multi
$queryResults = queryShohozTripsParallel($queries, $session, 4);

$matrix = [];
foreach ($dates as $dStr) {
    $res = $queryResults[$dStr] ?? null;
    $trains = $res['trains'] ?? [];

    $totalAvailableSeats = array_sum(array_column($trains, 'total_combined_seats'));
    $totalOnlineSeats = array_sum(array_column($trains, 'total_online_seats'));

    $mappedTrains = [];
    foreach ($trains as $t) {
        $seatTypes = [];
        foreach ($t['seat_types'] ?? [] as $st) {
            $avail = (int)($st['seats_available'] ?? $st['online_available_seats'] ?? $st['online_seats'] ?? 0);
            $counter = (int)($st['counter_seats_available'] ?? $st['offline_available_seats'] ?? $st['counter_seats'] ?? 0);
            $baseFare = (float)($st['fare'] ?? $st['ticket_fare'] ?? 0);
            $vat = (float)($st['vat'] ?? $st['vat_amount'] ?? 0);
            $totalFare = (float)($st['total_fare'] ?? ($baseFare + $vat));
            $type = strtoupper((string)($st['type'] ?? 'UNKNOWN'));

            $seatTypes[] = [
                'type' => $type,
                'display_name' => $st['display_name'] ?? $type,
                'total_seats' => $avail + $counter,
                'online_seats' => $avail,
                'fare' => $baseFare,
                'vat' => $vat,
                'total_fare' => $totalFare
            ];
        }

        $combinedSeats = (int)($t['total_combined_seats'] ?? $t['total_seats'] ?? 0);
        if ($combinedSeats === 0 && !empty($seatTypes)) {
            $combinedSeats = array_sum(array_column($seatTypes, 'total_seats'));
        }

        $mappedTrains[] = [
            'train_name' => $t['train_name'] ?? 'Intercity Train',
            'train_model' => $t['train_model'] ?? '',
            'departure_time' => $t['departure_time'] ?? '--',
            'arrival_time' => $t['arrival_time'] ?? '--',
            'off_day' => $t['off_day'] ?? 'None',
            'total_seats' => $combinedSeats,
            'seat_types' => $seatTypes
        ];
    }

    $matrix[] = [
        'date' => $dStr,
        'formatted_date' => formatShohozDoj($dStr),
        'day_name' => date('D', strtotime($dStr)),
        'display_date' => date('M j', strtotime($dStr)),
        'success' => !empty($res['success']),
        'total_trains' => count($trains),
        'total_available_seats' => $totalAvailableSeats,
        'total_online_seats' => $totalOnlineSeats,
        'trains' => $mappedTrains
    ];
}

echo json_encode([
    'success' => true,
    'from_city' => $fromCity,
    'to_city' => $toCity,
    'days_count' => count($matrix),
    'route' => [
        'from' => $fromCity,
        'to' => $toCity,
        'start_date' => $dates[0],
        'end_date' => end($dates),
        'total_days' => count($matrix)
    ],
    'matrix' => $matrix
], JSON_UNESCAPED_UNICODE);
