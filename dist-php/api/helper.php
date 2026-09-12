<?php
/**
 * Shared Helper: Session management, Shohoz live API client, caching & station resolution
 */

define('DATA_DIR', dirname(__DIR__) . '/data');
define('SESSION_FILE', DATA_DIR . '/session.json');
define('STATIONS_FILE', DATA_DIR . '/stations.json');
define('TRAINS_FILE', DATA_DIR . '/trains.json');
define('CACHE_DIR', DATA_DIR . '/cache');

// Ensure data and cache directories exist
if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0755, true);
}
if (!is_dir(CACHE_DIR)) {
    @mkdir(CACHE_DIR, 0755, true);
}

// Station alias dictionary matching server.js
$GLOBALS['STATION_ALIASES'] = [
    'airport' => 'Biman_Bandar',
    'dhaka airport' => 'Biman_Bandar',
    'biman bandar' => 'Biman_Bandar',
    'bimanbandar' => 'Biman_Bandar',
    'biman_bandor' => 'Biman_Bandar',
    'chittagong' => 'Chattogram',
    'ctg' => 'Chattogram',
    'chottogram' => 'Chattogram',
    'chattagram' => 'Chattogram',
    'comilla' => 'Cumilla',
    'cumilla junction' => 'Cumilla',
    'bogra' => 'Bogura',
    'bogura' => 'Bogura',
    'jessore' => 'Jashore',
    'jashore' => 'Jashore',
    'barisal' => 'Barishal',
    'coxs bazar' => "Cox's Bazar",
    'coxsbazar' => "Cox's Bazar",
    "cox's_bazar" => "Cox's Bazar",
    'coxs_bazar' => "Cox's Bazar",
    'jamalpur' => 'Jamalpur_Town',
    'jamalpur town' => 'Jamalpur_Town',
    'cantonment' => 'Dhaka_Cantonment',
    'dhaka cantonment' => 'Dhaka_Cantonment',
    'bhairab' => 'Bhairab_Bazar',
    'bhairab bazar' => 'Bhairab_Bazar',
    'b.baria' => 'Brahmanbaria',
    'b-baria' => 'Brahmanbaria',
    'b baria' => 'Brahmanbaria',
    'brahman baria' => 'Brahmanbaria',
    'dewanganj' => 'Dewanganj_Bazar',
    'sayedpur' => 'Saidpur',
    'syedpur' => 'Saidpur',
    'bhanga' => 'Bhanga_Junction',
    'chandpur' => 'Chandpur_Court',
    'kushtia' => 'Kushtia_Court',
    'sreemangal' => 'Sreemangal',
    'parbatipur' => 'Parbatipur',
    'santahar' => 'Santahar',
    'mymensingh' => 'Mymensingh',
    'tongi' => 'Tongi',
    'joydebpur' => 'Joydebpur',
    'gazipur' => 'Joydebpur',
    'ishwardi' => 'Ishwardi',
    'poradah' => 'Poradah',
    'khulna' => 'Khulna',
    'rajshahi' => 'Rajshahi',
    'sylhet' => 'Sylhet',
    'dinajpur' => 'Dinajpur',
    'rangpur' => 'Rangpur'
];

function getCanonicalStationName($raw) {
    if (!$raw) return '';
    $clean = trim((string)$raw);
    $lower = strtolower($clean);

    if (isset($GLOBALS['STATION_ALIASES'][$lower])) {
        return $GLOBALS['STATION_ALIASES'][$lower];
    }

    if (file_exists(STATIONS_FILE)) {
        $stations = json_decode(file_get_contents(STATIONS_FILE), true);
        if (is_array($stations)) {
            foreach ($stations as $s) {
                if (isset($s['name']) && strtolower($s['name']) === $lower) {
                    return $s['name'];
                }
                if (isset($s['display_name']) && strtolower($s['display_name']) === $lower) {
                    return $s['name'];
                }
                if (isset($s['bn_name']) && $s['bn_name'] === $clean) {
                    return $s['name'];
                }
            }
        }
    }

    return str_replace(' ', '_', $clean);
}

function getSavedSession() {
    if (file_exists(SESSION_FILE)) {
        $data = json_decode(file_get_contents(SESSION_FILE), true);
        if (is_array($data) && !empty($data['token'])) {
            return $data;
        }
    }
    return [
        'token' => '',
        'deviceId' => '',
        'deviceKey' => 'web',
        'user' => null
    ];
}

function saveSessionData($data) {
    file_put_contents(SESSION_FILE, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function formatShohozDoj($dateStr) {
    if (!$dateStr) return '';
    $months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (strpos($dateStr, '-') !== false) {
        $parts = explode('-', $dateStr);
        if (count($parts) === 3) {
            if (strlen($parts[0]) === 4) {
                $y = $parts[0];
                $mIdx = (int)$parts[1] - 1;
                $d = str_pad($parts[2], 2, '0', STR_PAD_LEFT);
                if ($mIdx >= 0 && $mIdx < 12) {
                    return "{$d}-{$months[$mIdx]}-{$y}";
                }
            }
        }
    }
    $ts = strtotime($dateStr);
    if ($ts === false) return $dateStr;
    return date('d-M-Y', $ts);
}

/**
 * Perform Shohoz Search Query with cURL
 */
function queryShohozSearch($fromCity, $toCity, $dateStr, $session = null) {
    if (!$session || empty($session['token'])) {
        $session = getSavedSession();
    }

    if (empty($session['token'])) {
        return [
            'success' => false,
            'auth_required' => true,
            'error' => 'Live Shohoz session is required. Please click "Connect Live API" to pair your session.',
            'trains' => []
        ];
    }

    $canonicalFrom = getCanonicalStationName($fromCity);
    $canonicalTo = getCanonicalStationName($toCity);
    $formattedDate = formatShohozDoj($dateStr);

    $targetUrl = "https://railspaapi.shohoz.com/v1.0/web/bookings/search-trips-v2?from_city=" . urlencode($canonicalFrom) . "&to_city=" . urlencode($canonicalTo) . "&date_of_journey=" . urlencode($formattedDate) . "&seat_class=S_CHAIR";

    $headers = [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept: application/json, text/plain, */*',
        'Accept-Language: en-US,en;q=0.9,bn;q=0.8',
        'Origin: https://eticket.railway.gov.bd',
        'Referer: https://eticket.railway.gov.bd/',
        'Authorization: Bearer ' . trim($session['token'])
    ];

    if (!empty($session['deviceId'])) {
        $headers[] = 'x-device-id: ' . trim($session['deviceId']);
    }
    if (!empty($session['deviceKey'])) {
        $headers[] = 'x-device-key: ' . trim($session['deviceKey']);
    }

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $targetUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 12);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

    $rawResponse = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        return [
            'success' => false,
            'error' => 'Network error connecting to Bangladesh Railway: ' . $curlError,
            'trains' => []
        ];
    }

    $data = json_decode($rawResponse, true);

    if ($httpCode === 200 && is_array($data)) {
        if (!empty($data['error']['code'])) {
            return [
                'success' => false,
                'rate_limited' => true,
                'error' => implode(', ', $data['error']['messages'] ?? ['Shohoz request cooldown active']),
                'trains' => []
            ];
        }

        return normalizeShohozResponsePHP($data, $canonicalFrom, $canonicalTo, $formattedDate);
    }

    if ($httpCode === 401) {
        return [
            'success' => false,
            'auth_error' => true,
            'session_expired' => true,
            'error' => 'Your Shohoz session has expired. Please click "Connect Live API" to copy a fresh token from eticket.railway.gov.bd.',
            'trains' => []
        ];
    }

    if ($httpCode === 429) {
        return [
            'success' => false,
            'rate_limited' => true,
            'error' => 'Shohoz traffic cooldown active (3-5s). Please wait a moment.',
            'trains' => []
        ];
    }

    return [
        'success' => false,
        'error' => "Shohoz gateway returned HTTP $httpCode. Please try again shortly.",
        'trains' => []
    ];
}

function normalizeShohozResponsePHP($data, $fromCity, $toCity, $dateStr) {
    $rawTrains = [];
    if (isset($data['data']['trains']) && is_array($data['data']['trains'])) {
        $rawTrains = $data['data']['trains'];
    } elseif (isset($data['data']['trips']) && is_array($data['data']['trips'])) {
        $rawTrains = $data['data']['trips'];
    } elseif (isset($data['data']) && is_array($data['data'])) {
        $rawTrains = $data['data'];
    }

    $trains = [];
    foreach ($rawTrains as $item) {
        $rawSeatTypes = $item['seat_types'] ?? $item['seat_classes'] ?? $item['seats'] ?? [];
        $seatClasses = [];

        foreach ($rawSeatTypes as $st) {
            $online = (int)($st['seats_available'] ?? $st['online_available_seats'] ?? $st['online_seats'] ?? 0);
            $offline = (int)($st['counter_seats_available'] ?? $st['offline_available_seats'] ?? $st['counter_seats'] ?? 0);

            $baseFare = (float)($st['fare'] ?? $st['ticket_fare'] ?? $st['price'] ?? 0);
            $vat = (float)($st['vat'] ?? $st['vat_amount'] ?? 0);
            $totalFare = (float)($st['total_fare'] ?? ($baseFare + $vat));

            $type = strtoupper((string)($st['type'] ?? $st['seat_class'] ?? 'UNKNOWN'));

            $seatClasses[] = [
                'type' => $type,
                'display_name' => $st['display_name'] ?? $st['seat_class_name'] ?? $type,
                'fare' => $baseFare,
                'vat' => $vat,
                'total_fare' => $totalFare,
                'seats_available' => $online,
                'counter_seats_available' => $offline,
                'is_available' => $online > 0
            ];
        }

        $totalOnline = array_sum(array_column($seatClasses, 'seats_available'));
        $totalOffline = array_sum(array_column($seatClasses, 'counter_seats_available'));

        $trains[] = [
            'trip_id' => $item['trip_id'] ?? 'TRIP_' . rand(1000, 9999),
            'train_name' => $item['train_name'] ?? $item['trip_number'] ?? 'Intercity Train',
            'train_model' => $item['train_model'] ?? $item['train_number'] ?? 'N/A',
            'departure_station' => $item['departure_station'] ?? $fromCity,
            'departure_time' => $item['departure_time'] ?? '--',
            'arrival_station' => $item['arrival_station'] ?? $toCity,
            'arrival_time' => $item['arrival_time'] ?? '--',
            'travel_time' => $item['travel_time'] ?? $item['duration'] ?? '',
            'off_day' => $item['off_day'] ?? 'None',
            'seat_types' => $seatClasses,
            'total_available_seats' => $totalOnline,
            'total_online_seats' => $totalOnline,
            'total_offline_seats' => $totalOffline,
            'total_combined_seats' => ($totalOnline + $totalOffline)
        ];
    }

    return [
        'success' => true,
        'from_city' => $fromCity,
        'to_city' => $toCity,
        'date_of_journey' => $dateStr,
        'trains_count' => count($trains),
        'trains' => $trains
    ];
}
