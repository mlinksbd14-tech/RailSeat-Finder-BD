<?php
/**
 * Stops Matrix for All Stations - Segment Vacancy & Fares Matrix
 * Queries live seats across all stoppage pairs for a given train
 */
require_once __DIR__ . '/helper.php';

$model = trim($_GET['model'] ?? '');
$doj = trim($_GET['date_of_journey'] ?? $_GET['date'] ?? '');

if (empty($model) || empty($doj)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'model (train number) and date_of_journey are required.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$session = getSavedSession();
if (empty($session['token'])) {
    echo json_encode([
        'success' => false,
        'auth_required' => true,
        'error' => 'Live Shohoz session is required. Please click "Connect Live API" to pair your session.',
        'segments' => []
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$cleanModel = preg_replace('/\D/', '', $model) ?: $model;
$routeData = getTrainRouteDataPHP($cleanModel, $session);

if (!$routeData || empty($routeData['routes'])) {
    echo json_encode([
        'success' => false,
        'error' => "Could not retrieve stoppage stations for train #$cleanModel."
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$rawStops = $routeData['routes'];
$stops = [];
foreach ($rawStops as $s) {
    $city = $s['city'] ?? '';
    $cleanCity = trim(str_replace('_', ' ', $city));
    $stops[] = [
        'city' => $city,
        'cleanCity' => $cleanCity,
        'queryCity' => $city,
        'arrival_time' => $s['arrival_time'] ?? '--',
        'departure_time' => $s['departure_time'] ?? '--',
        'halt' => !empty($s['halt']) ? "{$s['halt']} min" : ''
    ];
}

// Parse Boarding and Destination filters (supports single, comma-separated, or 'ALL')
$parseStationList = function($param) {
    if (!$param || $param === 'ALL') return null;
    $list = is_array($param) ? $param : explode(',', $param);
    $cleanList = [];
    foreach ($list as $s) {
        $c = strtolower(trim(str_replace('_', ' ', (string)$s)));
        if (!empty($c)) $cleanList[] = $c;
    }
    return !empty($cleanList) ? $cleanList : null;
};

$selectedFromList = $parseStationList($_GET['from_station'] ?? '');
$selectedToList = $parseStationList($_GET['to_station'] ?? '');

$targetPairs = [];
$numStops = count($stops);

for ($i = 0; $i < $numStops - 1; $i++) {
    $originStop = $stops[$i];
    $originClean = strtolower($originStop['cleanCity']);
    $originRaw = strtolower($originStop['city']);

    if ($selectedFromList !== null && !in_array($originClean, $selectedFromList, true) && !in_array($originRaw, $selectedFromList, true)) {
        continue;
    }

    for ($j = $i + 1; $j < $numStops; $j++) {
        $destStop = $stops[$j];
        $destClean = strtolower($destStop['cleanCity']);
        $destRaw = strtolower($destStop['city']);

        if ($selectedToList !== null && !in_array($destClean, $selectedToList, true) && !in_array($destRaw, $selectedToList, true)) {
            continue;
        }

        $targetPairs[] = [
            'from' => $originStop['queryCity'],
            'fromClean' => $originStop['cleanCity'],
            'fromDep' => $originStop['departure_time'],
            'to' => $destStop['queryCity'],
            'toClean' => $destStop['cleanCity'],
            'toArr' => $destStop['arrival_time']
        ];
    }
}

$dojStr = formatShohozDoj($doj);

if (empty($targetPairs)) {
    echo json_encode([
        'success' => true,
        'train_name' => $routeData['train_name'] ?? "Train #$cleanModel",
        'train_model' => $cleanModel,
        'date' => $doj,
        'display_date' => $dojStr,
        'off_day' => $routeData['off_day'] ?? 'None',
        'stoppages' => $stops,
        'segments' => []
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Prepare queries for parallel execution in batches
$queries = [];
foreach ($targetPairs as $idx => $pair) {
    $queries[] = [
        'key' => (string)$idx,
        'from' => $pair['from'],
        'to' => $pair['to'],
        'date' => $dojStr
    ];
}

$queryResults = queryShohozTripsParallel($queries, $session, 4);

$cleanModelDigits = preg_replace('/\D/', '', $cleanModel);
$cleanTargetName = strtolower(preg_replace('/[^a-z0-9]/', '', (string)($routeData['train_name'] ?? '')));

$segments = [];
foreach ($targetPairs as $idx => $pair) {
    $res = $queryResults[(string)$idx] ?? null;
    $trains = $res['trains'] ?? [];
    $canonicalFrom = getCanonicalStationName($pair['from']);
    $canonicalTo = getCanonicalStationName($pair['to']);

    $matchingTrain = null;
    foreach ($trains as $t) {
        $tModelDigits = preg_replace('/\D/', '', (string)($t['train_model'] ?? ''));
        if ($tModelDigits && $cleanModelDigits && $tModelDigits === $cleanModelDigits) {
            $matchingTrain = $t;
            break;
        }
        $tName = strtolower(preg_replace('/[^a-z0-9]/', '', (string)($t['train_name'] ?? '')));
        if ($tName && $cleanTargetName && (strpos($tName, $cleanTargetName) !== false || strpos($cleanTargetName, $tName) !== false)) {
            $matchingTrain = $t;
            break;
        }
    }

    if ($matchingTrain) {
        $totalOnline = (int)($matchingTrain['total_online_seats'] ?? 0);
        $totalOffline = (int)($matchingTrain['total_offline_seats'] ?? 0);
        $totalSeats = (int)($matchingTrain['total_combined_seats'] ?? ($totalOnline + $totalOffline));

        $seatTypes = $matchingTrain['seat_types'] ?? [];
        $bookClass = 'S_CHAIR';
        foreach ($seatTypes as $st) {
            $avail = (int)($st['seats_available'] ?? 0) + (int)($st['counter_seats_available'] ?? 0);
            if ($avail > 0 && !empty($st['type'])) {
                $bookClass = $st['type'];
                break;
            }
        }
        if (empty($bookClass) && !empty($seatTypes[0]['type'])) {
            $bookClass = $seatTypes[0]['type'];
        }

        $bookUrl = "https://eticket.railway.gov.bd/booking/train/search?fromcity=" . urlencode($canonicalFrom) . "&tocity=" . urlencode($canonicalTo) . "&doj=" . urlencode($dojStr) . "&class=" . urlencode($bookClass);

        $segments[] = [
            'from' => $pair['fromClean'],
            'to' => $pair['toClean'],
            'departure_time' => !empty($matchingTrain['departure_time']) ? $matchingTrain['departure_time'] : $pair['fromDep'],
            'arrival_time' => !empty($matchingTrain['arrival_time']) ? $matchingTrain['arrival_time'] : $pair['toArr'],
            'travel_time' => $matchingTrain['travel_time'] ?? '',
            'total_seats' => $totalSeats,
            'online_seats' => $totalOnline,
            'offline_seats' => $totalOffline,
            'has_seats' => $totalSeats > 0,
            'seat_types' => $seatTypes,
            'book_url' => $bookUrl
        ];
    } else {
        $segments[] = [
            'from' => $pair['fromClean'],
            'to' => $pair['toClean'],
            'departure_time' => $pair['fromDep'] ?: '--',
            'arrival_time' => $pair['toArr'] ?: '--',
            'travel_time' => '',
            'total_seats' => 0,
            'online_seats' => 0,
            'offline_seats' => 0,
            'has_seats' => false,
            'seat_types' => [],
            'book_url' => "https://eticket.railway.gov.bd/booking/train/search?fromcity=" . urlencode($canonicalFrom) . "&tocity=" . urlencode($canonicalTo) . "&doj=" . urlencode($dojStr) . "&class=S_CHAIR"
        ];
    }
}

echo json_encode([
    'success' => true,
    'train_name' => $routeData['train_name'] ?? "Train #$cleanModel",
    'train_model' => $cleanModel,
    'date' => $doj,
    'display_date' => $dojStr,
    'off_day' => $routeData['off_day'] ?? 'None',
    'stoppages' => $stops,
    'segments' => $segments
], JSON_UNESCAPED_UNICODE);
