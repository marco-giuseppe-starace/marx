<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Meteo e Mappe: limiti separati, così i tasselli della mappa non consumano quelli delle altre richieste
        RateLimiter::for('geo', fn (Request $r) => Limit::perMinute(120)->by('geo:'.$r->user()?->id));
        RateLimiter::for('tiles', fn (Request $r) => Limit::perMinute(3000)->by('tiles:'.$r->user()?->id));
    }
}
