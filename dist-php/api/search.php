<?php
require_once __DIR__ . '/helper.php';

$fromCity = $_GET['from_city'] ?? '';
$toCity = $_GET['to_city'] ?? '';
$dateOfJourney = $_GET['date_of_journey'] ?? '';

if (empty($fromCity) || empty($toCity) || empty($dateOfJourney)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'Missing required parameters: from_city, to_city, date_of_journey are required.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$result = queryShohozSearch($fromCity, $toCity, $dateOfJourney);

echo json_encode($result, JSON_UNESCAPED_UNICODE);
