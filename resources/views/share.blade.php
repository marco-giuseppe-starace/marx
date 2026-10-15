<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>{{ $state === 'ok' ? basename($share->path) : 'Link non disponibile' }} · {{ config('app.name') }}</title>
    <style>
        :root { color-scheme: light dark; --bg: #eef2f8; --card: #ffffffcc; --text: #1d1d1f; --muted: #6e6e73; --accent: #0a84ff; }
        @media (prefers-color-scheme: dark) { :root { --bg: #0f1424; --card: #1c1c1ecc; --text: #f5f5f7; --muted: #98989d; } }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--text);
            background: radial-gradient(80% 60% at 18% 22%, rgba(120,220,255,.5), transparent 60%), radial-gradient(70% 55% at 85% 18%, rgba(170,130,255,.45), transparent 62%), var(--bg); }
        .card { width: min(420px, 100%); padding: 32px 28px; border-radius: 26px; background: var(--card); backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px);
            box-shadow: 0 20px 60px rgba(0,0,0,.15), inset 0 1px 0 rgba(255,255,255,.6); text-align: center; }
        .icon { width: 72px; height: 72px; margin: 0 auto 14px; border-radius: 18px; display: flex; align-items: center; justify-content: center; background: linear-gradient(160deg, #6ac3ff, #2a7de1); color: #fff; font-size: 30px; }
        h1 { font-size: 20px; margin: 0 0 4px; overflow-wrap: anywhere; }
        p { margin: 4px 0; color: var(--muted); }
        a.btn, button { display: inline-block; margin-top: 20px; padding: 10px 26px; border-radius: 999px; border: 0; background: var(--accent); color: #fff; font: 600 15px inherit; text-decoration: none; cursor: pointer; }
        input { width: 100%; margin-top: 16px; padding: 10px 14px; border-radius: 12px; border: 1px solid #8884; background: transparent; color: var(--text); font: inherit; }
        .err { color: #ff3b30; }
        footer { margin-top: 22px; font-size: 12px; color: var(--muted); }
    </style>
</head>
<body>
    <main class="card">
        @if ($state === 'missing')
            <div class="icon">?</div>
            <h1>Link non disponibile</h1>
            <p>Il file è stato rimosso oppure il link è stato revocato.</p>
        @elseif ($state === 'expired')
            <div class="icon">⏱</div>
            <h1>Link scaduto</h1>
            <p>Chiedi a chi te lo ha inviato di condividerlo di nuovo.</p>
        @elseif (! $unlocked)
            <div class="icon">🔒</div>
            <h1>{{ basename($share->path) }}</h1>
            <p>{{ $share->owner->name }} ha protetto questo file con una password.</p>
            <form method="POST" action="{{ url('/s/'.$share->token) }}">
                @csrf
                <input type="password" name="password" placeholder="Password" autofocus required aria-label="Password">
                @error('password')<p class="err">{{ $message }}</p>@enderror
                <button>Sblocca</button>
            </form>
        @else
            <div class="icon">{{ $share->type === 'folder' ? '📁' : '📄' }}</div>
            <h1>{{ basename($share->path) }}</h1>
            <p>Condiviso da {{ $share->owner->name }}</p>
            <p>
                @if ($share->type === 'folder') Cartella · verrà scaricata come ZIP
                @else {{ $size < 1048576 ? max(1, round($size / 1024)).' KB' : number_format($size / 1048576, 1, ',', '.').' MB' }}
                @endif
                @if ($share->expires_at) · disponibile fino al {{ $share->expires_at->timezone('Europe/Rome')->format('d/m/Y H:i') }} @endif
            </p>
            <a class="btn" href="{{ url('/s/'.$share->token.'/download') }}">Scarica</a>
        @endif
        <footer>Condiviso con {{ config('app.name') }}</footer>
    </main>
</body>
</html>
