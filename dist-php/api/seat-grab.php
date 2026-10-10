<?php
/**
 * dist-php/api/seat-grab.php
 * 
 * High-Speed Headless Seat Grabber Engine for PHP / Shared Hosting
 * Method 1: Direct Headless Shohoz Mobile API Hold (~200ms)
 * Delivers instant Cart Reservation & Telegram Notification
 */

require_once __DIR__ . '/helper.php';

header('Content-Type: application/json; charset=utf-8');

// Parse inputs from both JSON body and Query/POST params
$rawInput = file_get_contents('php://input');
$bodyParams = !empty($rawInput) ? json_decode($rawInput, true) : [];
if (!is_array($bodyParams)) $bodyParams = [];
$params = array_merge($_GET, $_POST, $bodyParams);

$fromCity = trim($params['from_city'] ?? $params['fromCity'] ?? $params['from'] ?? '');
$toCity = trim($params['to_city'] ?? $params['toCity'] ?? $params['to'] ?? '');
$dateOfJourney = trim($params['date_of_journey'] ?? $params['date'] ?? $params['journey_date'] ?? $params['doj'] ?? '');

if (empty($fromCity) || empty($toCity) || empty($dateOfJourney)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'from_city, to_city, and date_of_journey are required to execute background seat grab.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$seatClass = strtoupper(trim($params['seat_class'] ?? $params['seatClass'] ?? $params['class'] ?? 'S_CHAIR'));
if ($seatClass === 'ANY' || $seatClass === 'ALL' || empty($seatClass)) {
    $seatClass = 'S_CHAIR';
}
$trainName = trim($params['train_name'] ?? $params['trainName'] ?? $params['train'] ?? '');
$targetCoach = trim($params['coach'] ?? $params['coach_name'] ?? '');
$seatsCount = max(1, min(4, (int)($params['seats_count'] ?? $params['seatsCount'] ?? 1)));
$tripId = trim($params['trip_id'] ?? $params['tripId'] ?? '');
$tripRouteId = trim($params['trip_route_id'] ?? $params['tripRouteId'] ?? $tripId);
$telegramChatId = trim($params['telegram_chat_id'] ?? $params['telegramChatId'] ?? (getenv('TELEGRAM_CHAT_ID') ?: ''));

$session = getSavedSession();
if (empty($session['token'])) {
    http_response_code(401);
    echo json_encode([
        'success' => false,
        'error' => 'No active Bangladesh Railway session found. Please connect your Railway account first.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$formattedDoj = formatShohozDoj($dateOfJourney);
$canonicalFrom = getCanonicalStationName($fromCity);
$canonicalTo = getCanonicalStationName($toCity);

// 1. Auto-discover trip_id if missing
if (empty($tripId)) {
    $searchResult = queryShohozSearch($canonicalFrom, $canonicalTo, $dateOfJourney, $session);
    if (!empty($searchResult['trains']) && is_array($searchResult['trains'])) {
        $trains = $searchResult['trains'];
        $matchedTrain = null;
        if (!empty($trainName)) {
            foreach ($trains as $t) {
                if (!empty($t['train_name']) && stripos($t['train_name'], $trainName) !== false) {
                    $matchedTrain = $t;
                    break;
                }
            }
        }
        if (!$matchedTrain) {
            foreach ($trains as $t) {
                if (!empty($t['seat_types'])) {
                    foreach ($t['seat_types'] as $st) {
                        if (($st['seats_available'] ?? 0) > 0) {
                            $matchedTrain = $t;
                            break 2;
                        }
                    }
                }
            }
        }
        if (!$matchedTrain && !empty($trains[0])) {
            $matchedTrain = $trains[0];
        }

        if ($matchedTrain) {
            $trainName = $matchedTrain['train_name'] ?? $trainName;
            if (!empty($matchedTrain['seat_types'])) {
                foreach ($matchedTrain['seat_types'] as $st) {
                    if (strtoupper($st['type'] ?? '') === $seatClass || ($st['seats_available'] ?? 0) > 0) {
                        $tripId = $st['trip_id'] ?? ($matchedTrain['trip_id'] ?? '');
                        $tripRouteId = $st['trip_route_id'] ?? ($matchedTrain['trip_route_id'] ?? $tripId);
                        if (!empty($st['type'])) $seatClass = strtoupper($st['type']);
                        break;
                    }
                }
            }
            if (empty($tripId)) {
                $tripId = $matchedTrain['trip_id'] ?? '';
                $tripRouteId = $matchedTrain['trip_route_id'] ?? $tripId;
            }
        }
    }
}

if (empty($tripId)) {
    http_response_code(404);
    echo json_encode([
        'success' => false,
        'error' => "Could not locate active trip_id on route {$canonicalFrom} to {$canonicalTo} on {$formattedDoj}."
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// 2. Discover available seats from live layout
$selectedCoach = $targetCoach;
$selectedSeats = [];

$layoutUrl = "https://railspaapi.shohoz.com/v1.0/app/bookings/seat-layout?trip_id=" . urlencode($tripId) . "&trip_route_id=" . urlencode($tripRouteId);
$devId = $session['deviceId'] ?: '844272bb-aabf-4f99-8ced-6fd56b4457b2';
$devKey = (!empty($session['deviceKey']) && strlen($session['deviceKey']) >= 32)
    ? $session['deviceKey']
    : generateShohozDeviceKey($session['token']);

$mobileHeaders = [
    'User-Agent: Shohoz-Rail-App/2.2.0 (Linux; Android 13; SM-G998B Build/TP1A.220624.014; wv)',
    'Accept: application/json, text/plain, */*',
    'Accept-Language: en-US,en;q=0.9,bn-BD;q=0.8',
    'x-device-id: ' . $devId,
    'x-device-key: ' . $devKey,
    'x-platform: android',
    'x-app-version: 2.2.0',
    'Content-Type: application/json',
    'Authorization: Bearer ' . trim($session['token'])
];

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $layoutUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $mobileHeaders);
curl_setopt($ch, CURLOPT_TIMEOUT, 8);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

$layoutRaw = curl_exec($ch);
$layoutCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($layoutCode === 200 && !empty($layoutRaw)) {
    $layoutJson = json_decode($layoutRaw, true);
    $payload = $layoutJson['data'] ?? $layoutJson;
    $coachList = $payload['seatLayout'] ?? $payload['seat_layout'] ?? $payload['coaches'] ?? [];

    if (is_array($coachList)) {
        foreach ($coachList as $c) {
            $cName = trim((string)($c['floor_name'] ?? $c['coach_name'] ?? $c['name'] ?? ''));
            if (!empty($selectedCoach) && strtoupper($cName) !== strtoupper($selectedCoach)) {
                continue;
            }

            // Flatten seats
            $rawSeats = [];
            if (!empty($c['layout']) && is_array($c['layout'])) {
                foreach ($c['layout'] as $row) {
                    if (is_array($row)) {
                        foreach ($row as $s) {
                            if (!empty($s)) $rawSeats[] = $s;
                        }
                    }
                }
            } elseif (!empty($c['seats']) && is_array($c['seats'])) {
                $rawSeats = $c['seats'];
            }

            $availSeats = [];
            foreach ($rawSeats as $s) {
                $sNum = trim((string)($s['seat_number'] ?? $s['seat_name'] ?? ''));
                if (empty($sNum) || !empty($s['is_blank'])) continue;
                $avail = $s['seat_availability'] ?? null;
                $isFree = ($avail === 1 || $avail === true || (string)($s['is_available'] ?? '') === '1');
                if ($isFree && !empty($s['ticket_id'])) {
                    $availSeats[] = [
                        'seat_number' => $sNum,
                        'ticket_id' => $s['ticket_id']
                    ];
                }
            }

            if (count($availSeats) > 0) {
                $selectedCoach = $cName ?: 'Coach';
                $selectedSeats = array_slice($availSeats, 0, min($seatsCount, count($availSeats)));
                break;
            }
        }
    }
}

if (empty($selectedSeats)) {
    echo json_encode([
        'success' => false,
        'soldOut' => true,
        'error' => "No open available seats found in coach {$selectedCoach} for this train at this moment.",
        'details' => ['reason' => 'No available seats found']
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// 3. Send Official Bangladesh Railway PATCH /bookings/reserve-seat Hold
$actionToken = $session['cftResponse'] ?? '';
$webHeaders = [
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept: application/json, text/plain, */*',
    'Origin: https://eticket.railway.gov.bd',
    'Referer: https://eticket.railway.gov.bd/',
    'Content-Type: application/json',
    'Authorization: Bearer ' . trim($session['token']),
    'x-device-id: ' . $devId,
    'x-device-key: ' . $devKey,
    'X-Action-Token: ' . $actionToken
];

$reserveUrl = 'https://railspaapi.shohoz.com/v1.0/web/bookings/reserve-seat';
$heldSeatNumbers = [];
$holdErrors = [];

foreach ($selectedSeats as $stItem) {
    $rPayload = [
        'ticket_id' => $stItem['ticket_id'],
        'route_id' => $tripRouteId,
        'action_token' => $actionToken,
        'extras' => [
            'seat_number' => $stItem['seat_number'],
            'trip_number' => $trainName ?: 'TRAIN',
            'origin_name' => $canonicalFrom,
            'destination_name' => $canonicalTo
        ]
    ];

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $reserveUrl);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($rPayload));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $webHeaders);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

    $holdRaw = curl_exec($ch);
    $holdCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $holdJson = !empty($holdRaw) ? json_decode($holdRaw, true) : null;
    $isOk = ($holdCode === 200 && (isset($holdJson['data']['ack']) && $holdJson['data']['ack'] == 1 || stripos($holdJson['data']['message'] ?? '', 'Reserved') !== false || empty($holdJson['error'])));

    if ($isOk) {
        $heldSeatNumbers[] = $stItem['seat_number'];
    } else {
        $errDetail = $holdJson['error']['messages']['error_msg'] ?? ($holdJson['error']['message'] ?? ($holdJson['message'] ?? "HTTP {$holdCode}"));
        $holdErrors[] = "{$stItem['seat_number']}: {$errDetail}";
    }
}

if (empty($heldSeatNumbers)) {
    $errMsg = implode('; ', $holdErrors) ?: "Railway server rejected hold request";
    echo json_encode([
        'success' => false,
        'error' => "Hold reservation failed: {$errMsg}",
        'details' => ['reason' => $errMsg]
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$selectedSeats = $heldSeatNumbers;

// 4. Send Telegram Alert if configured
$botToken = getenv('TELEGRAM_BOT_TOKEN') ?: '';
if (!empty($botToken) && !empty($telegramChatId)) {
    $directCheckoutUrl = 'https://eticket.railway.gov.bd/booking/checkout';
    $seatsDisplay = implode(', ', $selectedSeats);
    $tgText = "🚨 <b>[SEAT GRABBED & LOCKED IN CART!]</b>\n\n" .
              "🚆 <b>Train:</b> " . htmlspecialchars($trainName ?: 'Train') . "\n" .
              "📍 <b>Route:</b> " . htmlspecialchars($canonicalFrom) . " ➔ " . htmlspecialchars($canonicalTo) . "\n" .
              "📅 <b>Date:</b> {$formattedDoj}\n" .
              "💺 <b>Coach / Seats:</b> <code>{$selectedCoach} - [{$seatsDisplay}]</code>\n" .
              "⚡ <b>Secured Via:</b> <code>API Mobile Gateway (Method 1)</code>\n\n" .
              "⏳ <b>TIME REMAINING: 5 MINUTES!</b>\n" .
              "<i>Bangladesh Railway has held these seats in your account cart. Complete your payment (bKash/Nagad/Card) before the 5-minute timer expires!</i>\n\n" .
              "🔗 <a href=\"{$directCheckoutUrl}\"><b>👉 Click to Complete Payment Immediately</b></a>";

    $tgPayload = [
        'chat_id' => $telegramChatId,
        'text' => $tgText,
        'parse_mode' => 'HTML',
        'reply_markup' => json_encode([
            'inline_keyboard' => [
                [['text' => '💳 Pay Now (Cart Checkout)', 'url' => $directCheckoutUrl]]
            ]
        ])
    ];

    $tgCh = curl_init("https://api.telegram.org/bot{$botToken}/sendMessage");
    curl_setopt($tgCh, CURLOPT_POST, true);
    curl_setopt($tgCh, CURLOPT_POSTFIELDS, json_encode($tgPayload));
    curl_setopt($tgCh, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($tgCh, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($tgCh, CURLOPT_TIMEOUT, 5);
    curl_setopt($tgCh, CURLOPT_SSL_VERIFYPEER, false);
    @curl_exec($tgCh);
    @curl_close($tgCh);
}

// 5. Successful Response
echo json_encode([
    'success' => true,
    'method_used' => 'API Mobile Gateway (Method 1)',
    'details' => [
        'success' => true,
        'method' => 'API Mobile Gateway (Method 1)',
        'trainName' => $trainName,
        'coach' => $selectedCoach,
        'seats' => $selectedSeats,
        'seatClass' => $seatClass,
        'expiresInSeconds' => 300
    ]
], JSON_UNESCAPED_UNICODE);
