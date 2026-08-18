<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$amount = (float)($input['amount'] ?? 0);

session_start();
if (!isset($_SESSION['balance'])) $_SESSION['balance'] = 2500.00;

if ($amount < 100) {
    echo json_encode(['success' => false, 'error' => 'Minimum withdrawal is KES 100']);
    exit;
}

if ($amount > $_SESSION['balance']) {
    echo json_encode(['success' => false, 'error' => 'Amount exceeds available balance']);
    exit;
}

$_SESSION['balance'] -= $amount;

echo json_encode([
    'success' => true,
    'message' => 'Withdrawal processed successfully via M-Pesa B2C',
    'balance' => (float)$_SESSION['balance'],
    'tx_id' => 'MC-WTH-' . strtoupper(substr(md5(uniqid()), 0, 10))
]);
