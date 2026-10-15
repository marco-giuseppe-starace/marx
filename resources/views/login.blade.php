<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Accedi · {{ config('app.name') }}</title>
    <link rel="stylesheet" href="{{ asset('css/marx.css') }}?v={{ filemtime(public_path('css/marx.css')) }}">
    <link rel="stylesheet" href="{{ asset('css/liquid-glass.css') }}?v={{ filemtime(public_path('css/liquid-glass.css')) }}">
    <script>
        try {
            const t = JSON.parse(localStorage.getItem('marx.theme') || '"auto"');
            document.documentElement.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
        } catch {}
    </script>
</head>
<body class="loginscreen">
    <div class="lock-clock">
        <div class="lock-date" id="lockDate"></div>
        <div class="lock-time" id="lockTime"></div>
    </div>

    <form class="lock-form" method="POST" action="{{ route('login') }}">
        @csrf
        <div class="avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="44" height="44"><path d="M3 20V4l9 9 9-9v16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>
        </div>
        <input class="lock-input" type="email" name="email" value="{{ old('email') }}" placeholder="Email" autocomplete="username" required @unless(old('email')) autofocus @endunless aria-label="Email">
        <div class="lock-pass">
            <input class="lock-input" type="password" name="password" placeholder="Password" autocomplete="current-password" required @if(old('email')) autofocus @endif aria-label="Password">
            <button type="submit" aria-label="Accedi">→</button>
        </div>
        <label class="lock-remember"><input type="checkbox" name="remember" value="1" checked> Resta collegato</label>
        @if ($errors->any())
            <p class="lock-error" role="alert">{{ $errors->first() }}</p>
        @endif
    </form>

    <script>
        const tick = () => {
            const d = new Date();
            document.getElementById('lockDate').textContent = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
            document.getElementById('lockTime').textContent = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        };
        tick(); setInterval(tick, 5000);
        @if ($errors->any()) document.querySelector('.lock-pass').classList.add('shake'); @endif
    </script>
</body>
</html>
