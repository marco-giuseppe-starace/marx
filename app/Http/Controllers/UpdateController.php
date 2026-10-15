<?php

namespace App\Http\Controllers;

use App\Services\Agent;
use Illuminate\Http\Request;
use RuntimeException;

/** Aggiornamento software di MarX: controllo delle release su GitHub e installazione su conferma. */
class UpdateController extends Controller
{
    public function check(Request $request)
    {
        try {
            return response()->json(Agent::call('update_check', ['force' => $request->boolean('force')], 30));
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    public function apply()
    {
        try {
            return response()->json(Agent::call('update_apply', [], 30));
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }
}
