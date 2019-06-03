<?php

namespace VAERS;

use Elastica\Bulk;
use Elastica\Bulk\Action;
use Elastica\Client;
use Elastica\Document;
use Elastica\Type;
use Exception;

class ESWriter
{
    protected $elasticaClient;
    protected $bulk;


    public function __construct(Client $client = null)
    {
        $this->elasticaClient = $client ?? new Client();
        $this->resetBulk();
    }


    function send_bulk($records, $index, $update = false)
    {
        if (memory_get_usage() > 100 * 1024 * 1024)
        {
            $this->resetBulk();
        }

        if (!$records || !count($records)) return;

        $bulk = $this->bulk;

        $type      = '_doc';
        $documents = [];
        foreach ($records as $row)
        {
            $vaers_id = $row['VAERS_ID'];
            if (!$vaers_id)
            {
                echo "\nmissing vaers id: " . json_encode($row);
                continue;
            }

            $doc = new Document($vaers_id, $row);
            $doc->setIndex($index);
            $doc->setType($type);

            $documents[] = $doc;
        }

        $op_type = $update ? Action::OP_TYPE_UPDATE : Action::OP_TYPE_INDEX;

        $bulk->addDocuments($documents, $op_type);

        try
        {
            $bulk->send();
        }
        catch (Exception $exception)
        {
            $elasticaType = $this->getESType($index);
            foreach ($documents as $doc)
            {
                try
                {
                    $elasticaType->addDocument($doc);
                }
                catch (Exception $exception)
                {
                    echo "\nerror saving: " . json_encode($doc->getData());
                    echo "\nexception: {$exception->getMessage()}\n\n";
                }
            }
//        $debug = 1;
        }

        //todo - did it work?
//    $debug = 1;
    }


    /**
     * @param array $data
     * @param Type $elasticaType
     */
    static function upsert_document(?array $data, Type $elasticaType): void
    {
        if (!$data) return;

        $vaers_id = $data['VAERS_ID'];

        if (!$vaers_id)
        {
            echo "error - no vaers_id found for row:";
            print_r($data);

            return;
        }

        $doc = new Document($vaers_id, $data);

        try
        {
            $elasticaType->updateDocument($doc);
        }
        catch (Exception $exception)
        {
            try
            {
                $elasticaType->addDocument($doc);
            }
            catch (Exception $exception)
            {
                echo "\n doc not updated : " . json_encode($data);
                echo "\nexception: {$exception->getMessage()}\n\n";
            }
        }
    }


    protected function getESType($index)
    {
        $elasticaIndex = $this->elasticaClient->getIndex($index);
        $elasticaType  = $elasticaIndex->getType('_doc');

        return $elasticaType;
    }



    public function resetBulk(): Bulk
    {
        $this->bulk = new Bulk($this->elasticaClient);;

        return $this->bulk;
    }


    public static function getIndexName($year)
    {
        return 'vaers-' . ES_VERSION . '-' . strtolower($year);
    }

}
