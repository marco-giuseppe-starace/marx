<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('marx:user {email} {name}', function (string $email, string $name) {
    $password = \Illuminate\Support\Str::password(14, symbols: false);
    \App\Models\User::updateOrCreate(['email' => $email], ['name' => $name, 'password' => $password]);
    $this->info("Utente $email pronto. Password: $password");
})->purpose('Crea un utente MarX (o reimposta la password) con una password casuale');
