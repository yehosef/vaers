<?php
require_once 'include.php';

use VAERS\CSVReader;
use VAERS\ESWriter;


$bulk_limit = 1000;

foreach ($years as $year)
{
    echo "\n running year $year\n";

    $index = ESWriter::getIndexName($year);
    $es_writer = new ESWriter();

    $symptoms = load_symptoms($year);

    $documents = [];
    foreach ($symptoms as $vaers_id => $row)
    {
        if (!$row) continue;

        $data = [
            'VAERS_ID' => $vaers_id,
            'SYMPTOMS' => $row
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
function load_symptoms($year): array
{
    $filename = $year . "VAERSSYMPTOMS.csv";

    $csv_reader = new CSVReader();

    $generator = $csv_reader->lineGenerator(DATA_DIR . $filename);

    $vaers_vax = [];
    foreach ($generator as $row)
    {
        if (!$row) continue;

        $vaers_id = $row['VAERS_ID'];

        for ($i=1; $i<6; $i++)
        {
            $key = 'SYMPTOM'.$i;
            if (!array_key_exists($key, $row)) break;

            $vaers_vax[$vaers_id][] = $row[$key];
        }
    }

    return $vaers_vax;
}


