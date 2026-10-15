<?php

namespace App\Services;

use RuntimeException;

/**
 * Client dell'agente MarX (agent/agent.py), che gestisce Docker per conto del sito.
 * Protocollo: una riga JSON di richiesta, una riga JSON di risposta.
 */
class Agent
{


    public static function call(string $cmd, array $args = [], int $timeout = 60): mixed
    {
        // Percorso configurabile: la copia di prova punta a un socket inesistente e non tocca Docker
        $sock = @stream_socket_client('unix://'.config('marx.agent_socket'), $errno, $error, 5);
        if (! $sock) {
            throw new RuntimeException('Il servizio Soft Store non è raggiungibile. Riprova tra qualche secondo.');
        }

        stream_set_timeout($sock, $timeout);
        fwrite($sock, json_encode(['cmd' => $cmd] + $args)."\n");
        $line = fgets($sock);
        fclose($sock);

        $response = json_decode((string) $line, true);
        if (! is_array($response)) {
            throw new RuntimeException('Risposta non valida dal servizio Soft Store.');
        }
        if (! $response['ok']) {
            throw new RuntimeException($response['error'] ?? 'Operazione non riuscita.');
        }

        return $response['data'] ?? null;
    }
}
