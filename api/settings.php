<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$settings = [
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
        "checkout_method" => "both"
    ],
    "site" => [
        "name" => "MaliCrush",
        "tagline" => "Trade Smart, Earn Big",
        "licence" => "BHA-0023-1873201"
    ]
];

echo json_encode($settings);
