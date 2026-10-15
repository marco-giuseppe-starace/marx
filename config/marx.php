<?php

/*
 * MarX: versione unica, letta da tutte le schermate (Info su MarX, Impostazioni › Info…).
 * Ad ogni rilascio: aggiornare qui e aggiungere una voce in CHANGELOG.md.
 */
return [
    'version' => '0.12.0',
    'codename' => 'Mondo',
    'released' => '2026-10-15',
    'agent_socket' => env('MARX_AGENT_SOCKET', '/run/marx-agent/agent.sock'),
];
