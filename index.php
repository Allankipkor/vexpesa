<?php
session_start();
if (!isset($_SESSION['balance'])) {
    $_SESSION['balance'] = 2500.00;
}
include __DIR__ . '/index.html';
