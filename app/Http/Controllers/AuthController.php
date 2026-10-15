<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\View\View;

class AuthController extends Controller
{
    public function show(): View|RedirectResponse
    {
        return Auth::check() ? redirect()->route('desktop') : view('login');
    }

    public function login(Request $request): RedirectResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        if (! Auth::attempt($credentials, $request->boolean('remember'))) {
            return back()->withInput($request->only('email'))
                ->withErrors(['password' => 'Password errata. Riprova.']);
        }

        $request->session()->regenerate();

        return redirect()->intended(route('desktop'));
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login');
    }

    /** Sblocco dal blocco schermo: verifica solo la password, la sessione resta attiva. */
    public function unlock(Request $request)
    {
        $request->validate(['password' => ['required', 'string']]);

        if (! Hash::check($request->password, $request->user()->password)) {
            return response()->json(['message' => 'Password errata'], 422);
        }

        return response()->json(['ok' => true]);
    }

    public function updateProfile(Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:60']], ['name.required' => 'Il nome non può essere vuoto.']);
        $request->user()->update($data);

        return ['name' => $request->user()->name];
    }

    public function updatePassword(Request $request)
    {
        $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', 'confirmed', Password::min(8)],
        ], [
            'current_password.current_password' => 'La password attuale non è corretta.',
            'password.confirmed' => 'Le due nuove password non coincidono.',
            'password.min' => 'La nuova password deve avere almeno 8 caratteri.',
        ]);

        $request->user()->update(['password' => $request->password]);

        return response()->json(['ok' => true]);
    }
}
