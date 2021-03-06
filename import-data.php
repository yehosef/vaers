<?php
require_once 'include.php';

use VAERS\CSVReader;
use VAERS\ESWriter;


$bulk_limit = 1000;

$data_clean = function ($data) {

    if (!$data) return $data;
    $data = array_filter($data);

    $data['x1']   = 1;   // 100%

    $data = fix_dates($data);
    $data = shorten_text($data);

    $data['REACTIONS'] = combine_reactions($data) ?: null;

    $data = fix_numdays($data);

    $data = clean_nullable($data);
    $data = has_fields($data);

    return $data;
};

$first_run = false;
foreach ($years as $year)
{
    echo "\n running year $year\n";

    $index = ESWriter::getIndexName($year);

    $es_writer = new ESWriter();

    $csv_reader = new CSVReader();
    $csv_reader->setRowCB($data_clean);

    $data_generator = $csv_reader->lineGenerator(DATA_DIR . $year . 'VAERSDATA.csv');

    $documents = [];

    foreach ($data_generator as $data)
    {
        if (!$data) continue;

        $documents[] = $data;

        if (count($documents) >= $bulk_limit)
        {
            $es_writer->send_bulk($documents, $index, !$first_run);
            $documents = [];
        }
    }

    if ($documents)
    {
        $es_writer->send_bulk($documents, $index,!$first_run);
    }
}

function clean_nullable($data): array
{
    $fields = [
        'ALLERGIES',
        'OTHER_MEDS',
        'HISTORY',
        'LAB_DATA',
        'CUR_ILL'
    ];

    static $null_expressions;

    if (!$null_expressions)
    {
        $null_expressions = array_flip([
            'unknown',
            'unk',
            'na',
            'no',
            'n/a',
            'none',
            'none;',
            'none.',
            'none known',
            'no known allergies',
            'nkda',
            'nka',
            'no known drug allergy',
            'no know drug or food allergies',
            'no allergies to medications, food, or other products',
            'none reported',
            'none on file',
            'not stated',
            'no relevant history;',
            'no relevant history',
            'no relevant hx',
            'no relevant hx;',
            'no relevant hx.',
            'no hx of drug allergy'
        ]);
    }

    foreach ($fields as $field)
    {
        if (!array_key_exists($field,$data)) continue;

        $value = trim(strtolower($data[$field]));
        if (array_key_exists($value, $null_expressions))
        {
            unset($data[$field]);
        }
    }

    return $data;
}

function has_fields($data): array
{
    $possible_fields = [
        'OTHER_MEDS',
        'CUR_ILL',
        'HISTORY',
        'ALLERGIES',
        'LAB_DATA'
    ];

    $extra_data = [];
    foreach ($possible_fields as $possible_field)
    {
        if (!empty($data[$possible_field]))
        {
            $extra_data[] = $possible_field;
        }
    }

    if ($extra_data)
    {
        $data['HAS_DATA'] = $extra_data;
    }

    return $data;
}


function combine_reactions($data): array
{
    //make reactions into array field,
    $reactions     = [
        ['L_THREAT','Y'],
        ['DIED','Y'],
        ['HOSPITAL','Y'],
        ['DISABLE','Y'],
        ['RECOVD','N','!RECOVED'],
        ['ER_VISIT','Y'],
        ['ER_ED_VISIT','Y'],
        ['X_STAY','Y'],
    ];

    $reactions_arr = [];
    foreach ($reactions as $rp)
    {
        //reaction_pieces
        $field       = $rp[0];
        $value       = $rp[1];
        $replacement = $rp[2] ?? null;

        if (isset($data[$field]) && $data[$field] == $value)
        {
            $reaction_string = $replacement ?: $field;
            $reactions_arr[] = $reaction_string;
        }
    }

    return $reactions_arr;
}


/**
 * @param $data
 * @return mixed
 */
function fix_dates($data)
{
    //fix dates -currently in MM/DD/YYYY - should be converted to YYYY-MM-DD
    $date_fields = [
        'DATEDIED',
        'ONSET_DATE',
        'RECVDATE',
        'RPT_DATE',
        'TODAYS_DATE',
        'VAX_DATE'
    ];

    foreach ($date_fields as $date_field)
    {
        if (!empty($data[$date_field]))
        {
            $date        = $data[$date_field];
            $date        = str_replace('\\', '', $date);
            $date_pieces = explode('/', $date);

            if (count($date_pieces) !== 3)
            {
                echo "\ninvalid date format in: {$data['VAERS_ID']} in $date_field";
                $data[$date_field] = null;
                continue;
            }

            $day   = str_pad($date_pieces[1], 2, '0', STR_PAD_LEFT);
            $month = str_pad($date_pieces[0], 2, '0', STR_PAD_LEFT);
            $year  = $date_pieces[2];

            $data[$date_field] = "$year-$month-$day";
        }
    }

    return $data;
}


/**
 * @param $data
 * @return mixed
 */
function fix_numdays($data)
{
    if (!isset($data['NUMDAYS']) && isset($data['VAX_DATE']) && isset($data['ONSET_DATE']))
    {
        // this doesn't make sense - probably that dates were confused.
        if ($data['ONSET_DATE'] < $data['VAX_DATE'])
        {
//            $data['ADJUSTED']   = true;
            $old_vaxdate        = $data['VAX_DATE'];
            $data['VAX_DATE']   = $data['ONSET_DATE'];
            $data['ONSET_DATE'] = $old_vaxdate;
        }

        $onset = strtotime($data['ONSET_DATE']);
        $vax   = strtotime($data['VAX_DATE']);

        $diff = $onset - $vax;

        if ($diff >= 0)
        {
            $days             = (int)floor($diff / (24 * 60 * 60));
            $data['NUMDAYS']  = $days;
//            $data['ADJUSTED'] = true;
        }
        else
        {
            echo "not sure this is supposed to happen\n";
        }
    }

    if (($data['NUMDAYS'] ?? 0) > 10000)
    {
        unset($data['NUMDAYS']);
    }

    return $data;
}


function shorten_text($data)
{
    $text_fields = [
        'SYMPTOM_TEXT',
//        'LAB_DATA',
//        'HISTORY'
    ];

    foreach ($text_fields as $field)
    {
        if (isset($data[$field]))
        {
            $text             = wordwrap($data[$field]);
            $text             = keepXLines($text, 10);
            $new_field        = 'SHORT_'.$field;
            $data[$new_field] = $text;
        }
    }

    return $data;
}


function keepXLines($str, $num = 10)
{
    $lines  = explode("\n", $str);
    $firsts = array_slice($lines, 0, $num);

    return implode("\n", $firsts);
}

echo "\n finished\n";

