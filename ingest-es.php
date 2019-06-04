<?php
require_once 'include.php';

use VAERS\ESWriter;

$bulk_limit = 1000;
$last_write = time();

$es_writer = new ESWriter();
$redis     = new Redis();

$key = 'VAERS';

$lua = 'local result = redis.call(\'lrange\',KEYS[1],0,ARGV[1]-1)
redis.call(\'ltrim\',KEYS[1],ARGV[1],-1)
return result';
$documents = [];
while (true)
{
    // load documents from redis - take 100 at a time

    $rows = $redis->eval($lua, [$key, 100]);

    foreach ($rows as $row_string)
    {

        $row = json_decode($row_string);

        $doc         = $es_writer->create_document($row, true);
        $documents[] = $doc;

    }

    if (count($documents) >= $bulk_limit || time() - $last_write > 10)
    {
        $es_writer->send_bulk_docs($documents);
        $documents = [];
    }


}
