<?php
/**
 * Route Trains & Seat Classes discovery endpoint (Exact Date & Route Aware)
 * Matches Shohoz API / Bangladesh Railway server in real-time
 */
require_once __DIR__ . '/helper.php';

header('Content-Type: application/json; charset=utf-8');

$fromCity = $_GET['from_city'] ?? '';
$toCity = $_GET['to_city'] ?? '';
$dateOfJourney = $_GET['date_of_journey'] ?? '';

if (empty($fromCity) || empty($toCity)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'from_city and to_city parameters are required.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$canonicalFrom = getCanonicalStationName($fromCity);
$canonicalTo = getCanonicalStationName($toCity);

if (empty($dateOfJourney)) {
    $dateOfJourney = date('Y-m-d', strtotime('+1 day'));
}
$formattedDate = formatShohozDoj($dateOfJourney);

// Check cache for this exact route & date (TTL 10 mins)
$cacheKey = strtolower($canonicalFrom . '_' . $canonicalTo . '_' . $formattedDate);
$cacheFile = CACHE_DIR . '/route_trains_' . md5($cacheKey) . '.json';

if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 600)) {
    $cachedData = json_decode(file_get_contents($cacheFile), true);
    if (is_array($cachedData) && !empty($cachedData['trains'])) {
        $cachedData['source'] = 'cache';
        echo json_encode($cachedData, JSON_UNESCAPED_UNICODE);
        exit;
    }
}

// Query live Shohoz trips
$liveResult = queryShohozSearch($canonicalFrom, $canonicalTo, $dateOfJourney);
$trips = $liveResult['trains'] ?? [];

if (!empty($trips)) {
    $trains = [];
    $classSet = [];

    foreach ($trips as $t) {
        $tClasses = [];
        if (!empty($t['seat_types']) && is_array($t['seat_types'])) {
            foreach ($t['seat_types'] as $st) {
                $type = strtoupper((string)($st['type'] ?? ''));
                if (!empty($type)) {
                    $tClasses[] = $type;
                    $classSet[$type] = true;
                }
            }
        }

        $trains[] = [
            'name' => $t['train_name'] ?? 'Intercity Train',
            'train_name' => $t['train_name'] ?? 'Intercity Train',
            'model' => $t['train_model'] ?? '',
            'train_model' => $t['train_model'] ?? '',
            'departure_time' => $t['departure_time'] ?? '',
            'arrival_time' => $t['arrival_time'] ?? '',
            'classes' => array_values(array_unique($tClasses))
        ];
    }

    $response = [
        'success' => true,
        'from' => $canonicalFrom,
        'to' => $canonicalTo,
        'date_of_journey' => $formattedDate,
        'trains' => $trains,
        'classes' => array_keys($classSet),
        'source' => 'live'
    ];

    @file_put_contents($cacheFile, json_encode($response, JSON_UNESCAPED_UNICODE));
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

// Fallback to local catalog if live query fails or returns empty
$catalogFile = DATA_DIR . '/trains.json';
$catalogMatches = [];
if (file_exists($catalogFile)) {
    $allCatalog = json_decode(file_get_contents($catalogFile), true) ?: [];
    $fLower = strtolower($canonicalFrom);
    $tLower = strtolower($canonicalTo);

    foreach ($allCatalog as $t) {
        $f = strtolower((string)($t['from'] ?? ''));
        $to = strtolower((string)($t['to'] ?? ''));
        if ((strpos($f, $fLower) !== false || strpos($fLower, $f) !== false) &&
            (strpos($to, $tLower) !== false || strpos($tLower, $to) !== false)) {
            $catalogMatches[] = [
                'name' => $t['name'] ?? $t['train_name'] ?? '',
                'train_name' => $t['name'] ?? $t['train_name'] ?? '',
                'model' => $t['model'] ?? $t['train_model'] ?? '',
                'train_model' => $t['model'] ?? $t['train_model'] ?? '',
                'departure_time' => $t['departure_time'] ?? '',
                'arrival_time' => $t['arrival_time'] ?? '',
                'classes' => ['S_CHAIR', 'SNIGDHA', 'AC_S', 'AC_B', 'F_SEAT', 'F_BERTH', 'SHOVAN', 'SULOB', 'AC_CHAIR']
            ];
        }
    }
}

echo json_encode([
    'success' => true,
    'from' => $canonicalFrom,
    'to' => $canonicalTo,
    'date_of_journey' => $formattedDate,
    'trains' => $catalogMatches,
    'classes' => ['S_CHAIR', 'SNIGDHA', 'AC_S', 'AC_B', 'F_SEAT', 'F_BERTH', 'SHOVAN', 'SULOB', 'AC_CHAIR'],
    'source' => 'catalog'
], JSON_UNESCAPED_UNICODE);
