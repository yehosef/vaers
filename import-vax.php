<?php
require_once 'include.php';

use VAERS\CSVReader;
use VAERS\ESWriter;

$years = range(1990, 2019);

$bulk_limit = 1000;

foreach ($years as $year)
{
    echo "\n running year $year\n";

    $index = ESWriter::getIndexName($year);

    $vaers_vax = load_vax($year);

    $es_writer = new ESWriter();

    $documents = [];
    foreach ($vaers_vax as $vaers_id => $vax_data)
    {
        if (!$vax_data ) continue;

        $data = [
            'VAERS_ID' => $vaers_id,
            'VAX'      => $vax_data['VAX_ARR'],
            'NUM_VAX'  => count($vax_data['VAX_ARR']),
            'VAX_COMBOS' => $vax_data['COMBOS']
        ];

        $documents[] = $data;

        if (count($documents) >= $bulk_limit)
        {
            $es_writer->send_bulk($documents, $index,true);
            $documents = [];
        }
    }

    if ($documents) {
        $es_writer->send_bulk($documents, $index,true);
    }
}


/**
 * @param $year
 * @return array
 */
function load_vax($year): array
{
    $headers_cb = function ($headers) {
        return array_map(function ($header) {
            return str_replace('VAX_', '', $header);
        }, $headers);
    };


    $csv_reader = new CSVReader();
    $csv_reader->setHeaderCB($headers_cb);

    $data_generator = $csv_reader->lineGenerator(DATA_DIR . $year . "VAERSVAX.csv");

    $vaers_vax = [];
    foreach ($data_generator as $vax_row)
    {
        $vaers_id = $vax_row['VAERS_ID'];
        unset($vax_row['VAERS_ID']);

        if (!isset($vaers_vax[$vaers_id])) $vaers_vax[$vaers_id] = [];

        $vaers_vax[$vaers_id][] = $vax_row;
    }

    //todo - foreach vaers, create VAX ngrams
    $return = [];
    foreach ($vaers_vax as $vaers_id => $vax_arr)
    {
        $vax_types = array_column($vax_arr,'TYPE');
        sort($vax_types);

        $combos = combos($vax_types);
        $return[$vaers_id] = [
            'VAX_ARR' => $vax_arr,
            'COMBOS' => $combos
        ];
    }

    return $return;
}

function combos($words){
    $combos = array();
    $len = count($words);
    for($i=0;$i+1<$len;$i++){
        for($j=$i+1;$j<$len;$j++) {

            $combos[]=$words[$i].'::'.$words[$j];
        }
    }
    return $combos;
}

