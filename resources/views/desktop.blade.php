<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>{{ config('app.name') }}</title>
    <link rel="stylesheet" href="{{ asset('css/marx.css') }}?v={{ filemtime(public_path('css/marx.css')) }}">
    <link rel="stylesheet" href="{{ asset('css/liquid-glass.css') }}?v={{ filemtime(public_path('css/liquid-glass.css')) }}">
</head>
<body>
    {{-- Barra dei menu --}}
    <header class="menubar">
        <div class="menubar-left">
            <button class="menu-logo" data-menu="system" aria-label="Menu MarX">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 20V4l9 9 9-9v16" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>
            </button>
            <button class="menu-app" id="activeAppName" data-menu="appname">Finder</button>
            <span id="appMenus" class="menubar-left"></span>
        </div>
        <div class="menubar-right">
            <button class="menu-icon" id="spotlightBtn" aria-label="Cerca">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <button class="menu-icon" id="controlBtn" aria-label="Centro di controllo">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="3" y="5" width="18" height="5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="7.5" r="1.4" fill="currentColor"/><rect x="3" y="14" width="18" height="5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="16.5" r="1.4" fill="currentColor"/></svg>
            </button>
            <button class="menu-item-user" data-menu="user">{{ auth()->user()->name }}</button>
            <span class="menu-clock" id="clock"></span>
        </div>
    </header>

    {{-- Menu a tendina (riempito da JS) --}}
    <div class="dropdown" id="dropdown" hidden></div>

    {{-- Scrivania --}}
    <main class="desktop" id="desktop">
        <div class="desktop-icons">
            <button class="desk-icon" data-open="finder"><span class="ico ico-folder"></span><span>Documenti</span></button>
            <button class="desk-icon" data-open="notes"><span class="ico ico-notes"></span><span>Note</span></button>
            <button class="desk-icon" data-open="about"><span class="ico ico-disk"></span><span>MarX HD</span></button>
        </div>
        <div id="windows"></div>
    </main>

    {{-- Dock --}}
    <nav class="dock-wrap" aria-label="Dock">
        <div class="dock" id="dock">
            <button class="dock-item" data-open="finder" data-label="Finder"><span class="ico ico-finder"></span></button>
            <button class="dock-item" data-open="launchpad" data-label="Launchpad"><span class="ico ico-launchpad"></span></button>
            <button class="dock-item" data-open="notes" data-label="Note"><span class="ico ico-notes"></span></button>
            <button class="dock-item" data-open="webx" data-label="webX"><span class="ico ico-webx"></span></button>
            <button class="dock-item" data-open="calculator" data-label="Calcolatrice"><span class="ico ico-calc"></span></button>
            <button class="dock-item" data-open="calendar" data-label="Calendario"><span class="ico ico-calendar"><b id="dockDay"></b></span></button>
            <button class="dock-item" data-open="settings" data-label="Impostazioni"><span class="ico ico-settings"></span></button>
            @if (auth()->user()->is_admin)
            <button class="dock-item" data-open="appstore" data-label="Soft Store"><span class="ico ico-appstore"></span></button>
            <button class="dock-item" data-open="activity" data-label="Monitoraggio Attività"><span class="ico ico-activity"></span></button>
            @endif
            <span id="dockApps" class="dock-apps"></span>
            <span class="dock-sep"></span>
            <button class="dock-item" data-open="trash" data-label="Cestino"><span class="ico ico-trash"></span></button>
        </div>
    </nav>

    {{-- Spotlight --}}
    <div class="spotlight" id="spotlight" hidden>
        <input id="spotlightInput" type="text" placeholder="Ricerca Spotlight" autocomplete="off">
        <div id="spotlightResults"></div>
    </div>

    {{-- Centro di controllo --}}
    <div class="control" id="control" hidden>
        <div class="cc-tile cc-wide">
            <span>Aspetto</span>
            <div class="seg"><button data-theme-set="light">Chiaro</button><button data-theme-set="dark">Scuro</button><button data-theme-set="auto">Auto</button></div>
        </div>
        <div class="cc-grid" id="ccExtras"></div>
        <div class="cc-tile cc-wide">
            <span>Luminosità</span>
            <input type="range" id="brightness" min="40" max="100" value="100">
        </div>
    </div>

    <form id="logoutForm" method="POST" action="{{ route('logout') }}" hidden>@csrf</form>

    <script>
        window.MARX = {
            name: @json(config('app.name')),
            version: @json(config('marx.version')),
            codename: @json(config('marx.codename')),
            user: @json(auth()->user()->only('name', 'email', 'is_admin')),
            settings: @json((object) (auth()->user()->settings ?? [])),
            laravel: @json(app()->version()),
        };
    </script>
    <script src="{{ asset('js/marx.js') }}?v={{ filemtime(public_path('js/marx.js')) }}"></script>
</body>
</html>
