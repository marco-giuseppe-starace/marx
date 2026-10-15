<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/** Gestione degli utenti di MarX (solo amministratori). */
class UserAdminController extends Controller
{
    public function index()
    {
        return User::orderBy('name')->get(['id', 'name', 'email', 'is_admin', 'created_at']);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:60'],
            'email' => ['required', 'email', 'max:120', 'unique:users,email'],
            'is_admin' => ['boolean'],
        ], ['email.unique' => 'Esiste già un utente con questa email.']);

        $password = Str::password(14, symbols: false);
        $user = User::create(['name' => $data['name'], 'email' => $data['email'], 'password' => $password]);
        $user->forceFill(['is_admin' => (bool) ($data['is_admin'] ?? false)])->save();

        return ['user' => $user->only('id', 'name', 'email', 'is_admin'), 'password' => $password];
    }

    public function update(Request $request, User $user)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:60'],
            'email' => ['sometimes', 'required', 'email', 'max:120', Rule::unique('users', 'email')->ignore($user->id)],
            'is_admin' => ['sometimes', 'boolean'],
        ]);
        if ($user->is($request->user()) && array_key_exists('is_admin', $data) && ! $data['is_admin']) {
            abort(422, 'Non puoi togliere a te stesso i permessi di amministratore.');
        }
        $user->fill(collect($data)->only('name', 'email')->all());
        if (array_key_exists('is_admin', $data)) {
            $user->is_admin = $data['is_admin'];
        }
        $user->save();

        return $user->only('id', 'name', 'email', 'is_admin');
    }

    public function resetPassword(User $user)
    {
        $password = Str::password(14, symbols: false);
        $user->update(['password' => $password]);

        return ['password' => $password];
    }

    public function destroy(Request $request, User $user)
    {
        abort_if($user->is($request->user()), 422, 'Non puoi eliminare il tuo stesso account.');

        // File personali e sfondo personalizzato
        Storage::disk('local')->deleteDirectory($user->filesRoot());
        foreach (Storage::disk('local')->files('wallpapers') as $f) {
            if (str_starts_with(basename($f), $user->id.'.')) {
                Storage::disk('local')->delete($f);
            }
        }
        $user->delete();  // le note vengono cancellate a cascata

        return response()->noContent();
    }
}
