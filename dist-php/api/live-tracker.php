<?php
/**
 * RailSeat Finder BD - GPS Train Radar LIVE FEED API Router
 * Endpoints handled:
 *  - GET  /api/live-tracker/running-trains
 *  - GET  /api/live-tracker/train/{trainNo}
 *  - GET/POST /api/live-tracker/rail-curve
 *  - GET  /api/live-tracker/coordinates
 */

require_once __DIR__ . '/helper.php';

define('LIVE_CACHE_DIR', DATA_DIR . '/cache/live_tracker');
if (!is_dir(LIVE_CACHE_DIR)) {
    @mkdir(LIVE_CACHE_DIR, 0755, true);
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Load station coordinates
$coordsFile = DATA_DIR . '/station_coordinates.json';
$stationCoords = [];
if (file_exists($coordsFile)) {
    $decoded = json_decode(file_get_contents($coordsFile), true);
    if (is_array($decoded)) $stationCoords = $decoded;
}

function getCoordsForStation($name, $stationCoords) {
    if (!$name) return null;
    $clean = trim($name);
    if (isset($stationCoords[$clean])) return $stationCoords[$clean];
    $cleanUnder = str_replace(' ', '_', $clean);
    if (isset($stationCoords[$cleanUnder])) return $stationCoords[$cleanUnder];
    $lower = strtolower($clean);
    foreach ($stationCoords as $k => $v) {
        if (strtolower($k) === $lower) return $v;
    }
    return null;
}

function fetchUpstreamHtml($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 12);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language: en-US,en;q=0.9,bn;q=0.8'
    ]);

    $res = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && !empty($res)) {
        return $res;
    }
    return null;
}

// ----------------------------------------------------
// 1. GET /api/live-tracker/coordinates
// ----------------------------------------------------
if (strpos($uri, 'coordinates') !== false) {
    echo json_encode([
        'success' => true,
        'count' => count($stationCoords),
        'coordinates' => $stationCoords
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ----------------------------------------------------
// 2. GET/POST /api/live-tracker/rail-curve
// ----------------------------------------------------
if (strpos($uri, 'rail-curve') !== false) {
    $params = ($method === 'POST') ? (json_decode(file_get_contents('php://input'), true) ?: $_POST) : $_GET;
    $from = trim($params['from'] ?? '');
    $to = trim($params['to'] ?? '');

    $curvesFile = DATA_DIR . '/bd_rail_curves.json';
    $waypoints = $params['waypoints'] ?? null;

    if (is_array($waypoints) && count($waypoints) >= 2) {
        $interpPoints = [];
        for ($w = 0; $w < count($waypoints) - 1; $w++) {
            $p1 = $waypoints[$w];
            $p2 = $waypoints[$w + 1];
            if (is_array($p1) && is_array($p2) && count($p1) >= 2 && count($p2) >= 2) {
                for ($step = 0; $step <= 10; $step++) {
                    if ($w > 0 && $step === 0) continue;
                    $r = $step / 10.0;
                    $interpPoints[] = [
                        round($p1[0] + ($p2[0] - $p1[0]) * $r, 5),
                        round($p1[1] + ($p2[1] - $p1[1]) * $r, 5)
                    ];
                }
            }
        }
        if (count($interpPoints) > 2) {
            echo json_encode(['success' => true, 'coordinates' => $interpPoints]);
            exit;
        }
    }
    if (file_exists($curvesFile) && !empty($from) && !empty($to)) {
        // Read file stream to find matching route without loading 14MB completely if possible
        $raw = file_get_contents($curvesFile);
        $data = json_decode($raw, true);
        $routes = $data['routes'] ?? [];

        $key1 = "{$from}->{$to}";
        $key2 = "{$to}->{$from}";

        if (isset($routes[$key1]) && count($routes[$key1]) > 2) {
            echo json_encode(['success' => true, 'coordinates' => $routes[$key1]]);
            exit;
        }
        if (isset($routes[$key2]) && count($routes[$key2]) > 2) {
            echo json_encode(['success' => true, 'coordinates' => array_reverse($routes[$key2])]);
            exit;
        }

        // Fuzzy search
        $lowerFrom = strtolower($from);
        $lowerTo = strtolower($to);
        foreach ($routes as $k => $coords) {
            if (!is_array($coords) || count($coords) <= 2) continue;
            $parts = explode('->', $k);
            if (count($parts) === 2) {
                $s1 = strtolower(trim($parts[0]));
                $s2 = strtolower(trim($parts[1]));
                if ((strpos($s1, $lowerFrom) !== false || strpos($lowerFrom, $s1) !== false) &&
                    (strpos($s2, $lowerTo) !== false || strpos($lowerTo, $s2) !== false)) {
                    echo json_encode(['success' => true, 'coordinates' => $coords]);
                    exit;
                }
                if ((strpos($s1, $lowerTo) !== false || strpos($lowerTo, $s1) !== false) &&
                    (strpos($s2, $lowerFrom) !== false || strpos($lowerFrom, $s2) !== false)) {
                    echo json_encode(['success' => true, 'coordinates' => array_reverse($coords)]);
                    exit;
                }
            }
        }
    }

    // Direct geometric linear interpolation fallback if curve not indexed
    $c1 = getCoordsForStation($from, $stationCoords);
    $c2 = getCoordsForStation($to, $stationCoords);
    if ($c1 && $c2) {
        $interp = [];
        for ($i = 0; $i <= 20; $i++) {
            $t = $i / 20.0;
            $interp[] = [
                round($c1[0] + ($c2[0] - $c1[0]) * $t, 5),
                round($c1[1] + ($c2[1] - $c1[1]) * $t, 5)
            ];
        }
        echo json_encode(['success' => true, 'coordinates' => $interp]);
        exit;
    }

    echo json_encode(['success' => false, 'coordinates' => []]);
    exit;
}

// ----------------------------------------------------
// 3. GET /api/live-tracker/running-trains
// ----------------------------------------------------
if (strpos($uri, 'running-trains') !== false) {
    $cacheFile = LIVE_CACHE_DIR . '/running_trains.json';
    $isRefresh = isset($_GET['refresh']) && $_GET['refresh'] === '1';

    if (!$isRefresh && file_exists($cacheFile) && (time() - filemtime($cacheFile) < 45)) {
        $cached = json_decode(file_get_contents($cacheFile), true);
        if ($cached && !empty($cached['trains'])) {
            echo json_encode($cached, JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    $html = fetchUpstreamHtml('https://trainkothai.com/trains');
    if ($html) {
        $trains = [];
        if (preg_match_all('/<a[^>]*href="\/track\/(\d+)"[^>]*>(.*?)<\/a>/s', $html, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $m) {
                $trainNo = $m[1];
                $cardHtml = $m[2];

                if (!preg_match('/<div[^>]*class="[^"]*truncate[^"]*"[^>]*>([^<]+)<\/div>/i', $cardHtml, $nameMatch)) {
                    continue;
                }
                $trainName = trim($nameMatch[1]);

                preg_match('/(\d+h\s*\d+m|\d+h|\d+m)/', $cardHtml, $durMatch);
                $duration = $durMatch ? $durMatch[1] : '';

                preg_match('/(\+\d+m|On time|ON TIME)/i', $cardHtml, $delayMatch);
                $delayText = $delayMatch ? $delayMatch[1] : 'On time';
                $delayMinutes = (strpos($delayText, '+') === 0) ? (int)preg_replace('/\D/', '', $delayText) : 0;

                preg_match('/(\d+m\s*ago|\d+s\s*ago|just\s*now)/i', $cardHtml, $updMatch);
                $lastUpdated = $updMatch ? $updMatch[1] : 'Just now';

                $stationPairs = [];
                if (preg_match_all('/>(\d{1,2}:\d{2})<\/div>\s*<div[^>]*>([^<]+)<\/div>/', $cardHtml, $sMatches, PREG_SET_ORDER)) {
                    foreach ($sMatches as $sm) {
                        $stationPairs[] = ['time' => $sm[1], 'station' => trim($sm[2])];
                    }
                }

                preg_match('/(\d+)<!-- -->%/', $cardHtml, $pctMatch);
                $progressPct = $pctMatch ? (int)$pctMatch[1] : 0;

                $isNoData = (stripos($cardHtml, 'No data') !== false || stripos($delayText, 'no data') !== false);
                $isCompleted = ($progressPct >= 100 || stripos($cardHtml, 'Arrived') !== false || stripos($cardHtml, 'Completed') !== false);
                $isScheduled = ($progressPct === 0 && !$isNoData && !$isCompleted);
                $isDelayed = ($delayMinutes > 0 && !$isCompleted && !$isNoData && !$isScheduled);
                $isOntime = (!$isDelayed && !$isNoData && !$isScheduled && !$isCompleted);

                $trainStatus = 'running';
                if ($isNoData) $trainStatus = 'nodata';
                elseif ($isCompleted) $trainStatus = 'completed';
                elseif ($isScheduled) $trainStatus = 'scheduled';
                elseif ($isDelayed) $trainStatus = 'delayed';
                elseif ($isOntime) $trainStatus = 'ontime';

                $fromStation = $stationPairs[0]['station'] ?? '';
                $toStation = $stationPairs[1]['station'] ?? '';
                $fromCoords = getCoordsForStation($fromStation, $stationCoords);
                $toCoords = getCoordsForStation($toStation, $stationCoords);

                $currentCoords = null;
                if ($fromCoords && $toCoords) {
                    $ratio = min(1.0, max(0.0, $progressPct / 100.0));
                    $currentCoords = [
                        round($fromCoords[0] + ($toCoords[0] - $fromCoords[0]) * $ratio, 5),
                        round($fromCoords[1] + ($toCoords[1] - $fromCoords[1]) * $ratio, 5)
                    ];
                } elseif ($fromCoords) {
                    $currentCoords = $fromCoords;
                }

                $trains[] = [
                    'train_no' => $trainNo,
                    'train_name' => $trainName,
                    'from' => $fromStation,
                    'to' => $toStation,
                    'from_coords' => $fromCoords,
                    'to_coords' => $toCoords,
                    'current_coords' => $currentCoords,
                    'departure_time' => $stationPairs[0]['time'] ?? '',
                    'arrival_time' => $stationPairs[1]['time'] ?? '',
                    'duration' => $duration,
                    'delay_text' => $delayText,
                    'delay_minutes' => $delayMinutes,
                    'progress_pct' => $progressPct,
                    'last_updated' => $lastUpdated,
                    'status' => $trainStatus
                ];
            }
        }

        if (!empty($trains)) {
            $payload = [
                'success' => true,
                'updated_at' => date('c'),
                'total_running' => count($trains),
                'trains' => $trains
            ];
            @file_put_contents($cacheFile, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode($payload, JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    // Fallback: If live fetch fails, return cached file or default catalog
    if (file_exists($cacheFile)) {
        $cached = json_decode(file_get_contents($cacheFile), true);
        if ($cached) {
            $cached['cached_fallback'] = true;
            echo json_encode($cached, JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    echo json_encode([
        'success' => false,
        'error' => 'Live GPS radar feed syncing. Please retry shortly.',
        'trains' => []
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ----------------------------------------------------
// 4. GET /api/live-tracker/train/{trainNo}
// ----------------------------------------------------
if (preg_match('#/train/([^/?]+)#', $uri, $tMatch)) {
    $trainNo = trim($tMatch[1]);
    $cacheFile = LIVE_CACHE_DIR . "/train_{$trainNo}.json";
    $isRefresh = isset($_GET['refresh']) && $_GET['refresh'] === '1';

    if (!$isRefresh && file_exists($cacheFile) && (time() - filemtime($cacheFile) < 30)) {
        $cached = json_decode(file_get_contents($cacheFile), true);
        if ($cached && !empty($cached['train_name'])) {
            echo json_encode($cached, JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    $html = fetchUpstreamHtml("https://trainkothai.com/track/{$trainNo}");
    if ($html) {
        // Extract Next.js data stream
        $stream = '';
        if (preg_match_all('/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/', $html, $chunkMatches)) {
            foreach ($chunkMatches[1] as $rawChunk) {
                $decoded = json_decode('"'.$rawChunk.'"');
                $stream .= ($decoded !== null) ? $decoded : $rawChunk;
            }
        }

        // Helper to extract JSON object
        function extractJsonProp($str, $key) {
            $pos = strpos($str, "\"{$key}\":{");
            if ($pos === false) return null;
            $start = $pos + strlen("\"{$key}\":");
            $depth = 0;
            $len = strlen($str);
            for ($i = $start; $i < $len; $i++) {
                if ($str[$i] === '{') $depth++;
                elseif ($str[$i] === '}') {
                    $depth--;
                    if ($depth === 0) {
                        $sub = substr($str, $start, $i - $start + 1);
                        $sanitized = preg_replace('/"\$(?:undefined|[\w:.]+)"/', 'null', $sub);
                        return json_decode($sanitized, true);
                    }
                }
            }
            return null;
        }

        $initialTrain = extractJsonProp($stream, 'initialTrain');
        $initialDerived = extractJsonProp($stream, 'initialDerived');

        if ($initialTrain) {
            $delayMin = $initialTrain['delay'] ?? $initialDerived['delay'] ?? 0;
            $afterStopIdx = $initialDerived['trainSegmentPosition']['afterStopIdx'] ?? -1;
            $rawRoute = $initialTrain['route'] ?? [];

            $stoppages = [];
            foreach ($rawRoute as $idx => $r) {
                $isPassed = ($afterStopIdx >= 0 && $idx <= $afterStopIdx);
                $isNext = ($afterStopIdx >= 0 && $idx === $afterStopIdx + 1);
                $coords = getCoordsForStation($r['name'] ?? '', $stationCoords);

                $stoppages[] = [
                    'station_name' => $r['name'] ?? '',
                    'station_bn' => $r['bn'] ?? '',
                    'station_code' => $r['code'] ?? '',
                    'scheduled_time' => $r['sched'] ?? '—',
                    'actual_time' => $r['act'] ?? ($isPassed ? ($r['sched'] ?? '—') : '—'),
                    'eta_time' => $r['sched'] ?? '—',
                    'platform' => $r['platform'] ?? '—',
                    'distance_km' => $r['km'] ?? 0,
                    'lat' => $coords ? $coords[0] : null,
                    'lng' => $coords ? $coords[1] : null,
                    'status' => $isPassed ? 'passed' : ($isNext ? 'next' : 'upcoming')
                ];
            }

            $detail = [
                'success' => true,
                'train_no' => (string)($initialTrain['no'] ?? $trainNo),
                'train_name' => $initialTrain['name'] ?? "Train {$trainNo}",
                'train_name_bn' => $initialTrain['bn'] ?? '',
                'from' => $initialTrain['from'] ?? '',
                'to' => $initialTrain['to'] ?? '',
                'departure_time' => $initialTrain['depart'] ?? '',
                'arrival_time' => $initialTrain['arrive'] ?? '',
                'duration' => $initialTrain['duration'] ?? '',
                'speed' => $initialTrain['speed'] ?? 0,
                'delay_minutes' => $delayMin,
                'progress_pct' => $initialDerived['pct'] ?? 0,
                'status' => $initialTrain['status'] ?? $initialDerived['state'] ?? 'running',
                'coaches' => $initialTrain['coaches'] ?? 16,
                'next_stop' => $initialTrain['nextStop'] ?? ($stoppages[1]['station_name'] ?? 'Destination'),
                'next_eta' => $initialTrain['nextEta'] ?? '',
                'prev_stop' => ($afterStopIdx >= 0 && isset($stoppages[$afterStopIdx])) ? $stoppages[$afterStopIdx]['station_name'] : ($stoppages[0]['station_name'] ?? 'Origin'),
                'covered_since_prev_stop_km' => $initialDerived['coveredSincePrevStopKm'] ?? 0,
                'nearest_station' => $initialDerived['nearestStationName'] ?? '',
                'nearest_distance_km' => $initialDerived['nearestStationDistanceKm'] ?? 0,
                'last_updated' => 'Just now',
                'stoppages' => $stoppages
            ];

            @file_put_contents($cacheFile, json_encode($detail, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode($detail, JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    // Graceful fallback from running trains cache
    $runningCache = LIVE_CACHE_DIR . '/running_trains.json';
    if (file_exists($runningCache)) {
        $rc = json_decode(file_get_contents($runningCache), true);
        if (!empty($rc['trains'])) {
            foreach ($rc['trains'] as $t) {
                if ((string)$t['train_no'] === (string)$trainNo) {
                    echo json_encode([
                        'success' => true,
                        'train_no' => (string)$trainNo,
                        'train_name' => $t['train_name'],
                        'from' => $t['from'],
                        'to' => $t['to'],
                        'departure_time' => $t['departure_time'],
                        'arrival_time' => $t['arrival_time'],
                        'duration' => $t['duration'],
                        'delay_minutes' => $t['delay_minutes'],
                        'progress_pct' => $t['progress_pct'],
                        'status' => $t['status'],
                        'next_stop' => $t['to'],
                        'next_eta' => $t['arrival_time'],
                        'prev_stop' => $t['from'],
                        'last_updated' => $t['last_updated'],
                        'stoppages' => [
                            ['station_name' => $t['from'], 'scheduled_time' => $t['departure_time'], 'status' => 'passed'],
                            ['station_name' => $t['to'], 'scheduled_time' => $t['arrival_time'], 'status' => 'next']
                        ]
                    ], JSON_UNESCAPED_UNICODE);
                    exit;
                }
            }
        }
    }

    echo json_encode([
        'success' => false,
        'error' => "Live tracking data for train #{$trainNo} is currently updating."
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['success' => false, 'error' => 'Invalid live tracker endpoint']);

