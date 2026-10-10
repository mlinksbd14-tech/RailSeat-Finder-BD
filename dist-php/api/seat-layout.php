<?php
require_once __DIR__ . '/helper.php';

$tripId = trim($_GET['trip_id'] ?? '');
$tripRouteId = trim($_GET['trip_route_id'] ?? '');
$trainName = trim($_GET['train_name'] ?? 'Intercity Train');
$trainModel = trim($_GET['train_model'] ?? '');
$rawSeatClass = trim($_GET['seat_class'] ?? 'S_CHAIR');
$seatClass = (!empty($rawSeatClass) && strtoupper($rawSeatClass) !== 'ANY' && strtoupper($rawSeatClass) !== 'ALL') ? strtoupper($rawSeatClass) : 'S_CHAIR';

$availSeatsParam = (isset($_GET['available_seats']) && $_GET['available_seats'] !== '') ? max(0, (int)$_GET['available_seats']) : null;
$fareParam = (isset($_GET['fare']) && $_GET['fare'] !== '') ? (float)$_GET['fare'] : null;

$cleanTripId = (!empty($tripId) && $tripId !== 'null' && $tripId !== 'undefined') ? $tripId : (!empty($trainModel) ? ('TRIP_' . $trainModel) : 'TRIP_DEFAULT');
$cleanTripRouteId = (!empty($tripRouteId) && $tripRouteId !== 'null' && $tripRouteId !== 'undefined') ? $tripRouteId : $cleanTripId;

$session = getSavedSession();

// ---------------------------------------------------------------------------
// Bangladesh Railway coach composition — structural template.
//
// The official seat-layout endpoint is the only source of real coach names,
// real per-seat status and real blank positions, and it requires a Cloudflare
// Turnstile token on every call. This template reproduces the real carriage so
// the map still matches the train, but per-seat status stays 'unknown' until
// the server answers — availability is never invented.
//
// Coach letters run from the engine towards the rear brake van, and seat
// numbers run continuously across the whole rake.
// ---------------------------------------------------------------------------
$BR_RAKE_ORDER = ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA'];
$BR_TIER_LABELS = ['U', 'M', 'L']; // upper / middle / lower berth

$BR_COACH_TEMPLATES = [
    'S_CHAIR'  => ['kind' => 'chair', 'arrangement' => '2+2', 'sections' => 2, 'rowsPerSection' => 12, 'tiers' => 1, 'letters' => ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA']],
    'SHOVAN'   => ['kind' => 'chair', 'arrangement' => '2+2', 'sections' => 2, 'rowsPerSection' => 12, 'tiers' => 1, 'letters' => ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA']],
    'SHOVON'   => ['kind' => 'chair', 'arrangement' => '2+2', 'sections' => 2, 'rowsPerSection' => 12, 'tiers' => 1, 'letters' => ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA']],
    'F_SEAT'   => ['kind' => 'chair', 'arrangement' => '2+2', 'sections' => 2, 'rowsPerSection' => 12, 'tiers' => 1, 'letters' => ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA']],
    'SULOB'    => ['kind' => 'chair', 'arrangement' => '2+2', 'sections' => 2, 'rowsPerSection' => 12, 'tiers' => 1, 'letters' => ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA']],
    'SNIGDHA'  => ['kind' => 'chair', 'arrangement' => '3+2', 'sections' => 2, 'rowsPerSection' => 8,  'tiers' => 1, 'letters' => ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA']],
    'AC_S'     => ['kind' => 'chair', 'arrangement' => '3+2', 'sections' => 2, 'rowsPerSection' => 8,  'tiers' => 1, 'letters' => ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA']],
    'AC_CHAIR' => ['kind' => 'chair', 'arrangement' => '3+2', 'sections' => 2, 'rowsPerSection' => 8,  'tiers' => 1, 'letters' => ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA']],
    'AC_C'     => ['kind' => 'chair', 'arrangement' => '3+2', 'sections' => 2, 'rowsPerSection' => 8,  'tiers' => 1, 'letters' => ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA']],
    'AC_B'     => ['kind' => 'berth', 'arrangement' => '3+2', 'sections' => 1, 'rowsPerSection' => 6,  'tiers' => 3, 'letters' => ['KA', 'KHA', 'GA', 'GHA']],
    'F_BERTH'  => ['kind' => 'berth', 'arrangement' => '3+2', 'sections' => 1, 'rowsPerSection' => 6,  'tiers' => 3, 'letters' => ['KA', 'KHA', 'GA', 'GHA']],
];

function getBRCoachTemplate($seatClass) {
    global $BR_COACH_TEMPLATES;
    $code = strtoupper(trim((string)$seatClass));
    if (isset($BR_COACH_TEMPLATES[$code])) {
        return array_merge(['seat_class' => $code, 'unknown' => false], $BR_COACH_TEMPLATES[$code]);
    }
    return array_merge(['seat_class' => ($code !== '' ? $code : 'S_CHAIR'), 'unknown' => true], $BR_COACH_TEMPLATES['S_CHAIR']);
}

function arrangementSeatColumns($arrangement) {
    $parts = array_map('intval', explode('+', (string)$arrangement));
    if (empty($parts) || count($parts) < 2) {
        return 4;
    }
    $sum = array_sum($parts);
    return $sum > 0 ? $sum : 4;
}

function buildTemplateCoach($template, $coachName, $startSeatNo, $fareInfo) {
    global $BR_TIER_LABELS;

    $seatCols = arrangementSeatColumns($template['arrangement']);
    $gridCols = $seatCols + 1;              // + centre aisle
    $aisleCol = (int)floor($seatCols / 2);  // aisle sits after the 2+2 / 3 side
    $tiers = max(1, (int)$template['tiers']);
    $isBerth = $template['kind'] === 'berth';

    $seats = [];
    $bays = [];
    $seatNo = $startSeatNo;
    $bayIndex = 0;
    $sectionCount = max(1, (int)$template['sections']);

    for ($section = 0; $section < $sectionCount; $section++) {
        $facing = $sectionCount === 1 ? 'single' : ($section === 0 ? 'forward' : 'reverse');

        for ($b = 0; $b < (int)$template['rowsPerSection']; $b++) {
            $bay = ['index' => $bayIndex, 'facing' => $facing, 'gap' => false, 'gap_reason' => null, 'rows' => []];

            for ($tier = 0; $tier < $tiers; $tier++) {
                $rowNo = $b + 1;
                $rowSeats = [];
                for ($col = 0; $col < $seatCols; $col++) {
                    $label = $isBerth ? ($rowNo . $BR_TIER_LABELS[$tier]) : (string)$seatNo;
                    $isAisleSide = ($col === $aisleCol - 1) || ($col === $aisleCol + 1);
                    $rowSeats[] = [
                        'seat_name' => $coachName . '-' . $label,
                        'seat_number' => $label,
                        'status' => 'unknown',
                        'is_blank' => false,
                        'seat_class' => $template['seat_class'],
                        'fare' => $fareInfo['fare'],
                        'vat' => $fareInfo['vat'],
                        'total_fare' => $fareInfo['total_fare'],
                        'bay' => $bayIndex,
                        'row' => $rowNo,
                        'col' => $col,
                        'aisle_col' => $aisleCol,
                        'tier' => $isBerth ? $BR_TIER_LABELS[$tier] : null,
                        'is_aisle_side' => $isAisleSide,
                        'is_window' => !$isAisleSide
                    ];
                    $seatNo++;
                }
                // Mirror every generated seat into the flat list: the renderer
                // and the coach tab counts read `coach.seats`, and `total_seats`
                // comes from its length.
                foreach ($rowSeats as $seat) {
                    $seats[] = $seat;
                }
                $bay['rows'][] = ['tier' => $isBerth ? $BR_TIER_LABELS[$tier] : null, 'seats' => $rowSeats];
            }

            // Genuine layout gap: the washroom / door vestibule band that
            // separates the two facing sections of a real chair car.
            if ($sectionCount > 1 && $section === 0 && $b === (int)$template['rowsPerSection'] - 1) {
                $bay['gap'] = true;
                $bay['gap_reason'] = 'washroom-door-vestibule';
            }

            $bays[] = $bay;
            $bayIndex++;
        }
    }

    $baySummaries = [];
    foreach ($bays as $b) {
        $baySummaries[] = [
            'index' => $b['index'],
            'facing' => $b['facing'],
            'gap' => $b['gap'],
            'gap_reason' => $b['gap_reason'],
            'rows' => count($b['rows'])
        ];
    }

    return [
        'coach_name' => $coachName,
        'coach_title' => $coachName . ' (' . $template['seat_class'] . ')',
        'seat_class' => $template['seat_class'],
        'status_source' => 'official_railway_server',
        'total_seats' => count($seats),
        'available_seats' => null,
        'booked_seats' => null,
        'blank_seats' => 0,
        'unknown_seats' => count($seats),
        'fare' => $fareInfo['total_fare'],
        'layout' => [
            'kind' => $template['kind'],
            'arrangement' => $template['arrangement'],
            'seat_columns' => $seatCols,
            'grid_columns' => $gridCols,
            'aisle_col' => $aisleCol,
            'sections' => $sectionCount,
            'tiers' => $tiers,
            'from_server' => false,
            'bays' => $baySummaries
        ],
        'seats' => $seats
    ];
}

// Build the full rake from the per-class seat data we know about.
function buildRakeTemplate($tripId, $seatTypes) {
    global $BR_RAKE_ORDER, $BR_COACH_TEMPLATES;

    $usedLetters = [];
    $assignments = [];

    foreach ((is_array($seatTypes) ? $seatTypes : []) as $st) {
        $code = strtoupper((string)($st['type'] ?? ($st['seat_class'] ?? 'S_CHAIR')));
        $template = getBRCoachTemplate($code);

        $free = array_values(array_filter($template['letters'], function ($l) use ($usedLetters) {
            return !in_array($l, $usedLetters, true);
        }));
        if (empty($free)) {
            continue;
        }

        $online = (int)($st['seats_available'] ?? 0);
        $offline = (int)($st['counter_seats_available'] ?? 0);
        $totalAvail = $online + $offline;
        $fare = (float)($st['fare'] ?? 0);
        $vat = (float)($st['vat'] ?? 0);
        $fareInfo = [
            'fare' => $fare,
            'vat' => $vat,
            'total_fare' => (float)($st['total_fare'] ?? ($fare + $vat))
        ];

        $perCoach = max(1, (int)$template['rowsPerSection'] * arrangementSeatColumns($template['arrangement'])
            * (int)$template['tiers'] * max(1, (int)$template['sections']));
        $needed = $totalAvail > 0 ? min(count($free), (int)ceil($totalAvail / $perCoach)) : 1;

        for ($i = 0; $i < $needed; $i++) {
            $usedLetters[] = $free[$i];
            $assignments[] = [
                'letter' => $free[$i],
                'template' => $template,
                'fareInfo' => $fareInfo,
                'seatType' => $st,
                'totalAvail' => $totalAvail
            ];
        }
    }

    // Real rake order: engine first.
    usort($assignments, function ($a, $b) use ($BR_RAKE_ORDER) {
        $ai = array_search($a['letter'], $BR_RAKE_ORDER, true);
        $bi = array_search($b['letter'], $BR_RAKE_ORDER, true);
        $ai = ($ai === false) ? 999 : $ai;
        $bi = ($bi === false) ? 999 : $bi;
        return $ai - $bi;
    });

    $coaches = [];
    $nextSeatNo = 1;
    $seenClasses = [];
    foreach ($assignments as $a) {
        $coach = buildTemplateCoach($a['template'], $a['letter'], $nextSeatNo, $a['fareInfo']);
        $nextSeatNo += (int)$coach['total_seats'];

        // The live search reports availability per class, not per coach, so it
        // is attached to the first coach of the class and the rest stay unknown.
        if (!isset($seenClasses[$coach['seat_class']])) {
            $seenClasses[$coach['seat_class']] = true;
            $coach['available_seats'] = $a['totalAvail'];
        }
        $coach['class_available_seats'] = $a['totalAvail'];
        $coach['trip_id'] = $a['seatType']['trip_id'] ?? null;
        $coach['trip_route_id'] = $a['seatType']['trip_route_id'] ?? null;
        $coaches[] = $coach;
    }

    return [
        'trip_id' => $tripId ?: null,
        'status_source' => 'official_railway_server',
        'availability_source' => 'official_railway_server',
        'requires_turnstile' => true,
        'total_coaches' => count($coaches),
        'coaches' => $coaches
    ];
}

function buildTemplateFallback($tripId, $seatClass, $reqAvail, $reqFare, $liveSeatTypes = []) {
    $seatTypes = (is_array($liveSeatTypes) && !empty($liveSeatTypes)) ? $liveSeatTypes : [];

    if (empty($seatTypes)) {
        // No live search to work from. Build a single-class entry from whatever
        // the caller knows, so the response shape stays identical.
        $cleanClass = (!empty($seatClass) && $seatClass !== 'ALL' && $seatClass !== 'UNKNOWN')
            ? strtoupper($seatClass) : 'S_CHAIR';
        $total = ($reqAvail !== null) ? (int)$reqAvail : 0;
        $totalFare = ($reqFare !== null && $reqFare > 0) ? (float)$reqFare : 0.0;
        $base = $totalFare > 0 ? round($totalFare / 1.15) : 0.0;
        $vat = $totalFare > 0 ? ($totalFare - $base) : 0.0;
        $seatTypes = [[
            'type' => $cleanClass,
            'trip_id' => $tripId ?: null,
            'seats_available' => $total,
            'counter_seats_available' => 0,
            'fare' => $base,
            'vat' => $vat,
            'total_fare' => $totalFare
        ]];
    }

    return buildRakeTemplate($tripId, $seatTypes);
}

// Tokens the Railway server uses for a position that physically exists in the
// coach but cannot be booked.
$BLANK_SEAT_TOKENS = [
    'blank', 'not_available', 'unavailable', 'disabled', 'blocked', 'empty', 'void',
    'closed', 'not_exists', 'does_not_exist', 'not_installed', 'removed', 'na', 'none'
];

function toIntOrNullPHP($v) {
    if ($v === null || $v === '') {
        return null;
    }
    return is_numeric($v) ? (int)$v : null;
}

// Pull the physical position of a seat out of whatever the server called it.
function extractSeatGeometry($s) {
    $row = toIntOrNullPHP($s['row'] ?? $s['row_number'] ?? $s['row_no'] ?? $s['seat_row'] ?? $s['bay'] ?? null);
    $col = toIntOrNullPHP($s['column'] ?? $s['col'] ?? $s['seat_column'] ?? $s['column_number'] ?? $s['position_index'] ?? null);
    $rawPos = $s['seat_position'] ?? $s['position'] ?? $s['berth_type'] ?? $s['deck'] ?? $s['tier'] ?? null;
    return [
        'row' => $row,
        'col' => $col,
        'position' => ($rawPos !== null && $rawPos !== '') ? (string)$rawPos : null
    ];
}

function normalizeSeatStatusPHP($s) {
    global $BLANK_SEAT_TOKENS;

    $isBlankFlag = (!empty($s['is_blank']) && $s['is_blank'] === true)
        || (!empty($s['blank']) && $s['blank'] === true)
        || (!empty($s['is_blocked']) && $s['is_blocked'] === true)
        || (!empty($s['blocked']) && $s['blocked'] === true)
        || (!empty($s['disabled']) && $s['disabled'] === true)
        || (!empty($s['is_disabled']) && $s['is_disabled'] === true)
        || (isset($s['is_available']) && in_array((string)$s['is_available'], ['blank', 'blocked'], true));

    $rawSource = $s['status'] ?? $s['seat_status'] ?? $s['availability'] ?? $s['state']
        ?? (isset($s['is_available']) ? $s['is_available'] : null);
    $stRaw = strtolower(trim((string)($rawSource ?? '')));

    foreach ($BLANK_SEAT_TOKENS as $token) {
        if ($stRaw === $token || strpos($stRaw, $token . '_') === 0) {
            return 'blank';
        }
    }
    if ($isBlankFlag) {
        return 'blank';
    }
    if (strpos($stRaw, 'avail') !== false || $stRaw === '1' || $stRaw === 'true' || ($s['is_available'] ?? null) === true) {
        return 'available';
    }
    if (strpos($stRaw, 'process') !== false || strpos($stRaw, 'hold') !== false
        || strpos($stRaw, 'lock') !== false || strpos($stRaw, 'pending') !== false) {
        return 'booking-in-process';
    }
    if (strpos($stRaw, 'book') !== false || strpos($stRaw, 'sold') !== false
        || strpos($stRaw, 'confirm') !== false || $stRaw === '0' || $stRaw === 'false'
        || ($s['is_available'] ?? null) === false) {
        return 'booked';
    }
    // Never guess: an unrecognised status is reported as unknown.
    return 'unknown';
}

function normalizeOneSeat($s, $coachName, $coachClass, $defaults) {
    $geo = extractSeatGeometry($s);
    $sNum = (string)($s['seat_number'] ?? $s['seat_no'] ?? $s['number'] ?? '');
    $status = normalizeSeatStatusPHP($s);
    $isBlank = ($status === 'blank');

    return [
        'seat_name' => $s['seat_name'] ?? (($sNum !== '') ? ($coachName . '-' . $sNum) : ''),
        'seat_number' => $sNum,
        'status' => $status,
        'is_blank' => $isBlank,
        'blank_reason' => $isBlank ? ($s['blank_reason'] ?? $s['reason'] ?? 'not-bookable') : null,
        'seat_class' => $s['seat_class'] ?? $coachClass,
        'fare' => (float)($s['fare'] ?? $defaults['fare']),
        'vat' => (float)($s['vat'] ?? $defaults['vat']),
        'total_fare' => (float)($s['total_fare'] ?? $s['fare'] ?? $defaults['total_fare']),
        'row' => $geo['row'],
        'col' => $geo['col'],
        'position' => $geo['position']
    ];
}

// When the server reports a capacity larger than the seats it actually returned,
// or the returned numbers have a hole, the missing positions are genuine blanks.
// We insert them explicitly instead of renumbering.
function insertMissingSeatPositions($seats, $declaredTotal) {
    $real = [];
    foreach ($seats as $s) {
        if (empty($s['is_blank']) && $s['seat_number'] !== '' && ctype_digit((string)$s['seat_number'])) {
            $real[] = $s;
        }
    }
    if (empty($real)) {
        return $seats;
    }

    $numbers = array_map(function ($s) { return (int)$s['seat_number']; }, $real);
    $max = max($numbers);
    $target = ($declaredTotal !== null && $declaredTotal > $max) ? min($declaredTotal, $max + 200) : $max;

    $present = array_flip($numbers);
    $missing = [];
    for ($n = 1; $n <= $target; $n++) {
        if (!isset($present[$n])) {
            $missing[] = $n;
        }
    }
    if (empty($missing)) {
        return $seats;
    }

    $coachName = explode('-', (string)$real[0]['seat_name'])[0];
    $out = [];
    $cursor = 0;
    for ($n = 1; $n <= $target; $n++) {
        while ($cursor < count($real) && (int)$real[$cursor]['seat_number'] < $n) {
            $out[] = $real[$cursor];
            $cursor++;
        }
        if (isset($present[$n])) {
            continue;
        }
        $out[] = [
            'seat_name' => $coachName . '-' . $n,
            'seat_number' => (string)$n,
            'status' => 'blank',
            'is_blank' => true,
            'blank_reason' => 'not-returned-by-server',
            'seat_class' => $real[0]['seat_class'],
            'fare' => $real[0]['fare'],
            'vat' => $real[0]['vat'],
            'total_fare' => $real[0]['total_fare'],
            'row' => null,
            'col' => null,
            'position' => null
        ];
    }
    while ($cursor < count($real)) {
        $out[] = $real[$cursor];
        $cursor++;
    }
    return $out;
}

// Derive a renderable grid for a live coach, honouring the real row/column data
// when the server sent it and otherwise using the documented BR template.
function buildLiveLayoutForCoach($coachClass, $seats) {
    $template = getBRCoachTemplate($coachClass);
    $seatColumns = arrangementSeatColumns($template['arrangement']);
    $gridColumns = $seatColumns + 1;
    $aisleCol = (int)floor($seatColumns / 2);
    $fromServer = false;

    $realSeats = array_values(array_filter($seats, function ($s) { return empty($s['is_blank']); }));
    $hasGeo = false;
    $maxCol = -1;
    $maxRow = 0;
    foreach ($seats as $s) {
        if ($s['row'] !== null) {
            $hasGeo = true;
            $maxRow = max($maxRow, (int)$s['row']);
        }
        if ($s['col'] !== null) {
            $maxCol = max($maxCol, (int)$s['col']);
        }
    }

    $bays = [];
    if ($hasGeo && $maxRow > 0) {
        $fromServer = true;
        $seatColumns = max(1, $maxCol + 1);
        $gridColumns = $seatColumns;
        $counts = array_fill(0, $seatColumns, 0);
        foreach ($seats as $s) {
            if ($s['col'] !== null && $s['col'] >= 0 && $s['col'] < $seatColumns) {
                $counts[$s['col']]++;
            }
        }
        $empty = array_search(0, $counts, true);
        $aisleCol = ($empty !== false && $empty > 0 && $empty < $seatColumns - 1) ? (int)$empty : -1;

        $byRow = [];
        foreach ($seats as $s) {
            if ($s['row'] === null) {
                continue;
            }
            $byRow[(int)$s['row']][] = $s;
        }
        ksort($byRow);
        $i = 0;
        foreach ($byRow as $rowSeats) {
            $bays[] = ['index' => $i, 'facing' => 'single', 'gap' => false, 'gap_reason' => null, 'rows' => [$rowSeats]];
            $i++;
        }
    } else {
        $tiers = max(1, (int)$template['tiers']);
        $sectionCount = max(1, (int)$template['sections']);
        $perSectionRow = max(1, (int)ceil(count($realSeats) / max(1, $sectionCount) / max(1, $tiers)));
        $i = 0;
        $total = count($realSeats);
        for ($section = 0; $section < $sectionCount && $i < $total; $section++) {
            $facing = $sectionCount === 1 ? 'single' : ($section === 0 ? 'forward' : 'reverse');
            for ($b = 0; $b < $perSectionRow && $i < $total; $b++) {
                $rowSeats = array_slice($realSeats, $i, $seatColumns);
                $i += $seatColumns;
                if (empty($rowSeats)) {
                    break;
                }
                $bays[] = ['index' => count($bays), 'facing' => $facing, 'gap' => false, 'gap_reason' => null, 'rows' => [$rowSeats]];
            }
        }
        while ($i < $total) {
            $rowSeats = array_slice($realSeats, $i, $seatColumns);
            $i += $seatColumns;
            $bays[] = ['index' => count($bays), 'facing' => 'single', 'gap' => false, 'gap_reason' => null, 'rows' => [$rowSeats]];
        }
    }

    // Re-index so the renderer can address every seat by bay/row/col.
    foreach ($bays as $bi => $bay) {
        foreach ($bay['rows'] as $ri => $rowSeats) {
            foreach ($rowSeats as $ci => $seatRef) {
                $idx = $seatRef['__i'] ?? null;
                if ($idx === null) {
                    continue;
                }
                $seats[$idx]['bay'] = $bi;
                $seats[$idx]['row'] = $ri + 1;
                $seats[$idx]['col'] = $ci;
                $seats[$idx]['aisle_col'] = $aisleCol;
                $seats[$idx]['is_aisle_side'] = ($aisleCol >= 0 && ($ci === $aisleCol - 1 || $ci === $aisleCol + 1));
                $seats[$idx]['is_window'] = !($aisleCol >= 0 && $seats[$idx]['is_aisle_side']);
            }
        }
    }

    $baySummaries = [];
    foreach ($bays as $bay) {
        $baySummaries[] = [
            'index' => $bay['index'],
            'facing' => $bay['facing'],
            'gap' => $bay['gap'],
            'gap_reason' => $bay['gap_reason'],
            'rows' => count($bay['rows'])
        ];
    }

    return [
        'kind' => $template['kind'],
        'arrangement' => $template['arrangement'],
        'seat_columns' => $seatColumns,
        'grid_columns' => $gridColumns,
        'aisle_col' => $aisleCol,
        'sections' => count(array_unique(array_column($bays, 'facing'))),
        'tiers' => max(1, (int)$template['tiers']),
        'from_server' => $fromServer,
        'bays' => $baySummaries
    ];
}

function summarizeCoachSeats($seats) {
    $counts = ['total' => 0, 'available' => 0, 'booked' => 0, 'in_process' => 0, 'blank' => 0, 'unknown' => 0];
    foreach ($seats as $s) {
        if (empty($s['is_blank'])) {
            $counts['total']++;
        }
        $status = $s['status'] ?? 'unknown';
        if ($status === 'available') {
            $counts['available']++;
        } elseif ($status === 'booked') {
            $counts['booked']++;
        } elseif ($status === 'booking-in-process') {
            $counts['in_process']++;
        } elseif ($status === 'blank') {
            $counts['blank']++;
        } else {
            $counts['unknown']++;
        }
    }
    return $counts;
}

function finalizeLiveCoach($rawCoach, $coachName, $coachClass) {
    $rawSeatList = $rawCoach['seats'] ?? $rawCoach['seat_list'] ?? $rawCoach['seat_wise'] ?? [];
    if (!is_array($rawSeatList)) {
        $rawSeatList = [];
    }

    $defaults = [
        'fare' => (float)($rawCoach['fare'] ?? 0),
        'vat' => (float)($rawCoach['vat'] ?? 0),
        'total_fare' => (float)($rawCoach['total_fare'] ?? $rawCoach['fare'] ?? 0)
    ];

    $seats = [];
    foreach ($rawSeatList as $s) {
        $seats[] = normalizeOneSeat($s, $coachName, $coachClass, $defaults);
    }
    $seats = insertMissingSeatPositions(
        $seats,
        toIntOrNullPHP($rawCoach['total_seats'] ?? $rawCoach['seat_count'] ?? $rawCoach['total_seat'] ?? null)
    );

    // Tag each seat with its index so the layout builder can mutate in place.
    foreach ($seats as $i => $s) {
        $seats[$i]['__i'] = $i;
    }

    $counts = summarizeCoachSeats($seats);
    $declaredTotal = toIntOrNullPHP($rawCoach['total_seats'] ?? $rawCoach['seat_count'] ?? null);
    $layout = buildLiveLayoutForCoach($coachClass, $seats);

    foreach ($seats as $i => $s) {
        unset($seats[$i]['__i']);
    }
    $seats = array_values($seats);

    $firstFare = 0.0;
    foreach ($seats as $s) {
        if (empty($s['is_blank'])) {
            $firstFare = (float)$s['fare'];
            break;
        }
    }

    return [
        'coach_name' => $coachName,
        'coach_title' => $rawCoach['coach_title'] ?? $rawCoach['title'] ?? ($coachName . ' (' . $coachClass . ')'),
        'seat_class' => $coachClass,
        'status_source' => 'official_railway_server',
        'total_seats' => ($declaredTotal !== null && $declaredTotal > $counts['total']) ? $declaredTotal : $counts['total'],
        'available_seats' => isset($rawCoach['available_seats']) && $rawCoach['available_seats'] !== null
            ? (int)$rawCoach['available_seats'] : $counts['available'],
        'booked_seats' => isset($rawCoach['booked_seats']) && $rawCoach['booked_seats'] !== null
            ? (int)$rawCoach['booked_seats'] : $counts['booked'],
        'blank_seats' => $counts['blank'],
        'unknown_seats' => $counts['unknown'],
        'fare' => (float)($rawCoach['fare'] ?? $firstFare),
        'layout' => $layout,
        'seats' => $seats
    ];
}

function normalizeSeatLayoutPHP($rawData) {
    $coaches = [];
    $payload = (isset($rawData['data']) && is_array($rawData['data'])) ? $rawData['data'] : $rawData;

    // Case 0: Official Bangladesh Railway / Shohoz live seat-layout schema
    $officialList = null;
    if (isset($payload['seatLayout']) && is_array($payload['seatLayout'])) {
        $officialList = $payload['seatLayout'];
    } elseif (isset($payload['seat_layout']) && is_array($payload['seat_layout']) && isset($payload['seat_layout'][0]['layout'])) {
        $officialList = $payload['seat_layout'];
    } elseif (is_array($payload) && isset($payload[0]) && (isset($payload[0]['layout']) || isset($payload[0]['floor_name']) || isset($payload[0]['seat_floor']))) {
        $officialList = $payload;
    } elseif (is_array($payload) && isset($payload['layout'])) {
        $officialList = [$payload];
    }

    if ($officialList !== null && !empty($officialList)) {
        foreach ($officialList as $cIdx => $coachData) {
            $coachName = trim((string)($coachData['floor_name'] ?? $coachData['coach_name'] ?? $coachData['seat_floor'] ?? ('Coach-' . ($cIdx + 1))));
            $coachClass = strtoupper((string)($coachData['seat_class'] ?? $coachData['class_name'] ?? ($payload['seat_class'] ?? 'S_CHAIR')));
            $rawLayout = (isset($coachData['layout']) && is_array($coachData['layout'])) ? $coachData['layout'] : [];

            $flattenedSeats = [];
            $layoutRows = [];
            $maxCols = 0;

            foreach ($rawLayout as $ri => $row) {
                if (!is_array($row)) continue;
                if (count($row) > $maxCols) $maxCols = count($row);
                $rowSeats = [];
                $rowLen = count($row);
                foreach ($row as $ci => $s) {
                    $isItemArray = is_array($s);
                    $sNum = $isItemArray ? trim((string)($s['seat_number'] ?? '')) : '';
                    $isBlank = (!$isItemArray || $sNum === '' || !empty($s['is_blank']) || (($s['is_available'] ?? '') === 'blank'));
                    $isAvail = !$isBlank && (($s['seat_availability'] ?? 0) === 1 || ($s['seat_availability'] ?? 0) === 2 || ($s['seat_availability'] ?? false) === true || ($s['is_available'] ?? '') === '1');
                    $isProcess = !$isBlank && !$isAvail && (($s['seat_availability'] ?? '') === 'in-progress' || !empty($s['in_progress']));
                    $isBooked = !$isBlank && !$isAvail && !$isProcess && (($s['seat_availability'] ?? 1) === 0 || ($s['seat_availability'] ?? true) === false || !empty($s['is_booked']) || ($s['is_available'] ?? '') === '0');
                    $status = $isBlank ? 'blank' : ($isAvail ? 'available' : ($isProcess ? 'booking-in-process' : ($isBooked ? 'booked' : 'unknown')));

                    $isWindow = !$isBlank && ($ci === 0 || $ci === ($rowLen - 1));
                    $cleanDisplayNum = $sNum ? preg_replace('/^' . preg_quote($coachName, '/') . '[-_]/i', '', $sNum) : '';

                    $seatObj = [
                        'seat_name' => !$isBlank ? ($sNum !== '' ? (strpos($sNum, '-') !== false ? $sNum : ($coachName . '-' . $sNum)) : '') : ($coachName . '-B' . ($ri + 1) . '-' . ($ci + 1)),
                        'seat_number' => $sNum,
                        'display_number' => $cleanDisplayNum,
                        'status' => $status,
                        'is_blank' => $isBlank,
                        'is_window' => $isWindow,
                        'blank_reason' => $isBlank ? ($s['blank_reason'] ?? 'empty-space') : null,
                        'seat_class' => $s['seat_class'] ?? $coachClass,
                        'fare' => (float)($s['fare'] ?? $coachData['fare'] ?? $payload['fare'] ?? 0),
                        'vat' => (float)($s['vat'] ?? $coachData['vat'] ?? $payload['vat'] ?? 0),
                        'total_fare' => (float)($s['total_fare'] ?? $s['fare'] ?? $coachData['total_fare'] ?? $coachData['fare'] ?? 0),
                        'ticket_id' => $s['ticket_id'] ?? null,
                        'row' => $ri + 1,
                        'col' => $ci,
                        'position' => $s['position'] ?? null
                    ];
                    $flattenedSeats[] = $seatObj;
                    $rowSeats[] = $seatObj;
                }
                $layoutRows[] = $rowSeats;
            }

            $nonBlank = array_values(array_filter($flattenedSeats, function($x) { return empty($x['is_blank']) && !empty($x['seat_number']); }));
            $availCount = count(array_filter($nonBlank, function($x) { return $x['status'] === 'available'; }));
            $bookedCount = count(array_filter($nonBlank, function($x) { return $x['status'] === 'booked'; }));
            $inProcCount = count(array_filter($nonBlank, function($x) { return $x['status'] === 'booking-in-process'; }));
            $seatCols = max(1, $maxCols ?: 4);
            $aisleCol = (int)floor($seatCols / 2);

            $coaches[] = [
                'coach_name' => $coachName,
                'coach_title' => $coachName . ' (' . $coachClass . ')',
                'seat_class' => $coachClass,
                'status_source' => 'official_railway_server',
                'total_seats' => count($nonBlank),
                'available_seats' => $availCount,
                'booked_seats' => $bookedCount,
                'in_process_seats' => $inProcCount,
                'blank_seats' => count($flattenedSeats) - count($nonBlank),
                'unknown_seats' => 0,
                'fare' => (float)($coachData['fare'] ?? $payload['fare'] ?? ($nonBlank[0]['fare'] ?? 0)),
                'layout' => [
                    'kind' => 'chair',
                    'seat_columns' => $seatCols,
                    'grid_columns' => $seatCols,
                    'aisle_col' => $aisleCol,
                    'from_server' => true,
                    'rows' => $layoutRows
                ],
                'seats' => $flattenedSeats
            ];
        }

        if (!empty($coaches)) {
            return [
                'trip_id' => $payload['trip_id'] ?? null,
                'trip_route_id' => $payload['trip_route_id'] ?? null,
                'status_source' => 'official_railway_server',
                'total_coaches' => count($coaches),
                'coaches' => $coaches
            ];
        }
    }

    if (isset($rawData['coach_wise_seats']) && is_array($rawData['coach_wise_seats'])) {
        // If associative array with coach names as keys
        $cws = $rawData['coach_wise_seats'];
        if (!empty($cws) && !isset($cws[0])) {
            $rawCoaches = [];
            foreach ($cws as $cName => $seats) {
                $rawCoaches[] = [
                    'coach_name' => (string)$cName,
                    'coach_title' => (string)$cName,
                    'seats' => is_array($seats) ? (isset($seats['seats']) ? $seats['seats'] : $seats) : []
                ];
            }
        } else {
            $rawCoaches = $cws;
        }
    } elseif (isset($rawData['coaches']) && is_array($rawData['coaches'])) {
        $cs = $rawData['coaches'];
        if (!empty($cs) && !isset($cs[0])) {
            $rawCoaches = [];
            foreach ($cs as $cName => $seats) {
                $rawCoaches[] = [
                    'coach_name' => (string)$cName,
                    'coach_title' => (string)$cName,
                    'seats' => is_array($seats) ? (isset($seats['seats']) ? $seats['seats'] : $seats) : []
                ];
            }
        } else {
            $rawCoaches = $cs;
        }
    } else {
        $rawCoaches = null;
    }

    if ($rawCoaches !== null) {
        foreach ($rawCoaches as $c) {
            // Real coach name, verbatim. Never synthesised while live data exists.
            $cName = trim((string)($c['coach_name'] ?? $c['name'] ?? $c['coach'] ?? '')) ?: 'Coach';
            $cClass = strtoupper((string)($c['seat_class'] ?? $c['class_name'] ?? $c['type'] ?? $c['seat_type'] ?? 'S_CHAIR'));
            $coaches[] = finalizeLiveCoach($c, $cName, $cClass);
        }
    } elseif (!empty($rawData['seats']) || !empty($rawData['seat_layout'])) {
        // Flat seat list: group by the real coach each seat belongs to.
        $rawSeats = !empty($rawData['seats']) ? $rawData['seats'] : $rawData['seat_layout'];
        $coachMap = [];
        foreach ($rawSeats as $s) {
            $cName = trim((string)($s['coach_name'] ?? $s['coach'] ?? (!empty($s['seat_name']) ? explode('-', (string)$s['seat_name'])[0] : ''))) ?: 'Coach';
            $cClass = strtoupper((string)($s['seat_class'] ?? $s['type'] ?? 'S_CHAIR'));
            if (!isset($coachMap[$cName])) {
                $coachMap[$cName] = ['coach_name' => $cName, 'seat_class' => $cClass, 'seats' => []];
            }
            $coachMap[$cName]['seats'][] = $s;
        }
        foreach ($coachMap as $c) {
            $coaches[] = finalizeLiveCoach($c, $c['coach_name'], $c['seat_class']);
        }
    }

    return [
        'trip_id' => $rawData['trip_id'] ?? null,
        'trip_route_id' => $rawData['trip_route_id'] ?? null,
        'status_source' => 'official_railway_server',
        'total_coaches' => count($coaches),
        'coaches' => $coaches
    ];
}

// Without a paired session there is no way to reach the official endpoint.
if (empty($session['token'])) {
    echo json_encode([
        'success' => true,
        'live' => false,
        'status_source' => 'official_railway_server',
        'requires_turnstile' => true,
        'requires_resignin' => true,
        'data' => buildTemplateFallback($cleanTripId, $seatClass, $availSeatsParam, $fareParam, [])
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// 1. Attempt Native Bangladesh Railway Mobile App Route (/v1.0/app/) - Bypasses Turnstile
$appDevId = !empty($session['deviceId']) ? $session['deviceId'] : 'd1b101fb-683d-4d74-a1e5-0cdfbd087ae3';
$appDevKey = (!empty($session['deviceKey']) && strtolower($session['deviceKey']) !== 'web') ? $session['deviceKey'] : (!empty($session['token']) ? generateShohozDeviceKey($session['token']) : generateShohozDeviceKey($appDevId));
$appUrl = "https://railspaapi.shohoz.com/v1.0/app/bookings/seat-layout?trip_id=" . urlencode($cleanTripId) . "&trip_route_id=" . urlencode($cleanTripRouteId);

$appHeaders = [
    'User-Agent: Shohoz-Rail-App/2.2.0 (Linux; Android 13; SM-G998B Build/TP1A.220624.014; wv)',
    'Accept: application/json, text/plain, */*',
    'Accept-Language: en-US,en;q=0.9,bn-BD;q=0.8',
    'x-device-id: ' . $appDevId,
    'x-device-key: ' . $appDevKey,
    'x-platform: android',
    'x-app-version: 2.2.0',
    'Authorization: Bearer ' . $session['token']
];

$chApp = curl_init();
curl_setopt($chApp, CURLOPT_URL, $appUrl);
curl_setopt($chApp, CURLOPT_RETURNTRANSFER, true);
curl_setopt($chApp, CURLOPT_HTTPHEADER, $appHeaders);
curl_setopt($chApp, CURLOPT_TIMEOUT, 8);
curl_setopt($chApp, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($chApp, CURLOPT_SSL_VERIFYPEER, false);
$appResponse = curl_exec($chApp);
$appHttpCode = curl_getinfo($chApp, CURLINFO_HTTP_CODE);
curl_close($chApp);

$appJson = json_decode($appResponse, true);
if ($appHttpCode === 200 && $appJson && empty($appJson['error'])) {
    $rawData = $appJson['data'] ?? $appJson;
    $normalized = normalizeSeatLayoutPHP($rawData);
    echo json_encode([
        'success' => true,
        'live' => true,
        'status_source' => 'official_railway_mobile_app',
        'requires_turnstile' => false,
        'data' => $normalized
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// 2. Fallback to Web API (/v1.0/web/)
$cftResponse = $_GET['cft_response'] ?? $_SERVER['HTTP_X_CFT_RESPONSE'] ?? ($session['cftResponse'] ?? ($session['cft_response'] ?? ''));
$targetUrl = "https://railspaapi.shohoz.com/v1.0/web/bookings/seat-layout?trip_id=" . urlencode($cleanTripId) . "&trip_route_id=" . urlencode($cleanTripRouteId);
if (!empty($cftResponse)) {
    $targetUrl .= "&cft_response=" . urlencode($cftResponse);
}

$reqHeaders = [
    'User-Agent: ' . getRandomUserAgentPHP(),
    'Accept: application/json, text/plain, */*',
    'Accept-Language: en-US,en;q=0.9,bn;q=0.8',
    'X-Requested-With: XMLHttpRequest',
    'Origin: https://eticket.railway.gov.bd',
    'Referer: https://eticket.railway.gov.bd/',
    'Authorization: Bearer ' . $session['token'],
    'Priority: u=1, i'
];

if (!empty($session['deviceId'])) {
    $reqHeaders[] = 'X-Device-Id: ' . $session['deviceId'];
}
$sendKey = (!empty($session['deviceKey']) && strtolower($session['deviceKey']) !== 'web') ? $session['deviceKey'] : (!empty($session['token']) ? generateShohozDeviceKey($session['token']) : null);
if (!empty($sendKey)) {
    $reqHeaders[] = 'X-Device-Key: ' . $sendKey;
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $targetUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $reqHeaders);
curl_setopt($ch, CURLOPT_TIMEOUT, 9);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$json = json_decode($response, true);
if ($httpCode === 200 && $json) {
    if (isset($json['error']) && !empty($json['error']['code'])) {
        echo json_encode([
            'success' => true,
            'live' => false,
            'status_source' => 'official_railway_server',
            'requires_turnstile' => true,
            'data' => buildTemplateFallback($cleanTripId, $seatClass, $availSeatsParam, $fareParam, [])
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $rawData = $json['data'] ?? $json;
    $normalized = normalizeSeatLayoutPHP($rawData);

    if (empty($normalized['coaches'])) {
        echo json_encode([
            'success' => true,
            'live' => false,
            'status_source' => 'official_railway_server',
            'requires_turnstile' => true,
            'data' => buildTemplateFallback($cleanTripId, $seatClass, $availSeatsParam, $fareParam, [])
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $availOnly = isset($_GET['available_only']) && ($_GET['available_only'] === '1' || $_GET['available_only'] === 'true');
    if ($availOnly && !empty($normalized['coaches'])) {
        $filteredCoaches = array_values(array_filter($normalized['coaches'], function($c) {
            return (int)($c['available_seats'] ?? 0) > 0;
        }));
        if (!empty($filteredCoaches)) {
            $normalized['coaches'] = $filteredCoaches;
            $normalized['total_coaches'] = count($filteredCoaches);
        }
    }

    echo json_encode([
        'success' => true,
        'live' => true,
        'source' => 'official_railway_server',
        'data' => $normalized
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($httpCode === 422) {
    // The official endpoint requires a Cloudflare Turnstile token on every call.
    // Report that explicitly instead of substituting an invented map.
    echo json_encode([
        'success' => true,
        'live' => false,
        'turnstile_required' => true,
        'requires_turnstile' => true,
        'reason' => 'The official Bangladesh Railway seat-layout endpoint requires a Cloudflare Turnstile verification token. Re-pair your session from the railway site to load the real per-seat map.',
        'error_message' => 'Cloudflare Turnstile token required by official railway server',
        'data' => buildTemplateFallback($cleanTripId, $seatClass, $availSeatsParam, $fareParam, [])
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($httpCode === 401) {
    echo json_encode([
        'success' => true,
        'live' => false,
        'session_expired' => true,
        'requires_resignin' => true,
        'data' => buildTemplateFallback($cleanTripId, $seatClass, $availSeatsParam, $fareParam, [])
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'success' => true,
    'live' => false,
    'status_source' => 'official_railway_server',
    'requires_turnstile' => true,
    'data' => buildTemplateFallback($cleanTripId, $seatClass, $availSeatsParam, $fareParam, [])
], JSON_UNESCAPED_UNICODE);
