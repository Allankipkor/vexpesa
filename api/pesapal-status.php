<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$ref = $_GET['ref'] ?? '';
session_start();
if (!isset($_SESSION['balance'])) $_SESSION['balance'] = 2500.00;

echo json_encode([
    'status' => 'completed',
    'balance' => (float)$_SESSION['balance']
]);
