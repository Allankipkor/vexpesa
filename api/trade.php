<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $input['action'] ?? '';

session_start();
if (!isset($_SESSION['balance'])) {
    $_SESSION['balance'] = 2500.00;
}

if ($action === 'balance') {
    echo json_encode(['balance' => (float)$_SESSION['balance']]);
    exit;
}

if ($action === 'place') {
    $stake = (float)($input['stake'] ?? 100);
    $type = $input['type'] ?? 'buy';
    
    if ($stake > $_SESSION['balance']) {
        echo json_encode(['error' => 'Insufficient balance']);
        exit;
    }
    
    $_SESSION['balance'] -= $stake;
    $tradeId = 'MC-' . time() . '-' . rand(1000, 9999);
    $_SESSION['active_trade'] = [
        'id' => $tradeId,
        'stake' => $stake,
        'type' => $type,
        'entry_rate' => (float)($input['entry_rate'] ?? 0.015)
    ];

    echo json_encode([
        'success' => true,
        'trade_id' => $tradeId,
        'balance' => (float)$_SESSION['balance']
    ]);
    exit;
}

if ($action === 'cancel') {
    if (isset($_SESSION['active_trade'])) {
        $_SESSION['balance'] += $_SESSION['active_trade']['stake'];
        unset($_SESSION['active_trade']);
    }
    echo json_encode(['success' => true, 'balance' => (float)$_SESSION['balance']]);
    exit;
}

if ($action === 'resolve') {
    $tradeId = $input['trade_id'] ?? '';
    $exitRate = (float)($input['exit_rate'] ?? 0);
    $expired = (bool)($input['expired'] ?? false);
    
    $trade = $_SESSION['active_trade'] ?? ['stake' => 100, 'entry_rate' => 0.01];
    $stake = (float)$trade['stake'];
    $entry = (float)$trade['entry_rate'];
    
    $rateDiff = $exitRate - $entry;
    $won = (!$expired && $rateDiff > 0);
    
    $payout = 0;
    if ($won) {
        $mult = min(1 + max($rateDiff * 10, 0.25), 5.0);
        $payout = round($stake * $mult, 2);
        $_SESSION['balance'] += $payout;
    }
    
    unset($_SESSION['active_trade']);
    
    echo json_encode([
        'success' => true,
        'result' => $won ? 'win' : 'lose',
        'payout' => $payout,
        'balance' => (float)$_SESSION['balance']
    ]);
    exit;
}

echo json_encode(['status' => 'ok']);
