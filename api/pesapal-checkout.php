<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$amount = (float)($input['amount'] ?? 100);
$ref = 'PP-MC-' . time() . '-' . rand(1000, 9999);

echo json_encode([
    'success' => true,
    'merchant_reference' => $ref,
    'redirect_url' => 'https://demo.pesapal.com'
]);
