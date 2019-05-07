<?php
namespace VAERS;

use Generator;

class CSVReader
{
    /** @var callable $row_cb */
    protected $row_cb;
    /** @var callable $header_cb */
    protected $header_cb;

    public function __construct()
    {
    }

    public function setHeaderCB(callable $cb)
    {
        $this->header_cb = $cb;
        return $this;
    }

    public function setRowCB(callable $cb)
    {
        $this->row_cb = $cb;
        return $this;
    }


    /**
     * @param string $filename
     * @return Generator
     */
    function lineGenerator(string $filename)
    {
        $header = [];
        $first  = true;
        if (($handle = fopen($filename, "r")) !== FALSE)
        {
            while (($line = fgets($handle)) !== FALSE)
            {
                $line = str_replace('\\",','",',$line);
                $row = str_getcsv($line,",",'"');
                if (!$row)
                {
                    //echo "empty row - skipping\n";
                    continue;
                }

                if ($first)
                {
                    $header = self::utf_clean_arr($row);
                    if ($this->header_cb) {
                        $header = ($this->header_cb)($header);
                    }
                    $first  = false;
                }
                else
                {
                    $row = self::utf_clean_arr($row);
                    $row = self::normalize_columns($header, $row);

                    $data = array_combine($header, $row);
                    $data = array_filter($data);

                    if ($this->row_cb)
                    {
                        $data = ($this->row_cb)($data);
                    }
                    yield $data;
                }
            }
            fclose($handle);
        }
    }


    /**
     * @param $vax_headers
     * @param $vax_csv
     * @return array
     */
    protected static function normalize_columns($vax_headers, $vax_csv): array
    {
        $num_header_cols = count($vax_headers);
        $num_cols        = count($vax_csv);

        if ($num_header_cols > $num_cols)
        {
            // pad rows
            $vax_row = array_pad($vax_csv, $num_header_cols, "");
        }
        elseif ($num_header_cols < $num_cols)
        {
            //truncate rows
            $extra   = array_slice($vax_csv, $num_header_cols);
            $vax_row = array_slice($vax_csv, 0, $num_header_cols);
            if (array_filter($extra))
            {
                echo "\n lost data in : " . json_encode($extra);
                echo "\n in row: " . json_encode($vax_row) . "\n\n";
            }
        }
        else
        {
            $vax_row = $vax_csv;
        }

        if (count($vax_headers) != count($vax_row))
        {
            echo "\ncolumn mismatch (not supposed to happen)";
            echo "\nvax_row: " . json_encode($vax_row);
            echo "\nvax_cols: " . json_encode($vax_headers) . "\n\n";
        }

        return $vax_row;
    }


    /**
     * @param array|null $row
     * @return array|null
     */
    protected static function utf_clean_arr(array $row)
    {
        foreach ($row as $key => $value)
        {
            if (is_array($value))
            {
                $clean_arr = self::utf_clean_arr($value);
                $row[$key] = $clean_arr;
            }
            else
            {
                $clean_utf = mb_convert_encoding($value, 'UTF-8', 'UTF-8');

//            if ($clean_utf != $value)
//            {
//                echo "\nvalue was cleaned: $key";
//            }

                $row[$key] = $clean_utf;
            }
        }

        return $row;
    }
}
