<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

$file = __DIR__ . '/settings.json';

$defaults = [
    "graph" => [
        "speed" => 300,
        "y_max" => 0.12,
        "max_pts" => 80,
        "spike_frequency" => 0.10,
        "crash_frequency" => 0.02,
        "base_level" => 0.025,
        "spike_max" => 0.105,
        "crash_depth" => -0.17
    ],
    "trade" => [
        "max_multiplier" => 5.0,
        "prestart_wait" => 3,
        "autosell_multiplier" => 2.5,
        "duration" => 60,
        "min_stake" => 10,
        "max_stake" => 50000,
        "min_deposit" => 50
    ],
    "withdraw" => [
        "min_withdrawal" => 100,
        "max_withdrawal" => 100000
    ],
    "payments" => [
        "usd_rate" => 129.00,
        "deposit_currency" => "kes",
        "gateway" => "payhero",
        "payhero" => [
            "api_username" => "",
            "api_password" => "",
            "channel_id" => "",
            "callback_url" => "",
            "service_name" => "MaliCrush M-Pesa"
        ]
    ],
    "site" => [
        "name" => "MaliCrush",
        "tagline" => "Trade Smart, Earn Big",
        "licence" => "BHA-0023-1873201"
    ]
];

$current = $defaults;
if (file_exists($file)) {
    $saved = json_decode(file_get_contents($file), true);
    if (is_array($saved)) {
        $current = array_replace_recursive($defaults, $saved);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    if (!empty($input)) {
        if (isset($input['currency'])) {
            $current['payments']['deposit_currency'] = strtolower($input['currency']);
        }
        if (isset($input['usdRate'])) {
            $current['payments']['usd_rate'] = (float)$input['usdRate'];
        }
        if (isset($input['minDep'])) {
            $current['trade']['min_deposit'] = (float)$input['minDep'];
        }
        if (isset($input['minStake'])) {
            $current['trade']['min_stake'] = (float)$input['minStake'];
        }
        if (isset($input['maxStake'])) {
            $current['trade']['max_stake'] = (float)$input['maxStake'];
        }
        if (isset($input['speed'])) {
            $current['graph']['speed'] = (int)$input['speed'];
        }
        if (isset($input['spikeFreq'])) {
            $current['graph']['spike_frequency'] = (float)$input['spikeFreq'];
        }
        if (isset($input['spikeMax'])) {
            $current['graph']['spike_max'] = (float)$input['spikeMax'];
        }
        if (isset($input['crashFreq'])) {
            $current['graph']['crash_frequency'] = (float)$input['crashFreq'];
        }
        if (isset($input['crashDepth'])) {
            $current['graph']['crash_depth'] = (float)$input['crashDepth'];
        }
        if (isset($input['maxMult'])) {
            $current['trade']['max_multiplier'] = (float)$input['maxMult'];
        }
        if (isset($input['prestart'])) {
            $current['trade']['prestart_wait'] = (int)$input['prestart'];
        }
        if (isset($input['autosell'])) {
            $current['trade']['autosell_multiplier'] = (float)$input['autosell'];
        }

        // PayHero settings mapping
        if (!isset($current['payments']['payhero'])) {
            $current['payments']['payhero'] = [];
        }
        if (isset($input['payhero']) && is_array($input['payhero'])) {
            $current['payments']['payhero'] = array_merge($current['payments']['payhero'], $input['payhero']);
        }
        if (isset($input['payheroUsername'])) {
            $current['payments']['payhero']['api_username'] = trim($input['payheroUsername']);
        }
        if (isset($input['payheroPassword'])) {
            $current['payments']['payhero']['api_password'] = trim($input['payheroPassword']);
        }
        if (isset($input['payheroChannelId'])) {
            $current['payments']['payhero']['channel_id'] = trim($input['payheroChannelId']);
        }
        if (isset($input['payheroCallbackUrl'])) {
            $current['payments']['payhero']['callback_url'] = trim($input['payheroCallbackUrl']);
        }

        if (isset($input['payments']) && is_array($input['payments'])) {
            $current['payments'] = array_merge($current['payments'], $input['payments']);
        }
        if (isset($input['trade']) && is_array($input['trade'])) {
            $current['trade'] = array_merge($current['trade'], $input['trade']);
        }
        if (isset($input['graph']) && is_array($input['graph'])) {
            $current['graph'] = array_merge($current['graph'], $input['graph']);
        }

        @file_put_contents($file, json_encode($current, JSON_PRETTY_PRINT));
    }
}

echo json_encode($current);
