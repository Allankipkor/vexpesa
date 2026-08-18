<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$phone = $input['phone'] ?? '';
$amount = (float)($input['amount'] ?? 100);

if (!$phone || !preg_match('/^254\d{9}$/', $phone)) {
    echo json_encode(['success' => false, 'error' => 'Invalid phone format (254XXXXXXXXX)']);
    exit;
}

if ($amount < 50) {
    echo json_encode(['success' => false, 'error' => 'Minimum deposit is KES 50']);
    exit;
}

session_start();
if (!isset($_SESSION['balance'])) $_SESSION['balance'] = 2500.00;
$_SESSION['balance'] += $amount;

$ref = 'MC-DEP-' . strtoupper(substr(md5(uniqid()), 0, 10));

echo json_encode([
    'success' => true,
    'message' => "STK push of KES " . number_format($amount, 2) . " sent to $phone. Please enter your M-Pesa PIN.",
    'reference' => $ref,
    'balance' => (float)$_SESSION['balance']
]);
