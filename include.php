<?php
require_once 'vendor/autoload.php';

const DATA_DIR = 'datasets/VAERS/data/';
const ES_VERSION = 'v3';

ini_set('memory_limit', '1000M');
$years = [];
$years += range(1990, 2019);
//$years = [2019];
$years[] = 'NonDomestic';
