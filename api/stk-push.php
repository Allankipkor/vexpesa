<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$phone = trim($input['phone'] ?? '');
$amount = (float)($input['amount'] ?? 100);

if (!$phone) {
    echo json_encode(['success' => false, 'error' => 'Phone number is required']);
    exit;
}

// Normalize phone to format 07XXXXXXXX or 2547XXXXXXXX
$formattedPhone = $phone;
if (preg_match('/^254(\d{9})$/', $phone, $m)) {
    $localPhone = '0' . $m[1];
} elseif (preg_match('/^0(\d{9})$/', $phone, $m)) {
    $localPhone = $phone;
    $phone = '254' . $m[1];
} else {
    echo json_encode(['success' => false, 'error' => 'Invalid phone number format. Use 07XXXXXXXX or 2547XXXXXXXX']);
    exit;
}

// Load PayHero Configuration from settings.json
$settingsFile = __DIR__ . '/settings.json';
$settings = [];
if (file_exists($settingsFile)) {
    $settings = json_decode(file_get_contents($settingsFile), true) ?? [];
}

$payheroConfig = $settings['payments']['payhero'] ?? [];
$apiUsername = trim($input['payheroUsername'] ?? ($payheroConfig['api_username'] ?? ''));
$apiPassword = trim($input['payheroPassword'] ?? ($payheroConfig['api_password'] ?? ''));
$channelId = (int)($input['payheroChannelId'] ?? ($payheroConfig['channel_id'] ?? 0));
$callbackUrl = trim($input['payheroCallbackUrl'] ?? ($payheroConfig['callback_url'] ?? ''));

$reference = 'MALI-' . strtoupper(substr(uniqid(), -8));

// If PayHero credentials are fully configured, dispatch real cURL to PayHero v2 API
if (!empty($apiUsername) && !empty($apiPassword) && !empty($channelId)) {
    $auth = base64_encode($apiUsername . ':' . $apiPassword);
    
    $payload = [
        'amount' => round($amount),
        'phone_number' => $localPhone,
        'channel_id' => $channelId,
        'provider' => 'm-pesa',
        'external_reference' => $reference,
        'customer_name' => 'MaliCrush Trader',
        'callback_url' => !empty($callbackUrl) ? $callbackUrl : 'https://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . '/api/payhero-callback.php'
    ];

    $ch = curl_init('https://backend.payhero.co.ke/api/v2/payments');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Authorization: Basic ' . $auth
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err) {
        echo json_encode([
            'success' => false,
            'error' => 'PayHero connection error: ' . $err
        ]);
        exit;
    }

    $resData = json_decode($response, true);
    if ($httpCode >= 200 && $httpCode < 300 && (isset($resData['status']) && $resData['status'] !== 'Failed')) {
        echo json_encode([
            'success' => true,
            'gateway' => 'payhero',
            'live' => true,
            'reference' => $reference,
            'message' => "STK Push sent to $phone via PayHero! Enter your M-Pesa PIN on your phone.",
            'payhero_response' => $resData
        ]);
        exit;
    } else {
        $msg = $resData['message'] ?? $resData['error'] ?? 'PayHero payment initialization failed';
        echo json_encode([
            'success' => false,
            'error' => $msg,
            'details' => $resData
        ]);
        exit;
    }
}

// Sandbox / Simulation Mode if credentials are not configured yet
echo json_encode([
    'success' => true,
    'gateway' => 'payhero',
    'live' => false,
    'reference' => $reference,
    'message' => "STK Push simulated for $phone (Configure PayHero in Admin Panel for live mode). Enter M-Pesa PIN.",
    'amount' => $amount
]);
