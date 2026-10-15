<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Terminale: dopo il controllo della password rilascia un gettone firmato, valido 30 secondi
 * e usabile una volta sola, con cui il browser apre la shell sul servizio marx-term.
 */
class TerminalController extends Controller
{
    private const SECRET_FILE = '/etc/marx-term/secret';

    public function session(Request $request)
    {
        $request->validate(['password' => ['required', 'string', 'max:200']]);
        $user = $request->user();

        if (! Hash::check($request->password, $user->password)) {
            Log::warning('Terminale: password errata', ['user' => $user->id, 'ip' => $request->ip()]);

            return response()->json(['message' => 'Password errata'], 422);
        }
        if (! is_readable(self::SECRET_FILE)) {
            return response()->json(['message' => 'Il servizio Terminale non è installato sul server.'], 503);
        }

        $payload = json_encode(['u' => $user->id, 'exp' => time() + 30, 'n' => Str::random(32)]);
        $sig = hash_hmac('sha256', $payload, trim(file_get_contents(self::SECRET_FILE)), true);
        $b64 = fn ($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
        Log::info('Terminale aperto', ['user' => $user->id, 'ip' => $request->ip()]);

        return ['token' => $b64($payload).'.'.$b64($sig)];
    }
}
