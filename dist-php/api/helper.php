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

// Global CORS & preflight options handling
if (isset($_SERVER['REQUEST_METHOD'])) {
    if (isset($_SERVER['HTTP_ORIGIN'])) {
        header('Access-Control-Allow-Origin: ' . $_SERVER['HTTP_ORIGIN']);
    } else {
        header("Access-Control-Allow-Origin: *");
    }
    header("Access-Control-Allow-Credentials: true");
    header("Access-Control-Max-Age: 86400");
    header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    header("Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept, Authorization, x-shohoz-token, x-device-id, x-device-key");

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(200);
        exit(0);
    }
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

function getClientRequestHeaders() {
    $headers = [];
    if (function_exists('getallheaders')) {
        $raw = getallheaders();
        if (is_array($raw)) {
            foreach ($raw as $k => $v) {
                $headers[strtolower($k)] = $v;
            }
        }
    }
    foreach ($_SERVER as $key => $val) {
        if (substr($key, 0, 5) === 'HTTP_') {
            $name = strtolower(str_replace('_', '-', substr($key, 5)));
            $headers[$name] = $val;
        }
    }
    return $headers;
}

function decodeShohozProfile($token) {
    if (!$token || !is_string($token)) return null;
    $parts = explode('.', $token);
    if (count($parts) >= 2) {
        $payloadJson = base64_decode(strtr($parts[1], '-_', '+/'));
        $payload = json_decode($payloadJson, true);
        if (is_array($payload)) {
            return [
                'name' => $payload['display_name'] ?? $payload['name'] ?? 'Verified Passenger',
                'phone' => $payload['phone_number'] ?? $payload['username'] ?? '01XXXXXXXXX',
                'email' => $payload['email'] ?? 'eticket@railway.gov.bd',
                'nid' => $payload['nidn'] ?? '************',
                'nidType' => $payload['nidnt'] ?? 'NID',
                'locale' => $payload['locale'] ?? 'bn-BD',
                'roles' => isset($payload['role']) && is_array($payload['role']) ? $payload['role'] : ['user'],
                'expiresAt' => isset($payload['exp']) ? date('c', $payload['exp']) : null,
                'isExpired' => isset($payload['exp']) ? (time() > $payload['exp']) : false
            ];
        }
    }
    return null;
}

function generateShohozDeviceId() {
    return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

function generateShohozDeviceKey($seed = '') {
    $s = !empty($seed) ? $seed : (microtime(true) . bin2hex(random_bytes(16)));
    $p1 = hash('sha256', $s . '_shohoz_k1');
    $p2 = hash('sha256', $p1 . '_shohoz_k2');
    $p3 = hash('sha256', $p2 . '_shohoz_k3');
    return substr($p1 . $p2 . $p3, 0, 160);
}

function getSavedSession() {
    $reqHeaders = getClientRequestHeaders();

    // 1. Check direct client header pass-through
    $bearerToken = '';
    if (!empty($reqHeaders['x-shohoz-token'])) {
        $bearerToken = trim($reqHeaders['x-shohoz-token']);
    } elseif (!empty($_SERVER['HTTP_X_SHOHOZ_TOKEN'])) {
        $bearerToken = trim($_SERVER['HTTP_X_SHOHOZ_TOKEN']);
    }

    $reqDeviceId = $reqHeaders['x-device-id'] ?? ($_SERVER['HTTP_X_DEVICE_ID'] ?? '');
    $reqDeviceKey = $reqHeaders['x-device-key'] ?? ($_SERVER['HTTP_X_DEVICE_KEY'] ?? '');
    if (strtolower($reqDeviceKey) === 'web') {
        $reqDeviceKey = '';
    }

    // 2. Check dedicated session.json file if present
    if (file_exists(SESSION_FILE)) {
        $data = json_decode(file_get_contents(SESSION_FILE), true);
        if (is_array($data) && !empty($data['token'])) {
            $sessKey = $data['deviceKey'] ?? $data['device_key'] ?? '';
            if (empty($sessKey) || strtolower($sessKey) === 'web' || strlen($sessKey) < 32) {
                $sessKey = (!empty($reqDeviceKey) && strlen($reqDeviceKey) >= 32) ? $reqDeviceKey : generateShohozDeviceKey($data['token']);
            }
            return [
                'token' => $data['token'],
                'deviceId' => $data['deviceId'] ?? $data['device_id'] ?? ($reqDeviceId ?: '34a817c48b87571632d2a7a1d50575a4'),
                'deviceKey' => $sessKey,
                'user' => $data['user'] ?? decodeShohozProfile($data['token'])
            ];
        }
    }

    // 3. Fallback: check users.json for active user with shohozSession
    $usersFile = DATA_DIR . '/users.json';
    if (file_exists($usersFile)) {
        $usersData = json_decode(file_get_contents($usersFile), true);
        if (isset($usersData['users']) && is_array($usersData['users'])) {
            foreach ($usersData['users'] as $u) {
                if (isset($u['shohozSession']['token']) && !empty($u['shohozSession']['token'])) {
                    $uKey = $u['shohozSession']['deviceKey'] ?? '';
                    if (empty($uKey) || strtolower($uKey) === 'web' || strlen($uKey) < 32) {
                        $uKey = (!empty($reqDeviceKey) && strlen($reqDeviceKey) >= 32) ? $reqDeviceKey : generateShohozDeviceKey($u['shohozSession']['token']);
                    }
                    return [
                        'token' => $u['shohozSession']['token'],
                        'deviceId' => $u['shohozSession']['deviceId'] ?? ($reqDeviceId ?: '34a817c48b87571632d2a7a1d50575a4'),
                        'deviceKey' => $uKey,
                        'user' => $u['shohozSession']['user'] ?? decodeShohozProfile($u['shohozSession']['token'])
                    ];
                }
            }
        }
    }

    // 4. Return client passed token if available
    if (!empty($bearerToken)) {
        $clientKey = (!empty($reqDeviceKey) && strlen($reqDeviceKey) >= 32) ? $reqDeviceKey : generateShohozDeviceKey($bearerToken);
        return [
            'token' => $bearerToken,
            'deviceId' => $reqDeviceId ?: '34a817c48b87571632d2a7a1d50575a4',
            'deviceKey' => $clientKey,
            'user' => decodeShohozProfile($bearerToken)
        ];
    }

    return [
        'token' => '',
        'deviceId' => $reqDeviceId,
        'deviceKey' => $reqDeviceKey,
        'user' => null
    ];
}

function saveSessionData($data) {
    if (empty($data['deviceKey']) || strtolower($data['deviceKey']) === 'web' || strlen($data['deviceKey']) < 32) {
        $data['deviceKey'] = generateShohozDeviceKey(($data['deviceId'] ?? '') . ($data['token'] ?? ''));
    }
    @file_put_contents(SESSION_FILE, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    
    // Also update users.json first user's shohozSession if present so it persists in users.json
    $usersFile = DATA_DIR . '/users.json';
    if (file_exists($usersFile)) {
        $usersData = json_decode(file_get_contents($usersFile), true);
        if (isset($usersData['users']) && is_array($usersData['users']) && count($usersData['users']) > 0) {
            $usersData['users'][0]['shohozSession'] = [
                'token' => $data['token'] ?? '',
                'deviceId' => $data['deviceId'] ?? '',
                'deviceKey' => $data['deviceKey'],
                'user' => $data['user'] ?? null,
                'lastUpdated' => date('c')
            ];
            @file_put_contents($usersFile, json_encode($usersData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        }
    }
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
    $sendDevKey = (!empty($session['deviceKey']) && strtolower($session['deviceKey']) !== 'web') ? trim($session['deviceKey']) : (!empty($session['token']) ? generateShohozDeviceKey($session['token']) : '');
    if (!empty($sendDevKey)) {
        $headers[] = 'x-device-key: ' . $sendDevKey;
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
            $seatCounts = $st['seat_counts'] ?? [];
            $online = (int)($st['seats_available'] ?? $st['online_available_seats'] ?? $st['online_seats'] ?? $seatCounts['online'] ?? 0);
            $offline = (int)($st['counter_seats_available'] ?? $st['offline_available_seats'] ?? $st['counter_seats'] ?? $seatCounts['offline'] ?? 0);

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

        $depTime = $item['departure_time'] ?? '';
        if (empty($depTime) && !empty($item['departure_date_time'])) {
            $depTime = $item['departure_date_time'];
            if (strpos($depTime, ',') !== false) {
                $depParts = explode(',', $depTime);
                $depTime = trim(end($depParts));
            }
        }

        $arrTime = $item['arrival_time'] ?? '';
        if (empty($arrTime) && !empty($item['arrival_date_time'])) {
            $arrTime = $item['arrival_date_time'];
            if (strpos($arrTime, ',') !== false) {
                $arrParts = explode(',', $arrTime);
                $arrTime = trim(end($arrParts));
            }
        }

        $tripId = $item['trip_id'] ?? (!empty($seatClasses[0]['trip_id']) ? $seatClasses[0]['trip_id'] : 'TRIP_' . rand(1000, 9999));

        $trains[] = [
            'trip_id' => $tripId,
            'train_name' => $item['train_name'] ?? $item['trip_number'] ?? 'Intercity Train',
            'train_model' => $item['train_model'] ?? $item['train_number'] ?? 'N/A',
            'departure_station' => $item['departure_station'] ?? $fromCity,
            'departure_time' => $depTime ?: '--',
            'arrival_station' => $item['arrival_station'] ?? $toCity,
            'arrival_time' => $arrTime ?: '--',
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

/**
 * Compute human-readable off-day name from active operating days array
 */
function computeOffDayFromDays($days) {
    if (!is_array($days) || count($days) === 0) return 'None';
    if (count($days) >= 7) return 'None';

    $allDays = ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
    $dayNames = [
        'Sun' => 'Sunday',
        'Mon' => 'Monday',
        'Tue' => 'Tuesday',
        'Wed' => 'Wednesday',
        'Thu' => 'Thursday',
        'Fri' => 'Friday',
        'Sat' => 'Saturday'
    ];

    $missing = array_diff($allDays, $days);
    if (empty($missing)) return 'None';

    $mapped = array_map(function($d) use ($dayNames) {
        return $dayNames[$d] ?? $d;
    }, $missing);

    return implode(', ', $mapped);
}

/**
 * Fetch and cache train route and stoppages from Shohoz
 */
function getTrainRouteDataPHP($cleanModel, $session = null) {
    if (!$session || empty($session['token'])) {
        $session = getSavedSession();
    }

    $cleanModel = preg_replace('/\D/', '', (string)$cleanModel) ?: (string)$cleanModel;
    if (empty($cleanModel)) return null;

    $cacheFile = CACHE_DIR . "/route_{$cleanModel}.json";
    if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 86400)) {
        $cached = json_decode(file_get_contents($cacheFile), true);
        if (is_array($cached) && !empty($cached['routes'])) {
            $cached['off_day'] = computeOffDayFromDays($cached['days'] ?? []);
            return $cached;
        }
    }

    $headers = [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept: application/json, text/plain, */*',
        'Content-Type: application/json',
        'Origin: https://eticket.railway.gov.bd',
        'Referer: https://eticket.railway.gov.bd/train-information'
    ];

    if (!empty($session['token'])) $headers[] = 'Authorization: Bearer ' . trim($session['token']);
    if (!empty($session['deviceId'])) $headers[] = 'x-device-id: ' . trim($session['deviceId']);
    $routeDevKey = (!empty($session['deviceKey']) && strtolower($session['deviceKey']) !== 'web') ? trim($session['deviceKey']) : (!empty($session['token']) ? generateShohozDeviceKey($session['token']) : '');
    if (!empty($routeDevKey)) $headers[] = 'x-device-key: ' . $routeDevKey;

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'https://railspaapi.shohoz.com/v1.0/web/train-routes');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['model' => $cleanModel]));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

    $rawResponse = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode($rawResponse, true);
    if ($httpCode === 200 && isset($data['data']) && is_array($data['data'])) {
        $routeData = $data['data'];
        $routeData['off_day'] = computeOffDayFromDays($routeData['days'] ?? []);
        @file_put_contents($cacheFile, json_encode($routeData, JSON_UNESCAPED_UNICODE));
        return $routeData;
    }

    return null;
}

/**
 * Query Multiple Shohoz Trips in Parallel using curl_multi
 * @param array $queries Array of ['key' => ..., 'from' => ..., 'to' => ..., 'date' => ...]
 * @param array|null $session
 * @param int $batchSize
 * @return array Keyed by 'key' => normalized response array
 */
function queryShohozTripsParallel($queries, $session = null, $batchSize = 4) {
    if (!$session || empty($session['token'])) {
        $session = getSavedSession();
    }

    if (empty($session['token'])) {
        $emptyResults = [];
        foreach ($queries as $q) {
            $key = $q['key'] ?? ($q['from'] . '_' . $q['to'] . '_' . $q['date']);
            $emptyResults[$key] = [
                'success' => false,
                'auth_required' => true,
                'error' => 'Live Shohoz session is required.',
                'trains' => []
            ];
        }
        return $emptyResults;
    }

    $results = [];
    $toExecute = [];

    // Check transient cache first
    foreach ($queries as $q) {
        $key = $q['key'] ?? ($q['from'] . '_' . $q['to'] . '_' . $q['date']);
        $canonicalFrom = getCanonicalStationName($q['from']);
        $canonicalTo = getCanonicalStationName($q['to']);
        $formattedDate = formatShohozDoj($q['date']);
        $cacheFile = CACHE_DIR . '/trip_' . md5("{$canonicalFrom}|{$canonicalTo}|{$formattedDate}") . '.json';

        if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 45)) {
            $cached = json_decode(file_get_contents($cacheFile), true);
            if (is_array($cached) && !empty($cached['success'])) {
                $results[$key] = $cached;
                continue;
            }
        }

        $toExecute[] = [
            'key' => $key,
            'from' => $canonicalFrom,
            'to' => $canonicalTo,
            'date' => $formattedDate,
            'cacheFile' => $cacheFile
        ];
    }

    if (empty($toExecute)) {
        return $results;
    }

    $commonHeaders = [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept: application/json, text/plain, */*',
        'Accept-Language: en-US,en;q=0.9,bn;q=0.8',
        'Origin: https://eticket.railway.gov.bd',
        'Referer: https://eticket.railway.gov.bd/',
        'Authorization: Bearer ' . trim($session['token'])
    ];
    if (!empty($session['deviceId'])) $commonHeaders[] = 'x-device-id: ' . trim($session['deviceId']);
    $multiDevKey = (!empty($session['deviceKey']) && strtolower($session['deviceKey']) !== 'web') ? trim($session['deviceKey']) : (!empty($session['token']) ? generateShohozDeviceKey($session['token']) : '');
    if (!empty($multiDevKey)) $commonHeaders[] = 'x-device-key: ' . $multiDevKey;

    // Chunk into batches of $batchSize
    $chunks = array_chunk($toExecute, max(1, $batchSize));

    foreach ($chunks as $chunk) {
        $mh = curl_multi_init();
        $handles = [];

        foreach ($chunk as $item) {
            $url = "https://railspaapi.shohoz.com/v1.0/web/bookings/search-trips-v2?from_city=" . urlencode($item['from']) . "&to_city=" . urlencode($item['to']) . "&date_of_journey=" . urlencode($item['date']) . "&seat_class=S_CHAIR";
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, $commonHeaders);
            curl_setopt($ch, CURLOPT_TIMEOUT, 8);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_multi_add_handle($mh, $ch);
            $handles[$item['key']] = [
                'handle' => $ch,
                'item' => $item
            ];
        }

        $active = null;
        do {
            $mrc = curl_multi_exec($mh, $active);
        } while ($mrc === CURLM_CALL_MULTI_PERFORM);

        while ($active && $mrc === CURLM_OK) {
            if (curl_multi_select($mh, 0.2) === -1) {
                usleep(10000);
            }
            do {
                $mrc = curl_multi_exec($mh, $active);
            } while ($mrc === CURLM_CALL_MULTI_PERFORM);
        }

        foreach ($handles as $key => $hData) {
            $ch = $hData['handle'];
            $item = $hData['item'];
            $raw = curl_multi_getcontent($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);

            $decoded = json_decode($raw, true);
            if ($httpCode === 200 && is_array($decoded)) {
                $norm = normalizeShohozResponsePHP($decoded, $item['from'], $item['to'], $item['date']);
                @file_put_contents($item['cacheFile'], json_encode($norm, JSON_UNESCAPED_UNICODE));
                $results[$key] = $norm;
            } else {
                $results[$key] = [
                    'success' => false,
                    'from_city' => $item['from'],
                    'to_city' => $item['to'],
                    'date_of_journey' => $item['date'],
                    'trains' => []
                ];
            }
        }

        curl_multi_close($mh);
    }

    return $results;
}

