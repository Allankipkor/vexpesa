<?php
header('Content-Type: application/json');

// PayHero sends webhook IPN with transaction status
$input = json_decode(file_get_contents('php://input'), true) ?? $_POST;

if (!empty($input)) {
    // Log transaction in callback log or database
    $logFile = __DIR__ . '/payhero_ipn.log';
    $entry = date('Y-m-d H:i:s') . ' - ' . json_encode($input) . PHP_EOL;
    @file_put_contents($logFile, $entry, FILE_APPEND);
}

echo json_encode([
    'status' => 'OK',
    'message' => 'PayHero webhook received'
]);
