/* MarX — gestore finestre, dock, menu, Spotlight */
(() => {
    const $ = (s, el = document) => el.querySelector(s);
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const store = {
        get(k, d) { try { const v = localStorage.getItem('marx.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
        set(k, v) { try { localStorage.setItem('marx.' + k, JSON.stringify(v)); } catch {} },
    };

    /* ---------- Chiamate al server ---------- */
    const CSRF = document.querySelector('meta[name="csrf-token"]').content;
    async function api(method, url, body) {
        const opts = { method, headers: { 'X-CSRF-TOKEN': CSRF, Accept: 'application/json' }, credentials: 'same-origin' };
        if (body instanceof FormData) opts.body = body;
        else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
        const res = await fetch(url, opts);
        if (res.status === 401 || res.status === 419) { location.href = '/login'; throw new Error('Sessione scaduta'); }
        if (res.status === 204) return null;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const first = data.errors ? Object.values(data.errors)[0][0] : null;
            throw new Error(first || data.message || 'Errore ' + res.status);
        }
        return data;
    }
    // Notifiche impilate una sotto l'altra, come su Mac
    // Ogni notifica finisce nel Centro notifiche; con «Non disturbare» non compare né suona
    function toast(msg, opts = {}) {
        const app = opts.app || (typeof active !== 'undefined' && active && typeof APPS !== 'undefined' && APPS[active]?.name) || 'MarX';
        try {
            const list = store.get('notifications', []); list.unshift({ msg: String(msg), app, t: Date.now() });
            store.set('notifications', list.slice(0, 100));
            window.dispatchEvent(new Event('marx:notify'));
        } catch {}
        if (typeof dndActive === 'function' && dndActive() && !opts.force) return;
        if (!opts.silent && typeof playSound === 'function') playSound('notify');
        const t = document.createElement('div'); t.className = 'toast' + (opts.actions ? ' has-actions' : '');
        t.innerHTML = `<small>${esc(app)}</small><span></span>${opts.actions ? `<div class="toast-acts">${opts.actions.map((a, i) => `<button data-ta="${i}" class="${i === 0 ? 'primary' : ''}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
        t.querySelector('span').textContent = msg;
        if (opts.actions) t.addEventListener('click', e => { const b = e.target.closest('[data-ta]'); if (!b) return; t.remove(); restack(); opts.actions[+b.dataset.ta].run?.(); });
        document.body.append(t);
        const restack = () => { let y = 38; document.querySelectorAll('.toast').forEach(el => { el.style.top = y + 'px'; y += el.offsetHeight + 8; }); };
        restack();
        setTimeout(() => { t.remove(); restack(); }, opts.actions ? 15000 : 3500);
    }
    // Dialogo a tendina dentro una finestra. fields: [{name, label, type, value}]
    // Campi: {name, label, value} testo; {type:'select', options:[[valore, etichetta]]}; {type:'checkbox', value:bool}
    function sheet(win, { title, fields = [], ok = 'OK', danger = false, text = '', cancel = true }) {
        return new Promise(resolve => {
            $('.sheet-bg', win)?.remove();
            const field = f => {
                if (f.type === 'select') return `<label class="sheet-row">${esc(f.label)}<select name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
                if (f.type === 'checkbox') return `<label class="sheet-check"><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
                return `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value)}" placeholder="${esc(f.label)}" aria-label="${esc(f.label)}">`;
            };
            const bg = document.createElement('div'); bg.className = 'sheet-bg';
            bg.innerHTML = `<form class="sheet"><h4>${esc(title)}</h4>${text ? `<p style="margin:0;color:var(--muted)">${esc(text)}</p>` : ''}
                ${fields.map(field).join('')}
                <div class="acts">${cancel ? '<button type="button" class="btn" data-x>Annulla</button>' : ''}<button class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div></form>`;
            win.append(bg);
            const form = $('form', bg), first = $('input[type=text], input:not([type])', form);
            if (first) { first.focus(); first.setSelectionRange(0, first.value.lastIndexOf('.') > 0 ? first.value.lastIndexOf('.') : first.value.length); }
            else $('.btn:last-child', form).focus();
            const done = v => { bg.remove(); resolve(v); };
            if (cancel) $('[data-x]', form).onclick = () => done(null);
            form.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
            form.onsubmit = e => {
                e.preventDefault();
                const out = Object.fromEntries(new FormData(form));
                fields.filter(f => f.type === 'checkbox').forEach(f => out[f.name] = !!out[f.name]);
                done(out);
            };
        });
    }
    // Preferenze per app, salvate nel browser
    const prefs = (app, defaults) => ({ ...defaults, ...store.get('prefs.' + app, {}) });
    const savePrefs = (app, v) => store.set('prefs.' + app, v);
    // Voce con spunta: il segno viene disegnato in una colonna fissa da menuHTML
    const check = (on, label) => (on ? '\u2713\u0000' : '\u0000') + label;
    const fmtSize = b => b == null ? '' : b < 1024 ? b + ' byte' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB';

    /* ---------- Impostazioni utente (salvate nell'account) ---------- */
    const DEFAULTS = {
        theme: store.get('theme', 'auto'), accent: 'blue', textSize: 'medium', reduceTransparency: false, reduceMotion: false,
        wallpaper: store.get('wall', '1'), wallpaperColor: '#2c4fc4', wallpaperFit: 'cover',
        dockSize: 54, dockMagnify: true, dockMagnifyScale: 1.6, dockAutohide: false,
        desktopIcons: true, restoreWindows: true, clockSeconds: false, clockDate: true, autoLockMinutes: 0,
        webxSearch: 'bing', webxBookmarks: [
            { title: 'Wikipedia', url: 'https://it.wikipedia.org/' },
            { title: 'la Repubblica', url: 'https://www.repubblica.it/' },
            { title: 'OpenStreetMap', url: 'https://www.openstreetmap.org/' },
            { title: 'Bing', url: 'https://www.bing.com/' },
        ],
        dndUntil: 0, sounds: true, soundVolume: 0.5, notifySound: 'vetro', startupSound: true,
        screensaverMinutes: 0, screensaverStyle: 'aurora', shortcuts: {},
        stageManager: false, tiling: true, desktopStacks: false, hotTL: 'none', hotTR: 'none', hotBL: 'none', hotBR: 'none',
        cursorStyle: 'mac', cursorSize: 1, cursorFill: '#000000', cursorOutline: '#ffffff', shakeToLocate: true, titlebarDoubleClick: 'maximize',
    };
    const S = { ...DEFAULTS, ...(MARX.settings || {}) };
    const ACCENTS = { blue: '#0a84ff', purple: '#a55cf0', pink: '#ff2d6f', red: '#ff3b30', orange: '#ff9500', yellow: '#e6b800', green: '#28c840', graphite: '#8e8e93' };
    const WALLPAPERS = {
        1: 'var(--wallpaper)',
        2: 'linear-gradient(180deg, #4facfe 0%, #00c6a7 100%)',
        3: 'linear-gradient(135deg, #232526, #414345)',
        4: 'radial-gradient(circle at 30% 30%, #f6d365, #fda085 45%, #c2185b)',
        5: 'radial-gradient(120% 90% at 20% 15%, #ffb36b 0%, transparent 55%), radial-gradient(100% 80% at 85% 20%, #ff6f91 0%, transparent 60%), linear-gradient(170deg, #ff8a5c, #6a3093)',
        6: 'radial-gradient(90% 70% at 30% 20%, #1f7a5c 0%, transparent 60%), linear-gradient(160deg, #0f3d3e, #062726 60%, #02140f)',
    };
    const mq = matchMedia('(prefers-color-scheme: dark)');
    function wallpaperCSS() {
        if (S.wallpaper === 'color') return S.wallpaperColor;
        if (S.wallpaper === 'custom') {
            const url = `url("/settings/wallpaper?v=${S.wallpaperVersion || 0}")`;
            return { cover: `${url} center / cover no-repeat`, contain: `${url} center / contain no-repeat, #111`, center: `${url} center / auto no-repeat, #111`, tile: `${url} top left / auto repeat` }[S.wallpaperFit] || `${url} center / cover no-repeat`;
        }
        return WALLPAPERS[S.wallpaper] || WALLPAPERS[1];
    }
    function applySettings() {
        const root = document.documentElement;
        root.dataset.theme = S.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : S.theme;
        document.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('on', b.dataset.themeSet === S.theme));
        root.style.setProperty('--accent', ACCENTS[S.accent] || ACCENTS.blue);
        root.style.setProperty('--desk-bg', wallpaperCSS());
        root.style.setProperty('--dock-size', S.dockSize + 'px');
        root.style.setProperty('--text-size', { small: '12px', medium: '13px', large: '14.5px' }[S.textSize] || '13px');
        root.classList.toggle('no-transparency', !!S.reduceTransparency);
        root.classList.toggle('reduce-motion', !!S.reduceMotion);
        applyCursors();
        document.body.classList.toggle('dock-autohide', !!S.dockAutohide);
        document.body.classList.toggle('no-desk-icons', !S.desktopIcons);
        if (typeof layoutStage === 'function' && document.getElementById('windows')) try { layoutStage(); } catch {}
        try { localStorage.setItem('marx.theme', JSON.stringify(S.theme)); } catch {}  // la pagina di accesso usa lo stesso tema
        if (typeof tick === 'function') tick();
    }
    /* Puntatori in stile Mac, disegnati in SVG: colori e dimensione dalle impostazioni */
    const CURSORS = {
        default: { hx: 5, hy: 3, svg: (f, o) => `<path d="M5 3v16.2l4.3-3.9 2.8 6.1 2.8-1.3-2.8-6h5.8z" fill="${f}" stroke="${o}" stroke-width="1.4" stroke-linejoin="round"/>` },
        pointer: { hx: 10, hy: 3, svg: (f, o) => `<path d="M8.5 4.2a1.6 1.6 0 0 1 3.2 0V10h.4V8.7a1.6 1.6 0 0 1 3.2 0V10h.3v-.6a1.6 1.6 0 0 1 3.2 0v1.1a1.6 1.6 0 0 1 2.6 1.2V15c0 3.6-2.4 6.3-6 6.3h-1.5c-2.1 0-3.4-.8-4.6-2.4l-3.5-4.7a1.6 1.6 0 0 1 2.5-2l1.2 1.3z" fill="${o}" stroke="${f}" stroke-width="1.3" stroke-linejoin="round"/>` },
        text: { hx: 12, hy: 12, svg: (f, o) => `<path d="M8.5 3.5h2.3l1.2 1 1.2-1h2.3v1.8h-1.6l-.9.8v11.8l.9.8h1.6v1.8h-2.3l-1.2-1-1.2 1H8.5v-1.8h1.6l.9-.8V6.1l-.9-.8H8.5z" fill="${f}" stroke="${o}" stroke-width="1" stroke-linejoin="round"/>` },
        ns: { hx: 12, hy: 12, svg: (f, o) => `<path d="M12 2.5l4.6 5.2h-3v8.6h3L12 21.5l-4.6-5.2h3V7.7h-3z" fill="${f}" stroke="${o}" stroke-width="1.3" stroke-linejoin="round"/>` },
        ew: { hx: 12, hy: 12, rot: 90 }, nwse: { hx: 12, hy: 12, rot: -45 }, nesw: { hx: 12, hy: 12, rot: 45 },
    };
    function cursorURL(name, scale) {
        const c = CURSORS[name], base = c.rot != null ? CURSORS.ns : c, px = Math.round(24 * scale);
        const inner = base.svg(S.cursorFill, S.cursorOutline);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24"><g style="filter:drop-shadow(0 .6px .8px rgba(0,0,0,.35))" ${c.rot != null ? `transform="rotate(${c.rot} 12 12)"` : ''}>${inner}</g></svg>`;
        const fallback = { default: 'default', pointer: 'pointer', text: 'text', ns: 'ns-resize', ew: 'ew-resize', nwse: 'nwse-resize', nesw: 'nesw-resize' }[name];
        return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${Math.round(c.hx * scale)} ${Math.round(c.hy * scale)}, ${fallback}`;
    }
    function applyCursors(scale = +S.cursorSize || 1) {
        const root = document.documentElement;
        root.classList.toggle('cur-mac', S.cursorStyle === 'mac');
        if (S.cursorStyle !== 'mac') return;
        scale = Math.min(scale, 5);  // i browser accettano puntatori fino a 128 px
        Object.keys(CURSORS).forEach(n => root.style.setProperty('--cur-' + n, cursorURL(n, scale)));
    }
    let settingsTimer = null, settingsPending = {};
    function setSetting(k, v) {
        S[k] = v; settingsPending[k] = v; applySettings();
        clearTimeout(settingsTimer);
        settingsTimer = setTimeout(async () => {
            const body = settingsPending; settingsPending = {};
            try { Object.assign(S, await api('PUT', '/settings', body)); } catch (e) { toast('Impostazione non salvata: ' + e.message); }
        }, 400);
    }
    mq.addEventListener('change', applySettings);
    applySettings();

    /* ---------- App ---------- */
    const APPS = {
        finder:     { name: 'Finder',       icon: 'finder',   w: 760, h: 460, render: finder },
        notes:      { name: 'Note',         icon: 'notes',    w: 700, h: 460, render: notes },
        calculator: { name: 'Calcolatrice', icon: 'calc',     w: 250, h: 390, render: calculator, fixed: true },
        webx:       { name: 'webX',         icon: 'webx',     w: 1120, h: 720, render: webx },
        calendar:   { name: 'Calendario',   icon: 'calendar', w: 380, h: 400, render: calendar },
        settings:   { name: 'Impostazioni', icon: 'settings', w: 820, h: 600, render: settings },
        about:      { name: 'Info su MarX', icon: 'disk',     w: 340, h: 330, render: about, fixed: true },
        trash:      { name: 'Cestino',      icon: 'trash',    special: true },
        launchpad:  { name: 'Launchpad',    icon: 'launchpad', special: true },
        appstore:   { name: 'Soft Store',    icon: 'appstore', w: 980, h: 620, render: appstore, admin: true },
        activity:   { name: 'Monitoraggio Attività', icon: 'activity', w: 760, h: 560, render: activity, admin: true },
    };
    if (!MARX.user.is_admin) Object.keys(APPS).forEach(k => APPS[k].admin && delete APPS[k]);
    // Icona di un'app: disegnata in CSS, oppure immagine per le app installate dal Soft Store
    const icoHTML = a => a.iconUrl ? `<span class="ico ico-web"><img src="${esc(a.iconUrl)}" alt="" loading="lazy"></span>` : `<span class="ico ico-${a.icon}"></span>`;

    const wins = new Map(); // appId -> elemento finestra
    let z = 10, active = null;

    /* ---------- Sessione: finestre aperte ritrovate dopo un aggiornamento della pagina ---------- */
    let restoring = false;
    // Scrivanie multiple (Spaces): ogni finestra appartiene a una scrivania
    let spaces = store.get('spaces', { count: 1, current: 0 });
    const winSpace = w => +(w.dataset.space || 0);
    const inSpace = w => winSpace(w) === spaces.current;
    function saveSession() {
        if (restoring) return;
        const list = [...wins.entries()]
            .filter(([k]) => APPS[k] && !APPS[k].hidden)           // anteprime e log non si riaprono
            .sort((a, b) => (+a[1].style.zIndex || 0) - (+b[1].style.zIndex || 0))
            .map(([k, w]) => ({ id: k, min: w.hidden, max: w.classList.contains('maximized'), prev: w.dataset.prev || null, space: winSpace(w),
                geo: { l: w.style.left, t: w.style.top, w: w.style.width, h: w.style.height } }));
        store.set('session', { list, active });
        store.set('spaces', spaces);
    }
    function restoreSession() {
        const sess = store.get('session', null);
        if (!sess?.list?.length) return;
        restoring = true;
        try {
            for (const it of sess.list) {
                if (!APPS[it.id] || APPS[it.id].special) continue;   // app disinstallata o non più disponibile
                open(it.id);
                const w = wins.get(it.id); if (!w) continue;
                w.dataset.space = Math.min(it.space || 0, spaces.count - 1);
                if (it.geo && !it.max) Object.assign(w.style, { left: it.geo.l, top: it.geo.t, width: it.geo.w, height: it.geo.h });
                if (it.max && !APPS[it.id].fixed) {
                    maximize(it.id);
                    if (it.prev) w.dataset.prev = it.prev;            // ripristino la misura "normale" di prima
                }
                if (it.min) w.hidden = true;
            }
            applySpaces();
            const top = sess.active && wins.get(sess.active);
            if (top && !top.hidden && inSpace(top)) focus(sess.active); else focusTop();
        } finally { restoring = false; }
        layoutStage();
        saveSession();
    }
    addEventListener('beforeunload', saveSession);

    function open(id) {
        if (id === 'launchpad') return launchpad();
        if (id === 'trash') { open('finder'); return ctlOf('finder').go?.('trash'); }
        const app = APPS[id]; if (!app) return;
        let w = wins.get(id);
        if (w) {
            if (!inSpace(w)) switchSpace(winSpace(w));
            const was = w.hidden; w.hidden = false; focus(id); if (was) genie(w, id, true); saveSession(); return;
        }
        const dockBtn = document.querySelector(`.dock-item[data-open="${id}"]`);
        if (!restoring) { dockBtn?.classList.add('bounce'); setTimeout(() => dockBtn?.classList.remove('bounce'), 1200); }

        const saved = store.get('win.' + id, null);
        const W = Math.min(app.w, innerWidth - 20), H = Math.min(app.h, innerHeight - 120);
        const n = wins.size;
        w = document.createElement('section');
        w.className = 'window';
        w.style.width = (saved?.w ?? W) + 'px';
        w.style.height = (saved?.h ?? H) + 'px';
        w.style.left = (saved?.x ?? Math.max(10, (innerWidth - W) / 2 + n * 26 - 60)) + 'px';
        w.style.top = (saved?.y ?? Math.max(10, (innerHeight - H) / 2 - 60 + n * 26)) + 'px';
        w.innerHTML = `
            <div class="titlebar">
                <div class="lights">
                    <button class="l-close" aria-label="Chiudi"></button>
                    <button class="l-min" aria-label="Riduci"></button>
                    <button class="l-max" aria-label="Ingrandisci"></button>
                </div>
                <div class="title">${esc(app.name)}</div>
            </div>
            <div class="win-body"></div>
            ${app.fixed ? '' : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(d => `<div class="rz rz-${d}" data-dir="${d}"></div>`).join('')}`;
        w.dataset.space = spaces.current;
        $('#windows').append(w);
        wins.set(id, w);
        // Ogni app restituisce un "controller": { menus(), prefs(), context(e) }
        w.ctl = app.render($('.win-body', w), w) || {};

        $('.l-close', w).onclick = e => { e.stopPropagation(); close(id); };
        $('.l-min', w).onclick = e => { e.stopPropagation(); minimize(id); };
        $('.l-max', w).onclick = e => { e.stopPropagation(); if (!app.fixed) maximize(id); };
        $('.titlebar', w).ondblclick = e => {
            if (e.target.closest('.lights')) return;
            if (S.titlebarDoubleClick === 'minimize') minimize(id);
            else if (S.titlebarDoubleClick === 'maximize' && !app.fixed) maximize(id);
        };
        w.addEventListener('pointerdown', () => focus(id));
        drag(w, $('.titlebar', w), id);
        if (!app.fixed) w.querySelectorAll('.rz').forEach(h => resize(w, h, id));
        focus(id);
        updateDock();
        saveSession();
        if (!restoring && !reduceMotion() && w.animate) {
            const r = w.getBoundingClientRect(), d = dockRect(id);
            w.animate([
                { transform: `translate(${d.left + d.width / 2 - (r.left + r.width / 2)}px, ${d.top + d.height / 2 - (r.top + r.height / 2)}px) scale(${d.width / r.width})`, opacity: 0 },
                { transform: 'none', opacity: 1 },
            ], { duration: 380, easing: 'cubic-bezier(.2,.9,.25,1.05)' });
        }
    }

    function close(id) {
        const w = wins.get(id); if (!w) return;
        if (w.animate && !reduceMotion()) w.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.94)', opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
        else w.classList.add('closing');
        setTimeout(() => { w.remove(); wins.delete(id); mru = mru.filter(x => x !== id); if (active === id) { active = null; focusTop(); } updateDock(); saveSession(); layoutStage(); }, 150);
    }
    // Rettangolo dell'icona nel Dock a cui "risucchiare" o da cui far nascere la finestra
    const dockRect = id => (document.querySelector(`.dock-item[data-open="${id}"]`) || document.querySelector('.dock-item[data-open="finder"]')).getBoundingClientRect();
    const reduceMotion = () => S.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Effetto Genio: la finestra si stringe verso il basso e scivola nell'icona del Dock
    function genie(w, id, reverse = false) {
        if (reduceMotion() || !w.animate) return Promise.resolve();
        const r = w.getBoundingClientRect(), d = dockRect(id);
        const dx = d.left + d.width / 2 - (r.left + r.width / 2), dy = d.top + d.height / 2 - (r.top + r.height / 2);
        const sx = d.width / r.width, sy = d.height / r.height;
        const frames = [
            { transform: 'none', clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', opacity: 1, offset: 0 },
            { transform: `translate(${dx * .15}px, ${dy * .35}px) scale(${.85}, ${.9})`, clipPath: 'polygon(0 0, 100% 0, 70% 100%, 30% 100%)', opacity: 1, offset: .35 },
            { transform: `translate(${dx * .7}px, ${dy * .8}px) scale(${Math.max(sx, .2)}, ${Math.max(sy, .25)})`, clipPath: 'polygon(20% 0, 80% 0, 55% 100%, 45% 100%)', opacity: .9, offset: .75 },
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, clipPath: 'polygon(35% 0, 65% 0, 52% 100%, 48% 100%)', opacity: 0, offset: 1 },
        ];
        const a = w.animate(reverse ? frames.slice().reverse().map(f => ({ ...f, offset: 1 - f.offset })) : frames,
            { duration: reverse ? 420 : 480, easing: reverse ? 'cubic-bezier(.2,.8,.3,1)' : 'cubic-bezier(.55,0,.75,.4)', fill: 'none' });
        return a.finished.catch(() => {});
    }
    function minimize(id) {
        const w = wins.get(id); if (!w || w.hidden || w.dataset.anim) return;
        w.dataset.anim = '1';
        genie(w, id).then(() => { w.hidden = true; delete w.dataset.anim; if (active === id) { active = null; focusTop(); } saveSession(); layoutStage(); });
    }
    function maximize(id) {
        const w = wins.get(id);
        if (w.classList.toggle('maximized')) {
            w.dataset.prev = JSON.stringify({ l: w.style.left, t: w.style.top, w: w.style.width, h: w.style.height });
            Object.assign(w.style, { left: '0px', top: '0px', width: innerWidth + 'px', height: (innerHeight - 26 - 80) + 'px' });
        } else {
            const p = JSON.parse(w.dataset.prev || '{}');
            Object.assign(w.style, { left: p.l, top: p.t, width: p.w, height: p.h });
        }
        saveSession();
    }
    function focus(id) {
        const w = wins.get(id); if (!w) return;
        w.style.zIndex = ++z; active = id;
        wins.forEach((el, k) => el.classList.toggle('inactive', k !== id));
        mru = [id, ...mru.filter(x => x !== id)];
        renderMenubar();
        saveSession();
        layoutStage();
    }
    function focusTop() {
        let top = null, tz = -1;
        wins.forEach((el, k) => { if (!el.hidden && inSpace(el) && +el.style.zIndex > tz) { tz = +el.style.zIndex; top = k; } });
        if (top) focus(top); else { active = null; renderMenubar(); layoutStage(); }
    }
    let mru = [];  // app usate di recente, la prima è quella attiva
    function updateDock() {
        const pins = store.get('dockPins', []);
        const ids = Object.keys(APPS).filter(k => APPS[k].web && (pins.includes(k) || wins.has(k)));
        const box = $('#dockApps');
        if (box) box.innerHTML = ids.map(k => `<button class="dock-item" data-open="${k}" data-label="${esc(APPS[k].name)}">${icoHTML(APPS[k])}</button>`).join('');
        document.querySelectorAll('.dock-item').forEach(b => b.classList.toggle('running', wins.has(b.dataset.open)));
    }
    function persist(w, id) {
        store.set('win.' + id, { x: parseInt(w.style.left), y: parseInt(w.style.top), w: parseInt(w.style.width), h: parseInt(w.style.height) });
    }
    function drag(w, handle, id) {
        handle.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.target.closest('.lights') || w.classList.contains('maximized') || document.body.classList.contains('mc')) return;
            let sx = e.clientX - w.offsetLeft, sy = e.clientY - w.offsetTop, zone = null, moved = false;
            dragging = true;
            const move = ev => {
                if (!moved && w.dataset.snapped && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 6) {
                    // Una finestra affiancata, trascinata via, torna alla sua misura di prima
                    const g = JSON.parse(w.dataset.presnap || 'null');
                    if (g) { const ratio = sx / w.offsetWidth; w.style.width = g.w; w.style.height = g.h; sx = w.offsetWidth * ratio; }
                    delete w.dataset.snapped; delete w.dataset.presnap;
                }
                moved = true;
                w.style.left = Math.min(innerWidth - 60, Math.max(-w.offsetWidth + 80, ev.clientX - sx)) + 'px';
                w.style.top = Math.min(innerHeight - 120, Math.max(0, ev.clientY - sy)) + 'px';
                zone = S.tiling && !APPS[id].fixed ? snapZone(ev.clientX, ev.clientY) : null;
                showSnap(zone);
            };
            const up = () => {
                removeEventListener('pointermove', move); removeEventListener('pointerup', up); dragging = false;
                showSnap(null);
                if (zone) snapTo(id, zone); else persist(w, id);
                saveSession();
            };
            addEventListener('pointermove', move); addEventListener('pointerup', up);
        });
    }
    let dragging = false;

    /* ---------- Affiancamento finestre ---------- */
    // Le finestre sono posizionate rispetto alla scrivania, che inizia sotto la barra dei menu
    const deskTop = () => $('#desktop').getBoundingClientRect().top;
    function workArea() {
        const top = 6, bottom = innerHeight - deskTop() - (S.dockAutohide ? 8 : S.dockSize + 26);
        return { x: 6, y: top, w: innerWidth - 12, h: bottom - top };
    }
    function snapZone(x, y) {
        const edge = 6, corner = 90;
        if (y <= 30 && x > corner && x < innerWidth - corner) return 'full';
        if (x <= edge) return y < 30 + corner ? 'tl' : y > innerHeight - corner ? 'bl' : 'left';
        if (x >= innerWidth - edge) return y < 30 + corner ? 'tr' : y > innerHeight - corner ? 'br' : 'right';
        return null;
    }
    function zoneRect(zone) {
        const a = workArea(), gap = 6, hw = (a.w - gap) / 2, hh = (a.h - gap) / 2;
        return {
            full: { x: a.x, y: a.y, w: a.w, h: a.h }, left: { x: a.x, y: a.y, w: hw, h: a.h }, right: { x: a.x + hw + gap, y: a.y, w: hw, h: a.h },
            tl: { x: a.x, y: a.y, w: hw, h: hh }, tr: { x: a.x + hw + gap, y: a.y, w: hw, h: hh },
            bl: { x: a.x, y: a.y + hh + gap, w: hw, h: hh }, br: { x: a.x + hw + gap, y: a.y + hh + gap, w: hw, h: hh },
            center: { x: (innerWidth - Math.min(a.w * .7, 1100)) / 2, y: a.y + a.h * .08, w: Math.min(a.w * .7, 1100), h: a.h * .84 },
        }[zone];
    }
    const snapEl = document.createElement('div'); snapEl.className = 'snap-preview'; snapEl.hidden = true; document.body.append(snapEl);
    function showSnap(zone) {
        if (!zone) { snapEl.hidden = true; return; }
        const r = zoneRect(zone);
        Object.assign(snapEl.style, { left: r.x + 'px', top: r.y + deskTop() + 'px', width: r.w + 'px', height: r.h + 'px' });
        snapEl.hidden = false;
    }
    function snapTo(id, zone) {
        const w = wins.get(id); if (!w || APPS[id].fixed) return;
        if (w.classList.contains('maximized')) maximize(id);
        if (!w.dataset.snapped) w.dataset.presnap = JSON.stringify({ w: w.style.width, h: w.style.height });
        const r = zoneRect(zone);
        const anim = !reduceMotion() && w.animate ? w.animate([{ left: w.style.left, top: w.style.top, width: w.style.width, height: w.style.height },
            { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.3,1)' }) : null;
        Object.assign(w.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        if (zone === 'center') { delete w.dataset.snapped; delete w.dataset.presnap; } else w.dataset.snapped = zone;
        persist(w, id); saveSession();
    }
    // Ridimensionamento da bordi e angoli: dir contiene n/s/e/w
    const MIN_W = 320, MIN_H = 200;
    function resize(w, handle, id) {
        handle.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            focus(id);
            const dir = handle.dataset.dir;
            if (w.classList.contains('maximized')) w.classList.remove('maximized');
            const sx = e.clientX, sy = e.clientY;
            const r = { x: w.offsetLeft, y: w.offsetTop, w: w.offsetWidth, h: w.offsetHeight };
            const maxH = innerHeight - 26;
            document.body.classList.add('resizing'); document.body.style.cursor = getComputedStyle(handle).cursor;
            const move = ev => {
                const dx = ev.clientX - sx, dy = ev.clientY - sy;
                if (dir.includes('e')) w.style.width = Math.max(MIN_W, Math.min(innerWidth - r.x, r.w + dx)) + 'px';
                if (dir.includes('s')) w.style.height = Math.max(MIN_H, Math.min(maxH - r.y, r.h + dy)) + 'px';
                if (dir.includes('w')) {
                    const nw = Math.max(MIN_W, r.w - dx);
                    w.style.width = nw + 'px'; w.style.left = (r.x + r.w - nw) + 'px';
                }
                if (dir.includes('n')) {
                    const nh = Math.max(MIN_H, Math.min(r.y + r.h, r.h - dy));
                    w.style.height = nh + 'px'; w.style.top = (r.y + r.h - nh) + 'px';
                }
            };
            const up = () => {
                removeEventListener('pointermove', move); removeEventListener('pointerup', up);
                document.body.classList.remove('resizing'); document.body.style.cursor = '';
                persist(w, id);
            };
            addEventListener('pointermove', move); addEventListener('pointerup', up);
        });
    }

    /* ---------- Contenuto delle app ---------- */
    /* ---------- File: tipi, tag, Quick Look ---------- */
    const TAGS = { red: ['Rosso', '#ff3b30'], orange: ['Arancione', '#ff9500'], yellow: ['Giallo', '#ffcc00'], green: ['Verde', '#34c759'], blue: ['Blu', '#0a84ff'], purple: ['Viola', '#af52de'], gray: ['Grigio', '#8e8e93'] };
    const EXT = {
        img: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'], pdf: ['pdf'], video: ['mp4', 'webm', 'mov', 'm4v', 'ogv'],
        audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'], zip: ['zip'], archive: ['rar', '7z', 'tar', 'gz', 'tgz', 'bz2'],
        text: ['txt', 'md', 'csv', 'json', 'js', 'ts', 'css', 'html', 'htm', 'php', 'py', 'xml', 'yml', 'yaml', 'log', 'sh', 'sql', 'ini', 'env', 'conf', 'c', 'h', 'java', 'rb', 'go', 'rs', 'vue', 'svelte'],
        sheet: ['xls', 'xlsx', 'ods', 'numbers'], slides: ['ppt', 'pptx', 'odp', 'key'], word: ['doc', 'docx', 'odt', 'rtf', 'pages'],
    };
    const KIND_INFO = {
        folder: ['Cartella', 'folder', 'Cartelle'], img: ['Immagine', 'img', 'Immagini'], pdf: ['Documento PDF', 'pdf', 'PDF'], video: ['Video', 'video', 'Video'],
        audio: ['Audio', 'audio', 'Audio'], zip: ['Archivio ZIP', 'zip', 'Archivi'], archive: ['Archivio', 'zip', 'Archivi'], text: ['Testo', 'doc', 'Testi e codice'],
        sheet: ['Foglio di calcolo', 'sheet', 'Fogli di calcolo'], slides: ['Presentazione', 'slides', 'Presentazioni'], word: ['Documento', 'word', 'Documenti'], other: ['Documento', 'doc', 'Altri file'],
    };
    function kindOf(name, type) {
        if (type === 'folder') return 'folder';
        const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
        return Object.keys(EXT).find(k => EXT[k].includes(ext)) || 'other';
    }
    const kindName = it => KIND_INFO[kindOf(it.name, it.type)][0];
    const fileIcon = it => `<span class="ico ico-${KIND_INFO[kindOf(it.name, it.type)][1]}"></span>`;
    const tagDots = tags => (tags || []).length ? `<span class="tagdots">${tags.map(c => `<i style="background:${TAGS[c]?.[1]}"></i>`).join('')}</span>` : '';
    const fileUrl = (p, inline) => '/files/download?path=' + encodeURIComponent(p) + (inline ? '&inline=1' : '');
    const fmtDate = t => t ? new Date(t * 1000).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const filesChanged = detail => window.dispatchEvent(new CustomEvent('marx:files', { detail }));
    function setTrashFull(n) { document.querySelector('.dock-item[data-open="trash"] .ico')?.classList.toggle('full', n > 0); }

    // Quick Look: anteprima veloce (barra spaziatrice). list: [{name, type, url, text}], frecce per scorrere.
    let ql = null;
    function quickLook(list, index = 0) {
        if (!list.length) return;
        if (ql) ql.el.remove();
        const el = document.createElement('div'); el.className = 'ql'; document.body.append(el);
        ql = { el, list, i: index };
        const close = () => { el.remove(); ql = null; removeEventListener('keydown', key, true); };
        const key = e => {
            if (e.key === ' ' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); ql.i = (ql.i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; show(); }
        };
        addEventListener('keydown', key, true);
        async function show() {
            const it = list[ql.i], k = kindOf(it.name, it.type);
            let content;
            if (k === 'img') content = `<img src="${esc(it.url)}" alt="${esc(it.name)}">`;
            else if (k === 'pdf') content = `<iframe src="${esc(it.url)}" title="${esc(it.name)}"></iframe>`;
            else if (k === 'video') content = `<video src="${esc(it.url)}" controls autoplay></video>`;
            else if (k === 'audio') content = `<div class="ql-audio">${fileIcon(it)}<audio src="${esc(it.url)}" controls autoplay></audio></div>`;
            else if (k === 'text' && it.text) content = '<pre class="ql-text">Caricamento…</pre>';
            else content = `<div class="ql-info">${fileIcon(it)}<b>${esc(it.name)}</b><span>${esc(kindName(it))}${it.size != null ? ' · ' + fmtSize(it.size) : ''}</span>${it.modified ? `<span>Modificato: ${fmtDate(it.modified)}</span>` : ''}</div>`;
            el.innerHTML = `<div class="ql-panel"><div class="ql-bar"><button data-ql="close" aria-label="Chiudi">×</button><span>${esc(it.name)}</span>
                ${list.length > 1 ? `<small>${ql.i + 1} di ${list.length}</small>` : ''}${it.download ? `<a class="btn" href="${esc(it.download)}">Scarica</a>` : ''}</div><div class="ql-body">${content}</div></div>`;
            $('[data-ql=close]', el).onclick = close;
            if (k === 'text' && it.text) {
                try {
                    const r = await fetch(it.text, { credentials: 'same-origin' }); const txt = await r.text();
                    const pre = $('.ql-text', el); if (pre) pre.textContent = txt + (r.headers.get('X-Truncated') === '1' ? '\n\n… (anteprima dei primi 200 KB)' : '');
                } catch { const pre = $('.ql-text', el); if (pre) pre.textContent = 'Anteprima non disponibile.'; }
            }
        }
        el.addEventListener('pointerdown', e => { if (e.target === el) close(); });
        show();
    }
    const qlItem = (it, p) => ({ ...it, url: fileUrl(p, true), text: kindOf(it.name, it.type) === 'text' ? '/files/text?path=' + encodeURIComponent(p) : null, download: it.type === 'file' ? fileUrl(p) : null });

    // Trascinamento interno: i dati viaggiano come elenco di percorsi
    const DRAG_TYPE = 'application/x-marx-files';
    async function dropFiles(e, target) {
        // target: { path } cartella di destinazione oppure { trash: true }
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        try {
            if (raw) {
                const { paths } = JSON.parse(raw);
                if (target.trash) { const r = await api('DELETE', '/files', { paths }); playSound('trash'); setTrashFull(r.trash); }
                else { const r = await api('POST', '/files/move', { paths, to: target.path }); if (!r.moved.length) return; }
            } else if (e.dataTransfer.files?.length && !target.trash) {
                const fd = new FormData(); fd.append('path', target.path);
                [...e.dataTransfer.files].forEach(f => fd.append('files[]', f));
                const r = await api('POST', '/files/upload', fd); toast(`Caricati: ${r.saved.join(', ')}`, { app: 'Finder' });
            } else return;
            filesChanged();
        } catch (err) { toast(err.message, { app: 'Finder' }); }
    }
    const acceptsDrop = e => [...(e.dataTransfer?.types || [])].some(t => t === DRAG_TYPE || t === 'Files');

    // Azioni comuni sui file (Finder e scrivania)
    async function shareLink(win, p, name) {
        const r = await sheet(win, { title: `Condividi «${name}»`, ok: 'Crea link', text: 'Chiunque abbia il link potrà scaricarlo, anche senza un account MarX.', fields: [
            { type: 'select', name: 'days', label: 'Scadenza', value: '7', options: [['1', '1 giorno'], ['7', '7 giorni'], ['30', '30 giorni'], ['0', 'Nessuna scadenza']] },
            { name: 'password', label: 'Password (facoltativa)', type: 'password' }] });
        if (!r) return;
        try {
            const s = await api('POST', '/files/share', { path: p, days: r.days, password: r.password || null });
            await sheet(win, { title: 'Link creato', text: s.url + (s.protected ? '  —  protetto da password' : ''), ok: 'Copia link', cancel: false });
            navigator.clipboard?.writeText(s.url).then(() => toast('Link copiato negli appunti', { app: 'Finder' }), () => {});
        } catch (e) { toast(e.message, { app: 'Finder' }); }
    }
    async function shareUser(win, p, name) {
        const r = await sheet(win, { title: `Condividi «${name}» con un utente`, ok: 'Condividi', text: 'L\'utente lo troverà in Finder › Condivisi con me (sola lettura).', fields: [{ name: 'email', label: 'Email dell\'utente MarX', type: 'email' }] });
        if (!r) return;
        try { const s = await api('POST', '/files/share-user', { path: p, email: r.email }); toast(`Condiviso con ${s.with.name}`, { app: 'Finder' }); } catch (e) { toast(e.message, { app: 'Finder' }); }
    }
    function tagMenu(paths, current, after) {
        return Object.entries(TAGS).map(([c, [label]]) => [check(current.includes(c), '● ' + label), async () => {
            const on = !current.includes(c);
            try { await Promise.all(paths.map(p => api('POST', '/files/tags', { path: p, color: c, on }))); filesChanged(); after?.(); } catch (e) { toast(e.message); }
        }]);
    }

    /* Finder: file reali dell'utente sul server */
    function finder(body, win) {
        let loc = 'files', path = '', items = [], sel = new Set(), anchor = null, hist = [{ loc: 'files', path: '' }], hpos = 0, trashCount = 0;
        let P = prefs('finder', { sort: 'name', dir: 1, sizes: true, foldersFirst: true, view: 'icons' });
        const colCache = {};
        const LOC_TITLE = { trash: 'Cestino', shared: 'Condivisi con me', links: 'Link condivisi' };
        const editable = () => loc === 'files' || loc.startsWith('tag:');
        const full = it => it.path ?? (path ? path + '/' + it.name : it.name);
        const selItems = () => items.filter((_, i) => sel.has(i));
        const sorted = list => {
            const by = { name: (a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }), size: (a, b) => (a.size ?? -1) - (b.size ?? -1),
                date: (a, b) => (a.modified ?? 0) - (b.modified ?? 0), kind: (a, b) => kindName(a).localeCompare(kindName(b), 'it') }[P.sort] || ((a, b) => 0);
            return [...list].sort((a, b) => (P.foldersFirst && a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : by(a, b) * P.dir));
        };
        const setPref = (k, v) => { P = { ...P, [k]: v }; savePrefs('finder', P); items = sorted(items); sel.clear(); draw(); };

        body.innerHTML = `<div class="finder fx">
            <aside class="sidebar fx-side">
                <h4>Preferiti</h4>
                <button data-go="files:" data-drop-path=""><span class="fx-si"><span class="ico ico-folder"></span></span>I miei file</button>
                <button data-go="files:Scrivania" data-drop-path="Scrivania"><span class="fx-si"><span class="ico ico-desk"></span></span>Scrivania</button>
                <button data-go="shared:"><span class="fx-si"><span class="ico ico-shared"></span></span>Condivisi con me</button>
                <button data-go="links:"><span class="fx-si"><span class="ico ico-link"></span></span>Link condivisi</button>
                <h4>Posizioni</h4>
                <button data-go="trash:" data-drop-trash><span class="fx-si"><span class="ico ico-trash"></span></span>Cestino <small class="fx-count"></small></button>
                <h4>Tag</h4>
                ${Object.entries(TAGS).map(([c, [l, col]]) => `<button data-go="tag:${c}:"><span class="fx-si"><i class="fx-tag" style="background:${col}"></i></span>${l}</button>`).join('')}
            </aside>
            <div class="finder-main">
                <div class="toolbar">
                    <button data-nav="-1" aria-label="Indietro">‹</button><button data-nav="1" aria-label="Avanti">›</button>
                    <div class="crumbs"></div>
                    <div class="seg fx-views">${[['icons', '▦', 'Icone'], ['list', '☰', 'Elenco'], ['columns', '⫴', 'Colonne']].map(([v, g, l]) => `<button data-view="${v}" title="${l}" aria-label="Vista ${l}">${g}</button>`).join('')}</div>
                    <button data-act="mkdir" title="Nuova cartella">＋ Cartella</button>
                    <button data-act="upload" title="Carica file">⇪ Carica</button>
                    <button data-act="empty" title="Svuota il Cestino">Svuota</button>
                    <input type="file" multiple hidden>
                </div>
                <div class="fview" tabindex="0"></div>
                <div class="statusbar"></div>
            </div></div>`;
        const view = $('.fview', body), crumbs = $('.crumbs', body), statusbar = $('.statusbar', body), picker = $('input[type=file]', body);

        async function load(l = loc, p = path, push = true) {
            try {
                let list;
                if (l === 'files') { const d = await api('GET', '/files?path=' + encodeURIComponent(p)); list = d.items; trashCount = d.trash; colCache[p] = d.items; }
                else if (l === 'trash') list = (await api('GET', '/files/trash')).map(t => ({ ...t, modified: t.deleted })), trashCount = list.length;
                else if (l === 'shared') list = (await api('GET', '/files/shared-with-me')).map(s => ({ ...s, modified: s.created }));
                else if (l === 'links') list = (await api('GET', '/files/shares')).map(s => ({ ...s, modified: s.created }));
                else if (l.startsWith('tag:')) list = await api('GET', '/files/tagged?color=' + l.slice(4));
                loc = l; path = l === 'files' ? p : ''; items = sorted(list); sel.clear(); anchor = null;
                if (push && (hist[hpos].loc !== loc || hist[hpos].path !== path)) { hist = hist.slice(0, hpos + 1); hist.push({ loc, path }); hpos = hist.length - 1; }
                if (loc === 'files') store.set('finder.path', path);
                setTrashFull(trashCount);
                draw();
            } catch (e) { if (l === 'files' && p) return load('files', '', false); toast(e.message, { app: 'Finder' }); }
        }
        const go = (l, p = '') => load(l, p);

        function drawCrumbs() {
            if (loc === 'files') {
                const segs = path ? path.split('/') : [];
                crumbs.innerHTML = `<button data-go="files:" data-drop-path="">I miei file</button>` + segs.map((s, i) => `<span>›</span><button data-go="files:${esc(segs.slice(0, i + 1).join('/'))}" data-drop-path="${esc(segs.slice(0, i + 1).join('/'))}">${esc(s)}</button>`).join('');
            } else crumbs.innerHTML = `<b>${esc(loc.startsWith('tag:') ? 'Tag ' + TAGS[loc.slice(4)][0].toLowerCase() : LOC_TITLE[loc])}</b>`;
        }
        function itemHTML(it, i) {
            const k = kindOf(it.name, it.type);
            const thumb = (loc === 'files' || loc.startsWith('tag:')) && k === 'img' && it.size < 8e6 ? `<span class="ico ico-thumb"><img src="${esc(fileUrl(full(it), true))}" alt="" loading="lazy"></span>` : fileIcon(it);
            const drag = editable() ? 'draggable="true"' : '';
            const dropDir = editable() && it.type === 'folder' ? `data-drop-path="${esc(full(it))}"` : '';
            if (P.view === 'list' || (P.view === 'columns' && loc !== 'files')) {
                const cols = loc === 'trash' ? [esc(it.from), fmtDate(it.deleted), it.size != null ? fmtSize(it.size) : '—']
                    : loc === 'links' ? [it.url ? 'Link pubblico' + (it.protected ? ' 🔒' : '') : 'Con ' + esc(it.with?.name || ''), it.expires ? (it.expired ? 'Scaduto' : 'Fino al ' + new Date(it.expires * 1000).toLocaleDateString('it-IT')) : 'Nessuna scadenza', (it.downloads || 0) + ' download']
                    : loc === 'shared' ? ['Da ' + esc(it.from), fmtDate(it.modified), it.size != null ? fmtSize(it.size) : '—']
                    : [fmtDate(it.modified), it.size != null ? fmtSize(it.size) : '—', esc(kindName(it))];
                return `<div class="frow ${sel.has(i) ? 'sel' : ''}" data-i="${i}" ${drag} ${dropDir}><span class="frow-name">${fileIcon(it)}<span>${esc(it.name)}</span>${tagDots(it.tags)}</span>${cols.map(c => `<span>${c}</span>`).join('')}</div>`;
            }
            return `<div class="file ${sel.has(i) ? 'sel' : ''}" data-i="${i}" title="${esc(it.name)}" tabindex="-1" ${drag} ${dropDir}>${thumb}<span class="fname">${esc(it.name)}</span>${tagDots(it.tags)}${P.sizes && it.size != null && loc === 'files' ? `<small>${fmtSize(it.size)}</small>` : ''}</div>`;
        }
        function listHead() {
            const H = loc === 'trash' ? [['name', 'Nome'], [null, 'Posizione originale'], ['date', 'Eliminato'], ['size', 'Dimensione']]
                : loc === 'links' ? [['name', 'Nome'], [null, 'Tipo'], [null, 'Scadenza'], [null, 'Download']]
                : loc === 'shared' ? [['name', 'Nome'], [null, 'Proprietario'], ['date', 'Condiviso'], ['size', 'Dimensione']]
                : [['name', 'Nome'], ['date', 'Data di modifica'], ['size', 'Dimensione'], ['kind', 'Tipo']];
            return `<div class="frow fhead">${H.map(([k, l]) => `<span ${k ? `data-sort="${k}"` : ''} class="${P.sort === k ? 'on' : ''}">${l}${P.sort === k ? (P.dir > 0 ? ' ▲' : ' ▼') : ''}</span>`).join('')}</div>`;
        }
        async function drawColumns() {
            const segs = path ? path.split('/') : [];
            const dirs = ['', ...segs.map((_, i) => segs.slice(0, i + 1).join('/'))];
            for (const d of dirs) if (!colCache[d]) { try { colCache[d] = (await api('GET', '/files?path=' + encodeURIComponent(d))).items; } catch { colCache[d] = []; } }
            const cols = dirs.map((d, ci) => {
                const list = ci === dirs.length - 1 ? items : sorted(colCache[d]);
                const open = segs[ci];
                return `<div class="fcol" data-col="${esc(d)}" data-drop-path="${esc(d)}">${list.map((it, i) => {
                    const isCur = ci === dirs.length - 1;
                    const p = d ? d + '/' + it.name : it.name;
                    return `<div class="fcrow ${isCur && sel.has(i) ? 'sel' : ''} ${!isCur && it.name === open ? 'open' : ''}" ${isCur ? `data-i="${i}"` : `data-colgo="${esc(p)}" data-coltype="${it.type}"`} draggable="true" ${it.type === 'folder' ? `data-drop-path="${esc(p)}"` : ''}>
                        ${fileIcon(it)}<span>${esc(it.name)}</span>${tagDots(it.tags)}${it.type === 'folder' ? '<b>›</b>' : ''}</div>`;
                }).join('') || '<p class="fcol-empty">Cartella vuota</p>'}</div>`;
            });
            const one = sel.size === 1 ? items[[...sel][0]] : null;
            let prev = '';
            if (one && one.type === 'file') {
                const k = kindOf(one.name, one.type);
                prev = `<div class="fcol fprev">${k === 'img' ? `<img src="${esc(fileUrl(full(one), true))}" alt="">` : fileIcon(one)}<b>${esc(one.name)}</b><span>${esc(kindName(one))} · ${fmtSize(one.size)}</span><span>${fmtDate(one.modified)}</span></div>`;
            }
            view.innerHTML = `<div class="fcols">${cols.join('')}${prev}</div>`;
            view.querySelector('.fcols').scrollLeft = 1e6;
        }
        function draw() {
            drawCrumbs();
            const v = loc === 'files' ? P.view : P.view === 'icons' ? 'icons' : 'list';
            body.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === P.view));
            body.querySelectorAll('.fx-side [data-go]').forEach(b => b.classList.toggle('active', b.dataset.go === `${loc}:${loc === 'files' ? path : ''}` || (loc.startsWith('tag:') && b.dataset.go === loc + ':')));
            $('.fx-count', body).textContent = trashCount || '';
            $('[data-act=mkdir]', body).hidden = $('[data-act=upload]', body).hidden = loc !== 'files';
            $('[data-act=empty]', body).hidden = loc !== 'trash' || !items.length;
            $('[data-nav="-1"]', body).disabled = hpos === 0;
            $('[data-nav="1"]', body).disabled = hpos >= hist.length - 1;
            $('.titlebar .title', win).textContent = loc === 'files' ? (path.split('/').pop() || 'I miei file') : crumbs.textContent;
            view.className = 'fview v-' + v;
            if (v === 'columns') drawColumns();
            else if (!items.length) view.innerHTML = `<div class="empty">${{ trash: 'Il Cestino è vuoto', shared: 'Nessuno ha ancora condiviso file con te.', links: 'Non hai link condivisi.<br>Tasto destro su un file › Condividi link.' }[loc] || (loc.startsWith('tag:') ? 'Nessun file con questo tag.' : 'Cartella vuota.<br>Trascina qui dei file o usa «Carica».')}</div>`;
            else view.innerHTML = v === 'list' ? listHead() + items.map(itemHTML).join('') : items.map(itemHTML).join('');
            statusbar.textContent = `${items.length} elementi` + (sel.size ? ` · ${sel.size} selezionati` : '') + (loc === 'trash' && items.length ? ' · eliminati definitivamente dopo 30 giorni' : '');
        }
        function updateSel() {
            view.querySelectorAll('[data-i]').forEach(el => el.classList.toggle('sel', sel.has(+el.dataset.i)));
            statusbar.textContent = `${items.length} elementi` + (sel.size ? ` · ${sel.size} selezionati` : '');
            if (P.view === 'columns' && loc === 'files') drawColumns();
        }
        function select(i, e) {
            if (e?.metaKey || e?.ctrlKey) { sel.has(i) ? sel.delete(i) : sel.add(i); anchor = i; }
            else if (e?.shiftKey && anchor != null) { sel.clear(); for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) sel.add(k); }
            else { sel = new Set([i]); anchor = i; }
            updateSel();
        }

        async function openItem(it) {
            if (loc === 'trash') return toast('Per aprirlo, prima ripristinalo dal Cestino', { app: 'Finder' });
            if (loc === 'links') return it.url ? window.open(it.url, '_blank', 'noopener') : null;
            if (loc === 'shared') return quickLook([{ ...it, url: `/files/shared/${it.id}/download?inline=1`, download: `/files/shared/${it.id}/download` }]);
            if (it.type === 'folder') return load('files', full(it));
            const k = kindOf(it.name, it.type);
            if (k === 'zip') return unzip(it);
            if (k === 'img' || k === 'pdf') return openPreview(it.name, fileUrl(full(it), true), k);
            if (['video', 'audio', 'text'].includes(k)) return quickLook([qlItem(it, full(it))]);
            location.href = fileUrl(full(it));
        }
        function look() {
            let list = sel.size ? selItems() : [], start = 0;
            if (!list.length) return;
            if (list.length === 1 && editable()) {
                const files = items.filter(x => x.type === 'file');
                start = Math.max(0, files.indexOf(list[0])); if (files.length) list = files;
                return quickLook(list.map(it => qlItem(it, full(it))), start);
            }
            if (loc === 'shared') return quickLook(list.map(it => ({ ...it, url: `/files/shared/${it.id}/download?inline=1`, download: `/files/shared/${it.id}/download` })));
            if (editable()) quickLook(list.map(it => qlItem(it, full(it))));
        }
        async function mkdir() {
            const r = await sheet(win, { title: 'Nuova cartella', fields: [{ name: 'name', label: 'Nome', value: 'Cartella senza titolo' }], ok: 'Crea' });
            if (!r) return;
            try { await api('POST', '/files/folder', { path, name: r.name }); filesChanged(); } catch (e) { toast(e.message, { app: 'Finder' }); }
        }
        async function upload(fileList) {
            if (!fileList.length) return;
            const fd = new FormData(); fd.append('path', path);
            [...fileList].forEach(f => fd.append('files[]', f));
            statusbar.textContent = `Caricamento di ${fileList.length} file…`;
            try { const r = await api('POST', '/files/upload', fd); toast(`Caricati: ${r.saved.join(', ')}`, { app: 'Finder' }); } catch (e) { toast(e.message, { app: 'Finder' }); }
            filesChanged();
        }
        async function rename(it) {
            const r = await sheet(win, { title: 'Rinomina', fields: [{ name: 'name', label: 'Nuovo nome', value: it.name }], ok: 'Rinomina' });
            if (!r || r.name === it.name) return;
            try { await api('POST', '/files/rename', { path: full(it), name: r.name }); filesChanged(); } catch (e) { toast(e.message, { app: 'Finder' }); }
        }
        async function trashSel(list = selItems()) {
            if (!list.length) return;
            try { const r = await api('DELETE', '/files', { paths: list.map(full) }); playSound('trash'); setTrashFull(r.trash); filesChanged(); } catch (e) { toast(e.message, { app: 'Finder' }); }
        }
        async function duplicate(it) { try { await api('POST', '/files/duplicate', { path: full(it) }); filesChanged(); } catch (e) { toast(e.message, { app: 'Finder' }); } }
        async function compress(list = selItems()) {
            try { const r = await api('POST', '/files/zip', { paths: list.map(full), dir: path }); toast(`Creato ${r.name}`, { app: 'Finder' }); filesChanged(); } catch (e) { toast(e.message, { app: 'Finder' }); }
        }
        async function unzip(it) {
            try { const r = await api('POST', '/files/unzip', { path: full(it) }); toast(`Estratto in «${r.folder}»`, { app: 'Finder' }); filesChanged(); } catch (e) { toast(e.message, { app: 'Finder' }); }
        }
        async function restore(list = selItems()) {
            try { const r = await api('POST', '/files/trash/restore', { ids: list.map(x => x.id) }); toast(r.restored.length === 1 ? `Ripristinato in ${r.restored[0]}` : `${r.restored.length} elementi ripristinati`, { app: 'Finder' }); filesChanged(); } catch (e) { toast(e.message, { app: 'Finder' }); }
        }
        async function purge(list) {
            const all = !list;
            const ok = await sheet(win, { title: all ? 'Svuotare il Cestino?' : `Eliminare definitivamente ${list.length === 1 ? '«' + list[0].name + '»' : list.length + ' elementi'}?`, text: 'Non si può annullare.', ok: all ? 'Svuota' : 'Elimina', danger: true });
            if (!ok) return;
            try { const r = await api('DELETE', '/files/trash', all ? {} : { ids: list.map(x => x.id) }); playSound('trash'); setTrashFull(r.trash); filesChanged(); } catch (e) { toast(e.message, { app: 'Finder' }); }
        }
        async function revoke(it) {
            const ok = await sheet(win, { title: 'Revocare la condivisione?', text: it.url ? 'Il link smetterà di funzionare per tutti.' : `${it.with?.name} non vedrà più «${it.name}».`, ok: 'Revoca', danger: true });
            if (ok) try { await api('DELETE', `/files/shares/${it.id}`); load(); } catch (e) { toast(e.message, { app: 'Finder' }); }
        }

        function itemMenu(it) {
            const many = sel.size > 1 ? selItems() : [it];
            if (loc === 'trash') return [['Ripristina', () => restore(many)], ['Elimina definitivamente…', () => purge(many)], '-', ['Svuota il Cestino…', () => purge()]];
            if (loc === 'links') return [['Copia link', it.url && (() => navigator.clipboard?.writeText(it.url).then(() => toast('Link copiato', { app: 'Finder' })))], ['Apri link', it.url && (() => window.open(it.url, '_blank', 'noopener'))], '-', ['Revoca…', () => revoke(it)]];
            if (loc === 'shared') return [['Quick Look', look, 'Spazio'], ['Scarica', () => { location.href = `/files/shared/${it.id}/download`; }]];
            const k = kindOf(it.name, it.type), allTags = [...new Set(many.flatMap(x => x.tags || []))];
            if (many.length > 1) return [['Quick Look', look, 'Spazio'], ['Comprimi ' + many.length + ' elementi', () => compress(many)], '-', ...tagMenu(many.map(full), allTags), '-', ['Sposta nel Cestino', () => trashSel(many), 'Canc']];
            return [
                ['Apri', () => openItem(it), '↵'], ['Quick Look', look, 'Spazio'], '-',
                ['Rinomina…', () => rename(it), 'F2'], ['Duplica', () => duplicate(it)], ['Comprimi «' + it.name + '»', () => compress([it])], ...(k === 'zip' ? [['Estrai qui', () => unzip(it)]] : []),
                ...(it.type === 'file' ? [['Scarica', () => { location.href = fileUrl(full(it)); }]] : []), '-',
                ...tagMenu([full(it)], it.tags || []), '-',
                ['Condividi link…', () => shareLink(win, full(it), it.name)], ['Condividi con un utente…', () => shareUser(win, full(it), it.name)], '-',
                ['Sposta nel Cestino', () => trashSel([it]), 'Canc'],
            ];
        }
        const sortMenu = () => [['name', 'nome'], ['date', 'data di modifica'], ['size', 'dimensione'], ['kind', 'tipo']].map(([k, l]) => [check(P.sort === k, 'Ordina per ' + l), () => setPref('sort', k)]);
        const viewMenu = () => [['icons', 'Come icone'], ['list', 'Come elenco'], ['columns', 'Come colonne']].map(([k, l]) => [check(P.view === k, l), () => setPref('view', k)]);

        // --- eventi
        body.addEventListener('click', e => {
            const g = e.target.closest('[data-go]');
            if (g) { const [l, ...rest] = g.dataset.go.split(':'); return l === 'tag' ? load('tag:' + rest[0], '') : load(l, rest.join(':')); }
            const nav = e.target.closest('[data-nav]'); if (nav) { hpos += +nav.dataset.nav; const h = hist[hpos]; return load(h.loc, h.path, false); }
            const vw = e.target.closest('[data-view]'); if (vw) return setPref('view', vw.dataset.view);
            const so = e.target.closest('[data-sort]'); if (so) { P.sort === so.dataset.sort ? setPref('dir', -P.dir) : setPref('sort', so.dataset.sort); return; }
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'mkdir') return mkdir();
            if (act === 'upload') return picker.click();
            if (act === 'empty') return purge();
            const cg = e.target.closest('[data-colgo]');
            if (cg) { if (cg.dataset.coltype === 'folder') load('files', cg.dataset.colgo); return; }
            const f = e.target.closest('[data-i]');
            if (f) return select(+f.dataset.i, e);
            if (!e.target.closest('.fhead') && e.target.closest('.fview') && !rubberMoved) { sel.clear(); updateSel(); }
        });
        view.addEventListener('dblclick', e => { const f = e.target.closest('[data-i]'); if (f) openItem(items[+f.dataset.i]); });
        view.addEventListener('keydown', e => {
            if (e.key === ' ') { e.preventDefault(); return look(); }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(items.map((_, i) => i)); return updateSel(); }
            if (!sel.size) return;
            const it = items[[...sel][0]];
            if (e.key === 'Enter') openItem(it);
            if (e.key === 'F2' && editable()) rename(it);
            if ((e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) && editable()) trashSel();
            if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key) && !e.altKey && !e.ctrlKey) {
                e.preventDefault(); e.stopPropagation();
                const step = P.view === 'icons' ? (e.key === 'ArrowDown' || e.key === 'ArrowUp' ? Math.max(1, Math.floor(view.clientWidth / 106)) : 1) : 1;
                const cur = [...sel].pop(), next = Math.max(0, Math.min(items.length - 1, cur + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? step : -step)));
                select(next, e.shiftKey ? e : null);
                view.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' });
            }
        });
        view.addEventListener('contextmenu', e => {
            e.preventDefault();
            const f = e.target.closest('[data-i]');
            if (f) { const i = +f.dataset.i; if (!sel.has(i)) select(i); return contextMenu(e.clientX, e.clientY, itemMenu(items[i])); }
            contextMenu(e.clientX, e.clientY, loc === 'trash' ? [['Svuota il Cestino…', items.length && (() => purge())]]
                : loc === 'files' ? [['Nuova cartella', mkdir], ['Carica file…', () => picker.click()], '-', ...viewMenu(), '-', ...sortMenu(), '-', ['Aggiorna', () => load(loc, path, false)], ['Impostazioni Finder…', prefsSheet]]
                : [...viewMenu(), '-', ['Aggiorna', () => load(loc, path, false)]]);
        });
        // Selezione a riquadro (vista icone ed elenco)
        let rubberMoved = false;
        view.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.target.closest('[data-i], .fhead, .fcol') || P.view === 'columns' && loc === 'files') return;
            view.focus();
            const vr = view.getBoundingClientRect(), sx = e.clientX - vr.left + view.scrollLeft, sy = e.clientY - vr.top + view.scrollTop;
            const box = document.createElement('div'); box.className = 'rubber'; view.append(box); rubberMoved = false;
            const base = e.ctrlKey || e.metaKey ? new Set(sel) : new Set();
            const move = ev => {
                const x = ev.clientX - vr.left + view.scrollLeft, y = ev.clientY - vr.top + view.scrollTop;
                if (Math.hypot(x - sx, y - sy) > 4) rubberMoved = true;
                const l = Math.min(sx, x), t = Math.min(sy, y), w = Math.abs(x - sx), h = Math.abs(y - sy);
                Object.assign(box.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
                sel = new Set(base);
                view.querySelectorAll('[data-i]').forEach(el => {
                    const r = el.getBoundingClientRect(), ex = r.left - vr.left + view.scrollLeft, ey = r.top - vr.top + view.scrollTop;
                    if (ex < l + w && ex + r.width > l && ey < t + h && ey + r.height > t) sel.add(+el.dataset.i);
                });
                view.querySelectorAll('[data-i]').forEach(el => el.classList.toggle('sel', sel.has(+el.dataset.i)));
            };
            const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); box.remove(); updateSel(); setTimeout(() => { rubberMoved = false; }); };
            addEventListener('pointermove', move); addEventListener('pointerup', up);
        });
        // Trascinamento: dagli elementi verso cartelle, barra laterale, Cestino, scrivania
        body.addEventListener('dragstart', e => {
            const f = e.target.closest('[data-i], [data-colgo]'); if (!f) return;
            let paths;
            if (f.dataset.colgo) paths = [f.dataset.colgo];
            else { const i = +f.dataset.i; if (!sel.has(i)) select(i); paths = selItems().map(full); }
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ paths }));
            e.dataTransfer.effectAllowed = 'move';
        });
        body.addEventListener('dragover', e => {
            if (!acceptsDrop(e)) return;
            const t = e.target.closest('[data-drop-path], [data-drop-trash]') || (loc === 'files' ? view : null);
            if (!t) return;
            e.preventDefault();
            body.querySelectorAll('.drop').forEach(x => x !== t && x.classList.remove('drop'));
            t.classList.add('drop');
        });
        body.addEventListener('dragleave', e => { if (!body.contains(e.relatedTarget)) body.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); });
        body.addEventListener('drop', e => {
            const t = e.target.closest('[data-drop-path], [data-drop-trash]');
            body.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
            if (!t && loc !== 'files') return;
            e.preventDefault();
            dropFiles(e, t?.hasAttribute('data-drop-trash') ? { trash: true } : { path: t ? t.dataset.dropPath : path });
        });
        picker.onchange = () => { upload(picker.files); picker.value = ''; };
        const onChange = () => { if (body.isConnected) { Object.keys(colCache).forEach(k => delete colCache[k]); load(loc, path, false); } else removeEventListener('marx:files', onChange); };
        addEventListener('marx:files', onChange);

        async function prefsSheet() {
            const r = await sheet(win, { title: 'Impostazioni Finder', ok: 'Salva', fields: [
                { type: 'select', name: 'view', label: 'Vista', value: P.view, options: [['icons', 'Icone'], ['list', 'Elenco'], ['columns', 'Colonne']] },
                { type: 'select', name: 'sort', label: 'Ordina per', value: P.sort, options: [['name', 'Nome'], ['date', 'Data di modifica'], ['size', 'Dimensione'], ['kind', 'Tipo']] },
                { type: 'checkbox', name: 'foldersFirst', label: 'Mostra prima le cartelle', value: P.foldersFirst },
                { type: 'checkbox', name: 'sizes', label: 'Mostra la dimensione sotto le icone', value: P.sizes },
            ] });
            if (!r) return;
            P = { ...P, ...r }; savePrefs('finder', P); items = sorted(items); draw();
        }
        load('files', store.get('finder.path', ''), false);
        return {
            go: (l, p = '') => load(l, p),
            reveal: async (p, type) => {
                const dir = type === 'folder' ? p : p.split('/').slice(0, -1).join('/');
                await load('files', dir);
                if (type !== 'folder') { const i = items.findIndex(x => x.name === p.split('/').pop()); if (i >= 0) { select(i); view.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); } }
            },
            prefs: prefsSheet,
            menus: () => {
                const one = sel.size === 1 ? items[[...sel][0]] : null;
                return {
                    File: [['Nuova cartella', loc === 'files' && mkdir, '⇧⌘N'], ['Carica file…', loc === 'files' && (() => picker.click()), '⌘U'], '-',
                        ...(one ? itemMenu(one) : sel.size > 1 ? itemMenu(selItems()[0]) : [['Apri', null], ['Quick Look', null, 'Spazio'], ['Sposta nel Cestino', null]]),
                        '-', ['Chiudi finestra', () => close('finder'), '⌘W']],
                    Modifica: [['Seleziona tutto', () => { sel = new Set(items.map((_, i) => i)); updateSel(); }, '⌘A'], ['Deseleziona', sel.size && (() => { sel.clear(); updateSel(); })]],
                    Vista: [...viewMenu(), '-', ...sortMenu(), '-', [check(P.foldersFirst, 'Cartelle in alto'), () => setPref('foldersFirst', !P.foldersFirst)], [check(P.sizes, 'Mostra dimensioni'), () => setPref('sizes', !P.sizes)], '-', ['Aggiorna', () => load(loc, path, false), '⌘R']],
                    Vai: [['Indietro', hpos > 0 && (() => { hpos--; const h = hist[hpos]; load(h.loc, h.path, false); }), '⌘['],
                        ['Avanti', hpos < hist.length - 1 && (() => { hpos++; const h = hist[hpos]; load(h.loc, h.path, false); }), '⌘]'],
                        ['Cartella superiore', loc === 'files' && path && (() => load('files', path.split('/').slice(0, -1).join('/'))), '⌘↑'], '-',
                        ['I miei file', () => go('files', '')], ['Scrivania', () => go('files', 'Scrivania')], ['Condivisi con me', () => go('shared')], ['Link condivisi', () => go('links')], ['Cestino', () => go('trash')]],
                };
            },
        };
    }

    /* ---------- Scrivania: i file della cartella «Scrivania», con le pile ---------- */
    function desktopFiles() {
        const box = $('.desktop-icons');
        const SYSTEM = box.innerHTML;  // Documenti, Note, MarX HD
        let files = [], sel = null, openStack = null;
        async function load() {
            try { const d = await api('GET', '/files?path=Scrivania'); files = d.items; setTrashFull(d.trash); } catch { files = []; }
            draw();
        }
        function draw() {
            let html = SYSTEM;
            if (S.desktopStacks) {
                const groups = {};
                files.forEach(f => { const g = KIND_INFO[kindOf(f.name, f.type)][2]; (groups[g] ||= []).push(f); });
                Object.entries(groups).forEach(([g, list]) => {
                    if (list.length === 1) { html += fileHTML(list[0]); return; }
                    html += `<button class="desk-icon desk-stack ${openStack === g ? 'open' : ''}" data-stack="${esc(g)}"><span class="stack-icons">${list.slice(0, 3).map(fileIcon).join('')}</span><span>${esc(g)} (${list.length})</span></button>`;
                    if (openStack === g) html += list.map(fileHTML).join('');
                });
            } else html += files.map(fileHTML).join('');
            box.innerHTML = html;
        }
        const fileHTML = f => `<button class="desk-icon desk-file ${sel === f.name ? 'sel' : ''} ${openStack && KIND_INFO[kindOf(f.name, f.type)][2] === openStack ? 'in-stack' : ''}" data-dfile="${esc(f.name)}" draggable="true" ${f.type === 'folder' ? `data-drop-path="Scrivania/${esc(f.name)}"` : ''}>
            ${kindOf(f.name, f.type) === 'img' && f.size < 8e6 ? `<span class="ico ico-thumb"><img src="${esc(fileUrl('Scrivania/' + f.name, true))}" alt=""></span>` : fileIcon(f)}<span>${esc(f.name)}</span>${tagDots(f.tags)}</button>`;
        const fileOf = el => files.find(f => f.name === el.dataset.dfile);
        const openFile = f => {
            if (f.type === 'folder') { open('finder'); return ctlOf('finder').go?.('files', 'Scrivania/' + f.name); }
            const k = kindOf(f.name, f.type);
            if (k === 'img' || k === 'pdf') return openPreview(f.name, fileUrl('Scrivania/' + f.name, true), k);
            quickLook([qlItem(f, 'Scrivania/' + f.name)]);
        };
        box.addEventListener('click', e => {
            const st = e.target.closest('[data-stack]'); if (st) { openStack = openStack === st.dataset.stack ? null : st.dataset.stack; return draw(); }
            const el = e.target.closest('[data-dfile]'); sel = el ? el.dataset.dfile : null;
            box.querySelectorAll('[data-dfile]').forEach(x => x.classList.toggle('sel', x.dataset.dfile === sel));
        });
        box.addEventListener('dblclick', e => { const el = e.target.closest('[data-dfile]'); if (el) openFile(fileOf(el)); });
        addEventListener('keydown', e => {
            if (e.key !== ' ' || !sel || e.target.closest?.('input, textarea, [contenteditable], .window')) return;
            const f = files.find(x => x.name === sel); if (!f) return;
            e.preventDefault(); quickLook([qlItem(f, 'Scrivania/' + f.name)]);
        });
        box.addEventListener('contextmenu', e => {
            const el = e.target.closest('[data-dfile]'); if (!el) return;
            e.preventDefault(); e.stopPropagation();
            const f = fileOf(el), p = 'Scrivania/' + f.name; sel = f.name; draw();
            const win = wins.get('finder') || document.body;
            contextMenu(e.clientX, e.clientY, [
                ['Apri', () => openFile(f)], ['Quick Look', () => quickLook([qlItem(f, p)])], '-',
                ['Rinomina…', async () => { const r = await sheet(win === document.body ? (open('finder'), wins.get('finder')) : win, { title: 'Rinomina', fields: [{ name: 'name', label: 'Nuovo nome', value: f.name }], ok: 'Rinomina' }); if (r && r.name !== f.name) try { await api('POST', '/files/rename', { path: p, name: r.name }); filesChanged(); } catch (err) { toast(err.message); } }],
                ['Mostra nel Finder', () => { open('finder'); ctlOf('finder').reveal?.(p, f.type); }], '-',
                ...tagMenu([p], f.tags || []), '-',
                ['Sposta nel Cestino', async () => { try { const r = await api('DELETE', '/files', { paths: [p] }); playSound('trash'); setTrashFull(r.trash); filesChanged(); } catch (err) { toast(err.message); } }],
            ]);
        });
        box.addEventListener('dragstart', e => {
            const el = e.target.closest('[data-dfile]'); if (!el) return;
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ paths: ['Scrivania/' + el.dataset.dfile] })); e.dataTransfer.effectAllowed = 'move';
        });
        // Rilascio sulla scrivania: sposta o carica nella cartella «Scrivania»
        const desk = $('#desktop');
        desk.addEventListener('dragover', e => { if (acceptsDrop(e) && !e.target.closest('.window')) { e.preventDefault(); const f = e.target.closest('[data-drop-path]'); box.querySelectorAll('.drop').forEach(x => x !== f && x.classList.remove('drop')); f?.classList.add('drop'); } });
        desk.addEventListener('drop', e => {
            if (e.target.closest('.window')) return;
            e.preventDefault(); box.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
            const f = e.target.closest('[data-drop-path]');
            dropFiles(e, { path: f ? f.dataset.dropPath : 'Scrivania' });
        });
        addEventListener('marx:files', load);
        return { load, draw };
    }

    function openPreview(name, url, kind) {
        const id = 'preview';
        if (wins.has(id)) { wins.get(id).remove(); wins.delete(id); }
        APPS[id] = { name, icon: kind, w: 720, h: 520, hidden: true, render: body => {
            body.innerHTML = `<div class="preview">${kind === 'img' ? `<img src="${esc(url)}" alt="${esc(name)}">` : `<iframe src="${esc(url)}" title="${esc(name)}"></iframe>`}</div>`;
            return { menus: () => ({ File: [['Scarica', () => location.href = url.replace('&inline=1', '')], ['Apri in una nuova scheda', () => window.open(url)], '-', ['Chiudi finestra', () => close('preview'), '⌘W']] }) };
        } };
        open(id);
    }

    // Voci di menu: '-' separatore, oppure [etichetta, azione, scorciatoia, disattivata]
    const menuHTML = items => items.map((it, i) => {
        if (it === '-') return '<hr>';
        // La spunta (se attiva) viene mostrata a destra, senza rientro del testo
        const [mark, label] = String(it[0]).includes('\u0000') ? String(it[0]).split('\u0000') : ['', it[0]];
        return `<button data-i="${i}" ${it[3] || !it[1] ? 'disabled' : ''}><span>${esc(label)}</span>${mark ? '<i class="ck">✓</i>' : ''}${it[2] ? `<kbd>${esc(it[2])}</kbd>` : ''}</button>`;
    }).join('');
    function contextMenu(x, y, entries) {
        document.querySelectorAll('.ctx').forEach(m => m.remove());
        closePanels();
        const m = document.createElement('div'); m.className = 'ctx';
        m.innerHTML = menuHTML(entries);
        document.body.append(m);
        m.style.left = Math.max(4, Math.min(x, innerWidth - m.offsetWidth - 6)) + 'px';
        m.style.top = Math.max(4, Math.min(y, innerHeight - m.offsetHeight - 6)) + 'px';
        m.onclick = e => { e.stopPropagation(); const b = e.target.closest('[data-i]'); if (b && !b.disabled) { m.remove(); entries[b.dataset.i][1](); } };
        m.oncontextmenu = e => e.preventDefault();
        setTimeout(() => {
            const off = ev => { if (!m.contains(ev.target)) { m.remove(); removeEventListener('pointerdown', off, true); } };
            addEventListener('pointerdown', off, true);
        });
    }

    /* Note: salvate nel database */
    function notes(body, win) {
        let list = [], cur = null, timer = null;
        let P = prefs('notes', { size: 15, font: 'sans' });
        const title = n => (n.body || '').split('\n')[0].trim() || 'Nuova nota';
        const applyFont = () => { const ta = $('textarea', body); if (ta) { ta.style.fontSize = P.size + 'px'; ta.style.fontFamily = P.font === 'mono' ? 'ui-monospace, Menlo, monospace' : P.font === 'serif' ? 'Georgia, serif' : ''; } };
        const setPref = (k, v) => { P = { ...P, [k]: v }; savePrefs('notes', P); applyFont(); };
        const current = () => list.find(x => x.id === cur);
        async function newNote() {
            try { const x = await api('POST', '/notes', { body: '' }); list.unshift(x); cur = x.id; draw(); $('textarea', body).focus(); } catch (e) { toast(e.message); }
        }
        async function delNote(n) {
            if (!n) return;
            const ok = await sheet(win, { title: `Eliminare «${title(n)}»?`, text: 'L\'operazione non si può annullare.', ok: 'Elimina', danger: true }); if (!ok) return;
            try { await api('DELETE', '/notes/' + n.id); playSound('trash'); list = list.filter(x => x.id !== n.id); cur = list[0]?.id ?? null; draw(); } catch (e) { toast(e.message); }
        }
        function exportNote(n) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([n.body || ''], { type: 'text/plain' }));
            a.download = title(n).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) + '.txt';
            a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
        async function prefsSheet() {
            const r = await sheet(win, { title: 'Impostazioni Note', ok: 'Salva', fields: [
                { type: 'select', name: 'size', label: 'Dimensione testo', value: P.size, options: [[13, 'Piccolo'], [15, 'Medio'], [18, 'Grande'], [22, 'Molto grande']] },
                { type: 'select', name: 'font', label: 'Carattere', value: P.font, options: [['sans', 'Sistema'], ['serif', 'Serif'], ['mono', 'Monospaziato']] },
            ] });
            if (r) { P = { size: +r.size, font: r.font }; savePrefs('notes', P); applyFont(); }
        }
        async function load() {
            try { list = await api('GET', '/notes'); const last = store.get('notes.current', null); cur = list.some(x => x.id === last) ? last : list[0]?.id ?? null; draw(); } catch (e) { toast(e.message); }
        }
        function draw() {
            const n = list.find(x => x.id === cur);
            store.set('notes.current', cur);
            body.innerHTML = `<div class="notes"><div class="notes-list"><div class="bar"><strong>Note</strong><span><button data-act="del" aria-label="Elimina nota" ${n ? '' : 'disabled'}>🗑</button><button data-act="new" aria-label="Nuova nota">✎</button></span></div>
                ${list.length ? list.map(x => `<button class="note-item ${x.id === cur ? 'active' : ''}" data-id="${x.id}"><strong>${esc(title(x))}</strong><small>${new Date(x.updated_at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></button>`).join('') : '<p style="padding:12px;color:var(--muted)">Nessuna nota</p>'}</div>
                <textarea placeholder="${n ? 'Scrivi qui…' : 'Premi ✎ per creare una nota'}" ${n ? '' : 'disabled'}>${esc(n?.body)}</textarea></div>`;
            $('[data-act=new]', body).onclick = newNote;
            $('[data-act=del]', body).onclick = () => delNote(n);
            body.querySelectorAll('.note-item').forEach(b => b.onclick = () => { cur = +b.dataset.id; draw(); });
            const ta = $('textarea', body);
            applyFont();
            ta.oninput = () => {
                if (!n) return;
                n.body = ta.value;
                const it = $('.note-item.active strong', body); if (it) it.textContent = title(n);
                clearTimeout(timer);
                timer = setTimeout(async () => { try { Object.assign(n, await api('PUT', '/notes/' + n.id, { body: n.body })); } catch (e) { toast('Nota non salvata: ' + e.message); } }, 600);
            };
        }
        body.innerHTML = '<p style="padding:20px;color:var(--muted)">Caricamento…</p>';
        load();
        const sizes = [[13, 'Piccolo'], [15, 'Medio'], [18, 'Grande'], [22, 'Molto grande']];
        return {
            openNote: id => { store.set('notes.current', id); if (list.length) { cur = id; draw(); } },
            prefs: prefsSheet,
            context: e => {
                const it = e.target.closest('.note-item');
                if (it) { const n = list.find(x => x.id === +it.dataset.id); return [['Apri', () => { cur = n.id; draw(); }], ['Esporta come testo…', () => exportNote(n)], '-', ['Elimina nota', () => delNote(n)]]; }
                if (e.target.closest('.notes-list')) return [['Nuova nota', newNote]];
                return null;
            },
            menus: () => ({
                File: [['Nuova nota', newNote, '⌘N'], ['Elimina nota', () => delNote(current()), '⌫', !current()], '-',
                    ['Esporta come testo…', () => exportNote(current()), '', !current()], '-', ['Chiudi finestra', () => close('notes'), '⌘W']],
                Formato: [...sizes.map(([v, l]) => [check(P.size === v, 'Testo ' + l.toLowerCase()), () => setPref('size', v)]), '-',
                    [check(P.font === 'sans', 'Carattere di sistema'), () => setPref('font', 'sans')],
                    [check(P.font === 'serif', 'Serif'), () => setPref('font', 'serif')],
                    [check(P.font === 'mono', 'Monospaziato'), () => setPref('font', 'mono')]],
            }),
        };
    }

    function calculator(body, win) {
        let disp = '0', acc = null, op = null, fresh = true;
        let P = prefs('calculator', { decimals: 'auto', thousands: true });
        body.innerHTML = `<div class="calc"><div class="calc-display">0</div><div class="calc-keys">
            ${[['AC', 'fn'], ['±', 'fn'], ['%', 'fn'], ['÷', 'op'], ['7'], ['8'], ['9'], ['×', 'op'], ['4'], ['5'], ['6'], ['−', 'op'], ['1'], ['2'], ['3'], ['+', 'op'], ['0', 'zero'], [','], ['=', 'op']].map(([k, c = '']) => `<button class="${c}" data-k="${k}">${k}</button>`).join('')}</div></div>`;
        const out = body.querySelector('.calc-display');
        const pretty = () => {
            if (!/^-?\d+(\.\d*)?$/.test(disp)) return disp;
            if (!fresh) { const [i, d] = disp.split('.'); return (P.thousands ? (+i).toLocaleString('it-IT').replace(/^0$/, i) : i) + (d !== undefined ? ',' + d : ''); }
            const v = +disp, opts = { useGrouping: P.thousands, maximumFractionDigits: P.decimals === 'auto' ? 10 : +P.decimals };
            if (P.decimals !== 'auto') opts.minimumFractionDigits = +P.decimals;
            return v.toLocaleString('it-IT', opts);
        };
        const show = () => { const t = pretty(); out.textContent = t; out.style.fontSize = t.length > 9 ? '30px' : ''; };
        const setPref = (k, v) => { P = { ...P, [k]: v }; savePrefs('calculator', P); show(); };
        const copy = () => navigator.clipboard?.writeText(out.textContent).then(() => toast('Risultato copiato'), () => toast('Copia non consentita dal browser'));
        const calc = (a, b, o) => ({ '+': a + b, '−': a - b, '×': a * b, '÷': b ? a / b : NaN }[o]);
        const num = v => String(+v.toPrecision(12));
        body.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
            const k = b.dataset.k;
            if (/\d/.test(k)) { disp = fresh || disp === '0' ? k : disp + k; fresh = false; }
            else if (k === ',') { if (fresh) { disp = '0.'; fresh = false; } else if (!disp.includes('.')) disp += '.'; }
            else if (k === 'AC') { disp = '0'; acc = null; op = null; fresh = true; }
            else if (k === '±') disp = num(-disp);
            else if (k === '%') disp = num(disp / 100);
            else if (k === '=') { if (op) { disp = num(calc(acc, +disp, op)); acc = null; op = null; fresh = true; } }
            else { if (op && !fresh) disp = num(calc(acc, +disp, op)); acc = +disp; op = k; fresh = true; }
            if (disp === 'NaN') disp = 'Errore';
            show();
        });
        show();
        const decs = [['auto', 'Automatici'], ['0', 'Nessuno'], ['2', '2'], ['4', '4']];
        const prefsSheet = async () => {
            const r = await sheet(win, { title: 'Impostazioni Calcolatrice', ok: 'Salva', fields: [
                { type: 'select', name: 'decimals', label: 'Decimali', value: P.decimals, options: decs },
                { type: 'checkbox', name: 'thousands', label: 'Separatore delle migliaia', value: P.thousands },
            ] });
            if (r) { P = { ...P, ...r }; savePrefs('calculator', P); show(); }
        };
        const press = k => body.querySelector(`[data-k="${k}"]`).click();
        return {
            prefs: prefsSheet,
            context: () => [['Copia risultato', copy], ['Azzera', () => press('AC')], '-', ['Impostazioni Calcolatrice…', prefsSheet]],
            menus: () => ({
                Modifica: [['Copia risultato', copy, '⌘C'], ['Azzera', () => press('AC'), 'Esc']],
                Vista: [...decs.map(([v, l]) => [check(P.decimals === v, 'Decimali: ' + l), () => setPref('decimals', v)]), '-',
                    [check(P.thousands, 'Separatore delle migliaia'), () => setPref('thousands', !P.thousands)]],
            }),
        };
    }

    function calendar(body, win) {
        let d = new Date(); d.setDate(1);
        let P = prefs('calendar', { monday: true, weekends: true });
        const draw = () => {
            const y = d.getFullYear(), m = d.getMonth(), wd = new Date(y, m, 1).getDay(), first = P.monday ? (wd + 6) % 7 : wd, days = new Date(y, m + 1, 0).getDate(), t = new Date();
            const names = P.monday ? ['L', 'M', 'M', 'G', 'V', 'S', 'D'] : ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
            let g = names.map(x => `<span class="dow">${x}</span>`).join('') + '<span></span>'.repeat(first);
            for (let i = 1; i <= days; i++) {
                const dow = new Date(y, m, i).getDay(), we = dow === 0 || dow === 6;
                g += `<span class="${y === t.getFullYear() && m === t.getMonth() && i === t.getDate() ? 'today' : ''}" style="${we && P.weekends ? 'color:var(--muted)' : ''}">${i}</span>`;
            }
            body.innerHTML = `<div class="cal"><header><button data-d="-1" aria-label="Mese precedente">‹</button><h3>${d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</h3><button data-d="1" aria-label="Mese successivo">›</button></header><div class="cal-grid">${g}</div></div>`;
            body.querySelectorAll('[data-d]').forEach(b => b.onclick = () => move(+b.dataset.d));
        };
        const move = n => { d.setMonth(d.getMonth() + n); draw(); };
        const today = () => { d = new Date(); d.setDate(1); draw(); };
        const setPref = (k, v) => { P = { ...P, [k]: v }; savePrefs('calendar', P); draw(); };
        const prefsSheet = async () => {
            const r = await sheet(win, { title: 'Impostazioni Calendario', ok: 'Salva', fields: [
                { type: 'select', name: 'monday', label: 'La settimana inizia di', value: P.monday ? '1' : '0', options: [['1', 'Lunedì'], ['0', 'Domenica']] },
                { type: 'checkbox', name: 'weekends', label: 'Evidenzia i fine settimana', value: P.weekends },
            ] });
            if (r) { P = { monday: r.monday === '1', weekends: r.weekends }; savePrefs('calendar', P); draw(); }
        };
        draw();
        return {
            prefs: prefsSheet,
            context: () => [['Vai a oggi', today], ['Mese precedente', () => move(-1)], ['Mese successivo', () => move(1)], '-', ['Impostazioni Calendario…', prefsSheet]],
            menus: () => ({
                Vista: [['Vai a oggi', today, '⌘T'], '-', ['Mese precedente', () => move(-1), '⌘←'], ['Mese successivo', () => move(1), '⌘→'], ['Anno precedente', () => move(-12)], ['Anno successivo', () => move(12)], '-',
                    [check(P.monday, 'Settimana da lunedì'), () => setPref('monday', !P.monday)],
                    [check(P.weekends, 'Evidenzia fine settimana'), () => setPref('weekends', !P.weekends)]],
            }),
        };
    }

    /* ---------- Impostazioni (stile Impostazioni di Sistema: barra laterale + pannelli) ---------- */
    function settings(body, win) {
        const ico = (color, path) => `<span class="st-ico" style="background:${color}"><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg></span>`;
        const SECTIONS = [
            { id: 'account', name: MARX.user.name, sub: 'Account e password', keys: 'account nome email password utente esci', avatar: true },
            { id: 'aspetto', name: 'Aspetto', keys: 'tema chiaro scuro colore accento testo dimensione trasparenza animazioni movimento', icon: ico('#3a3a3c', '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="#fff"/>') },
            { id: 'sfondo', name: 'Sfondo', keys: 'sfondo wallpaper immagine foto colore personalizzato', icon: ico('#30b0c7', '<path d="M3 18l5-6 4 4 3-3 6 5z" fill="#fff"/><circle cx="16" cy="8" r="2" fill="#fff"/>') },
            { id: 'dock', name: 'Dock', keys: 'dock icone dimensione ingrandimento nascondi automaticamente', icon: ico('#0a84ff', '<rect x="3" y="14" width="18" height="6" rx="2.5" fill="#fff"/><rect x="6" y="16" width="3" height="2" rx=".6" fill="#0a84ff"/><rect x="10.5" y="16" width="3" height="2" rx=".6" fill="#0a84ff"/><rect x="15" y="16" width="3" height="2" rx=".6" fill="#0a84ff"/>') },
            { id: 'scrivania', name: 'Scrivania e finestre', keys: 'scrivania finestre icone ripristina riapri sessione posizioni stage manager angoli attivi affianca mission control spaces', icon: ico('#5e5ce6', '<rect x="3" y="5" width="13" height="10" rx="2" fill="none" stroke="#fff" stroke-width="2"/><rect x="8" y="9" width="13" height="10" rx="2" fill="#fff"/>') },
            { id: 'mouse', name: 'Mouse e puntatore', keys: 'mouse puntatore cursore freccia dimensione colore scuoti doppio clic barra titolo', icon: ico('#ff9500', '<path d="M7 3v15l3.8-3.4 2.5 5.4 2.4-1.1-2.5-5.3H18z" fill="#fff"/>') },
            { id: 'notifiche', name: 'Notifiche', keys: 'notifiche non disturbare full immersion centro notifiche avvisi', icon: ico('#ff3b30', '<path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0" fill="#fff"/>') },
            { id: 'suoni', name: 'Suoni', keys: 'suoni audio volume avviso notifica avvio cestino', icon: ico('#ff2d55', '<path d="M4 9h4l5-4v14l-5-4H4z" fill="#fff"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>') },
            { id: 'salvaschermo', name: 'Salvaschermo', keys: 'salvaschermo screensaver inattività orologio aurora bolle', icon: ico('#34c759', '<rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="#fff" stroke-width="2"/><circle cx="9" cy="11" r="2.5" fill="#fff"/><circle cx="15" cy="10" r="1.5" fill="#fff"/><path d="M9 20h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>') },
            { id: 'tastiera', name: 'Tastiera', keys: 'tastiera scorciatoie tasti combinazioni shortcut', icon: ico('#8e8e93', '<rect x="2.5" y="6.5" width="19" height="11" rx="2" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h0M7 14h10" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>') },
            ...(MARX.user.is_admin ? [{ id: 'aggiornamento', name: 'Aggiornamento software', keys: 'aggiornamento software update versione release github nuova', icon: ico('#8e8e93', '<path d="M12 4a8 8 0 1 0 7.4 5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>') }] : []),
            ...(MARX.user.is_admin ? [{ id: 'utenti', name: 'Utenti', keys: 'utenti account persone amministratore aggiungi elimina password', icon: ico('#5856d6', '<circle cx="9" cy="9" r="3.2" fill="#fff"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0z" fill="#fff"/><circle cx="17" cy="10" r="2.4" fill="#fff" opacity=".8"/><path d="M14.5 19a4.5 4.5 0 0 1 7 0z" fill="#fff" opacity=".8"/>') }] : []),
            { id: 'menubar', name: 'Barra dei menu', keys: 'barra menu orologio ora data secondi', icon: ico('#8e8e93', '<rect x="3" y="4" width="18" height="4" rx="1.5" fill="#fff"/><rect x="3" y="11" width="18" height="9" rx="2" fill="none" stroke="#fff" stroke-width="2"/>') },
            { id: 'blocco', name: 'Blocco schermo', keys: 'blocco schermo automatico inattività password sicurezza', icon: ico('#1c1c1e', '<rect x="5" y="11" width="14" height="9" rx="2" fill="#fff"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="#fff" stroke-width="2"/>') },
            { id: 'info', name: 'Info', keys: 'info versione laravel sistema browser', icon: ico('#636366', '<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2"/><rect x="11" y="10" width="2" height="7" rx="1" fill="#fff"/><circle cx="12" cy="7" r="1.3" fill="#fff"/>') },
        ];
        let current = store.get('settings.section', 'aspetto'), query = '';
        if (!SECTIONS.some(x => x.id === current)) current = 'aspetto';
        const initials = () => MARX.user.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

        // Controlli riutilizzabili: ogni [data-set] salva da solo la sua impostazione
        const toggle = k => `<label class="sw"><input type="checkbox" data-set="${k}" ${S[k] ? 'checked' : ''}><i></i></label>`;
        const select = (k, opts) => `<select data-set="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(S[k]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
        const range = (k, min, max, step, fmt) => `<span class="st-range"><input type="range" data-set="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}"><output>${fmt(S[k])}</output></span>`;
        const row = (label, control, hint = '') => `<div class="st-row"><div><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</div><div class="st-ctl">${control}</div></div>`;
        const group = (title, rows) => `${title ? `<h4 class="st-gt">${title}</h4>` : ''}<div class="st-group">${rows.join('')}</div>`;

        const PANES = {
            account: () => `
                <div class="st-hero"><div class="st-avatar">${esc(initials())}</div><div><h2>${esc(MARX.user.name)}</h2><p>${esc(MARX.user.email)}${MARX.user.is_admin ? ' · Amministratore' : ''}</p></div></div>
                ${group('Profilo', [row('Nome', `<form id="nameForm" class="st-inline"><input name="name" value="${esc(MARX.user.name)}" maxlength="60" aria-label="Nome"><button class="btn">Salva</button></form>`), row('Email', `<span class="st-muted">${esc(MARX.user.email)}</span>`)])}
                <h4 class="st-gt">Password</h4>
                <form class="st-group st-form" id="pwForm">
                    <input type="password" name="current_password" placeholder="Password attuale" autocomplete="current-password" required>
                    <input type="password" name="password" placeholder="Nuova password (min. 8 caratteri)" autocomplete="new-password" required>
                    <input type="password" name="password_confirmation" placeholder="Ripeti la nuova password" autocomplete="new-password" required>
                    <div class="st-form-foot"><p class="form-msg"></p><button class="btn primary">Cambia password</button></div>
                </form>
                <div class="st-foot"><button class="btn" data-act="lock">Blocca schermo</button><button class="btn danger" data-act="logout">Esci</button></div>`,
            aspetto: () => `
                <h4 class="st-gt">Tema</h4>
                <div class="st-themes">${[['light', 'Chiaro'], ['dark', 'Scuro'], ['auto', 'Automatico']].map(([k, l]) => `<button class="st-theme ${S.theme === k ? 'on' : ''}" data-theme-pick="${k}"><span class="st-thumb t-${k}"><i></i><b></b></span>${l}</button>`).join('')}</div>
                ${group('', [
                    row('Colore principale', `<span class="st-accents">${Object.entries(ACCENTS).map(([k, c]) => `<button class="${S.accent === k ? 'on' : ''}" data-accent="${k}" style="--c:${c}" aria-label="${k}" title="${{ blue: 'Blu', purple: 'Viola', pink: 'Rosa', red: 'Rosso', orange: 'Arancione', yellow: 'Giallo', green: 'Verde', graphite: 'Grafite' }[k]}"></button>`).join('')}</span>`, 'Pulsanti, selezioni e collegamenti'),
                    row('Dimensione del testo', select('textSize', [['small', 'Piccola'], ['medium', 'Media'], ['large', 'Grande']])),
                ])}
                ${group('Accessibilità', [
                    row('Riduci trasparenza', toggle('reduceTransparency'), 'Menu, Dock e pannelli diventano opachi e più leggibili'),
                    row('Riduci animazioni', toggle('reduceMotion'), 'Niente effetto Genio, rimbalzi e ingrandimento del Dock'),
                ])}`,
            sfondo: () => `
                <div class="st-preview" id="wallDrop"><div class="st-preview-bar"></div><div class="st-preview-dock"></div><span>Trascina qui un'immagine</span></div>
                <h4 class="st-gt">Sfondi</h4>
                <div class="st-walls">
                    ${Object.keys(WALLPAPERS).map(k => `<button class="${S.wallpaper === k ? 'on' : ''}" data-wall-pick="${k}" style="background:${WALLPAPERS[k]}" aria-label="Sfondo ${k}"></button>`).join('')}
                    <label class="st-wall-color ${S.wallpaper === 'color' ? 'on' : ''}" title="Colore pieno" style="background:${S.wallpaperColor}"><input type="color" id="wallColor" value="${S.wallpaperColor}"><span>Colore</span></label>
                    ${S.wallpaperVersion ? `<button class="${S.wallpaper === 'custom' ? 'on' : ''}" data-wall-pick="custom" style="background:url('/settings/wallpaper?v=${S.wallpaperVersion}') center/cover" aria-label="La tua immagine"></button>` : ''}
                    <label class="st-wall-add" title="Carica un'immagine"><input type="file" id="wallFile" accept="image/jpeg,image/png,image/webp,image/gif" hidden><span>＋</span><small>La tua immagine</small></label>
                </div>
                ${S.wallpaperVersion ? group('La tua immagine', [
                    row('Adattamento', select('wallpaperFit', [['cover', 'Riempi lo schermo'], ['contain', 'Adatta allo schermo'], ['center', 'Al centro'], ['tile', 'Affianca']]), 'Come mostrare l\'immagine se ha proporzioni diverse dallo schermo'),
                    row('Rimuovi immagine', `<button class="btn danger" data-act="wall-delete">Rimuovi</button>`),
                ]) : '<p class="st-note">Carica una foto o un\'immagine (JPG, PNG, WebP o GIF, fino a 15 MB): viene salvata nel tuo account e la ritrovi su ogni dispositivo.</p>'}`,
            dock: () => `
                ${group('', [
                    row('Dimensione', range('dockSize', 36, 80, 2, v => v + ' px')),
                    row('Ingrandimento', toggle('dockMagnify'), 'Le icone si ingrandiscono al passaggio del mouse'),
                    row('Intensità ingrandimento', range('dockMagnifyScale', 1.1, 2, 0.1, v => '×' + (+v).toFixed(1).replace('.', ','))),
                    row('Nascondi automaticamente', toggle('dockAutohide'), 'Il Dock compare quando porti il mouse sul bordo inferiore'),
                ])}`,
            scrivania: () => `
                ${group('Scrivania', [row('Mostra icone sulla scrivania', toggle('desktopIcons'))])}
                ${group('Organizzazione', [
                    row('Stage Manager', toggle('stageManager'), 'L\'app attiva al centro, le altre in miniatura sulla sinistra'),
                    row('Affianca trascinando ai bordi', toggle('tiling'), 'Trascina una finestra sul bordo sinistro, destro o in alto per affiancarla o riempire lo schermo'),
                    row('Mission Control', `<button class="btn" data-act="mission">Apri</button>`, 'Tutte le finestre e le scrivanie in un colpo d\'occhio (F3)'),
                ])}
                <h4 class="st-gt">Angoli attivi</h4>
                <div class="st-group st-hot">
                    <div class="st-hot-screen"><span>Porta il puntatore in un angolo dello schermo per avviare un'azione</span></div>
                    ${[['hotTL', 'In alto a sinistra'], ['hotTR', 'In alto a destra'], ['hotBL', 'In basso a sinistra'], ['hotBR', 'In basso a destra']].map(([k, l]) =>
                        `<label class="st-hot-${k.slice(3).toLowerCase()}"><small>${l}</small>${select(k, Object.entries(HOT_ACTIONS))}</label>`).join('')}
                </div>
                ${group('Finestre', [
                    row('Riapri le finestre all\'avvio', toggle('restoreWindows'), 'Dopo un aggiornamento della pagina ritrovi le app dove le avevi lasciate'),
                    row('Posizioni delle finestre', `<button class="btn" data-act="reset-pos">Ripristina</button>`, 'Le finestre torneranno al centro alla prossima apertura'),
                    row('Finestre aperte', `<button class="btn" data-act="close-all">Chiudi tutte</button>`),
                ])}`,
            mouse: () => `
                <div class="st-preview st-cursor-preview" title="Prova qui il puntatore">
                    <span class="cp" style="cursor:var(--cur-default)">Freccia</span><span class="cp" style="cursor:var(--cur-pointer)">Collegamento</span>
                    <span class="cp" style="cursor:var(--cur-text)">Testo</span><span class="cp" style="cursor:var(--cur-ew)">Ridimensiona</span></div>
                ${group('Puntatore', [
                    row('Stile', select('cursorStyle', [['mac', 'Mac'], ['system', 'Quello del sistema']]), 'Il puntatore Mac vale per tutto MarX (non dentro le app web)'),
                    row('Dimensione', range('cursorSize', 1, 3, 0.25, v => '×' + (+v).toFixed(2).replace(/\.?0+$/, '').replace('.', ','))),
                    row('Colore di riempimento', `<input type="color" class="st-color" data-color="cursorFill" value="${S.cursorFill}">`),
                    row('Colore del contorno', `<input type="color" class="st-color" data-color="cursorOutline" value="${S.cursorOutline}">`),
                    row('Scuoti il puntatore per trovarlo', toggle('shakeToLocate'), 'Muovi velocemente il mouse avanti e indietro: il puntatore si ingrandisce per un attimo'),
                    row('Colori e dimensione predefiniti', `<button class="btn" data-act="cursor-reset">Ripristina</button>`),
                ])}
                ${group('Finestre', [
                    row('Doppio clic sulla barra del titolo', select('titlebarDoubleClick', [['maximize', 'Ingrandisci'], ['minimize', 'Riduci nel Dock'], ['none', 'Non fare niente']])),
                ])}`,
            notifiche: () => {
                const list = store.get('notifications', []), dnd = dndActive();
                return `${group('Non disturbare', [
                    row('Non disturbare', `<select id="dndSel"><option value="off" ${!dnd ? 'selected' : ''}>Disattivato</option><option value="hour">Per 1 ora</option><option value="evening">Fino a stasera</option><option value="tomorrow">Fino a domani mattina</option><option value="on" ${S.dndUntil === 1 ? 'selected' : ''}>Attivo finché non lo disattivo</option></select>`,
                        dnd ? (S.dndUntil === 1 ? 'Attivo' : 'Attivo fino alle ' + new Date(S.dndUntil).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })) + ': le notifiche non compaiono e non suonano, ma restano nel Centro notifiche' : 'Le notifiche compaiono in alto a destra'),
                ])}
                ${group('Centro notifiche', [
                    row('Si apre cliccando l\'orologio in alto a destra', `<button class="btn" data-act="open-nc">Apri</button>`),
                    row(`Notifiche salvate: ${list.length}`, `<button class="btn" data-act="clear-nc" ${list.length ? '' : 'disabled'}>Cancella tutte</button>`),
                ])}
                ${group('', [row('Prova', `<button class="btn" data-act="test-notify">Invia una notifica di prova</button>`)])}`;
            },
            suoni: () => `
                ${group('', [
                    row('Suoni di sistema', toggle('sounds'), 'Notifiche, cestino, avvio'),
                    row('Volume', range('soundVolume', 0, 1, 0.05, v => Math.round(v * 100) + '%')),
                    row('Suono delle notifiche', select('notifySound', [['vetro', 'Vetro'], ['gocce', 'Gocce'], ['campanello', 'Campanello'], ['nessuno', 'Nessuno']]) + `<button class="btn" data-act="play-notify">▶</button>`),
                    row('Suono all\'avvio', toggle('startupSound'), 'Al primo clic dopo l\'accesso'),
                    row('Prova gli effetti', `<span class="st-inline"><button class="btn" data-act="play" data-snd="trash">Cestino</button><button class="btn" data-act="play" data-snd="startup">Avvio</button><button class="btn" data-act="play" data-snd="error">Errore</button></span>`),
                ])}`,
            salvaschermo: () => `
                <div class="st-saver-prev">${['orologio', 'aurora', 'bolle'].map(k => `<button class="${S.screensaverStyle === k ? 'on' : ''}" data-saver="${k}"><span class="sv-${k}"></span>${{ orologio: 'Orologio', aurora: 'Aurora', bolle: 'Bolle' }[k]}</button>`).join('')}</div>
                ${group('', [
                    row('Avvia dopo', select('screensaverMinutes', [[0, 'Mai'], [1, '1 minuto'], [2, '2 minuti'], [5, '5 minuti'], [10, '10 minuti'], [20, '20 minuti'], [30, '30 minuti']]), 'Di inattività. Muovi il mouse o premi un tasto per tornare a MarX'),
                    row('Anteprima', `<button class="btn" data-act="saver-preview">Avvia ora</button>`),
                ])}
                <p class="st-note">Se hai attivato anche il blocco automatico, allo scadere del tempo lo schermo si blocca comunque.</p>`,
            tastiera: () => `
                <p class="st-note" style="margin-top:0">Clicca una combinazione e premi i nuovi tasti. Esc annulla, Canc la rimette com'era.</p>
                ${group('Scorciatoie', SHORTCUT_DEFS.map(([id, label]) => row(esc(label), `<button class="kbd st-key ${S.shortcuts?.[id] ? 'custom' : ''}" data-key="${id}">${esc(prettyCombo(shortcutOf(id)))}</button>`)))}
                ${group('Fisse', [row('Passa da un\'app all\'altra', '<kbd class="kbd">tieni Alt + Q</kbd>'), row('Mission Control', '<kbd class="kbd">Ctrl + ↑</kbd>'), row('Chiudi pannelli', '<kbd class="kbd">Esc</kbd>')])}
                <div class="st-foot"><button class="btn" data-act="keys-reset">Ripristina tutte</button></div>`,
            utenti: () => `<div id="usersBox"><p class="st-note">Caricamento…</p></div>`,
            aggiornamento: () => `<div id="updBox"><p class="st-note">Controllo degli aggiornamenti…</p></div>`,
            menubar: () => `
                <div class="st-preview st-preview-mb"><div class="st-preview-bar"><span id="mbPreview"></span></div></div>
                ${group('Orologio', [row('Mostra la data', toggle('clockDate')), row('Mostra i secondi', toggle('clockSeconds'))])}`,
            blocco: () => `
                ${group('', [
                    row('Blocca automaticamente dopo', select('autoLockMinutes', [[0, 'Mai'], [5, '5 minuti'], [10, '10 minuti'], [15, '15 minuti'], [30, '30 minuti'], [60, '1 ora']]), 'Di inattività: per sbloccare serve la password'),
                    row('Blocca adesso', `<button class="btn" data-act="lock">Blocca schermo</button>`, 'Scorciatoia: Ctrl+⌘+Q'),
                ])}`,
            info: () => `
                <div class="st-about"><div class="logo"><svg viewBox="0 0 24 24" width="40" height="40"><path d="M3 20V4l9 9 9-9v16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg></div><h2>${esc(MARX.name)}</h2><p>Versione ${esc(MARX.version)} «${esc(MARX.codename)}»</p></div>
                ${group('', [
                    row('Utente', `<span class="st-muted">${esc(MARX.user.name)}</span>`),
                    row('Server', `<span class="st-muted">marx.marcostarace.it</span>`),
                    row('Laravel', `<span class="st-muted">${esc(MARX.laravel)}</span>`),
                    row('Schermo', `<span class="st-muted">${screen.width} × ${screen.height}</span>`),
                    row('Browser', `<span class="st-muted">${esc((navigator.userAgentData?.brands?.find(b => !/Not.?A.?Brand/i.test(b.brand))?.brand) || navigator.userAgent.split(' ').pop())}</span>`),
                ])}`,
        };

        function draw() {
            const list = SECTIONS.filter(x => !query || norm(x.name + ' ' + (x.sub || '') + ' ' + x.keys).includes(norm(query)));
            const sec = SECTIONS.find(x => x.id === current);
            const hadFocus = document.activeElement?.id === 'stSearch' && body.contains(document.activeElement);
            const scroll = $('.st-main', body)?.scrollTop || 0, sameSec = body.dataset.shownSection === current;
            body.dataset.shownSection = current;  // non «data-sec»: il gestore dei clic lo scambierebbe per una voce della barra laterale
            body.innerHTML = `<div class="st">
                <aside class="sidebar st-side">
                    <div class="as-search"><input id="stSearch" type="search" placeholder="Cerca" value="${esc(query)}" aria-label="Cerca nelle impostazioni" autocomplete="off"></div>
                    ${list.map(x => `<button class="st-nav ${x.id === current ? 'active' : ''} ${x.avatar ? 'st-nav-acc' : ''}" data-sec="${x.id}">${x.avatar ? `<span class="st-avatar sm">${esc(initials())}</span>` : x.icon}<span><b>${esc(x.name)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></button>`).join('') || '<p class="st-muted" style="padding:8px">Nessun risultato</p>'}
                </aside>
                <div class="st-main"><h2 class="st-title">${esc(sec.avatar ? 'Account' : sec.name)}</h2>${PANES[current]()}</div></div>`;
            if (sameSec) $('.st-main', body).scrollTop = scroll;
            const inp = $('#stSearch', body);
            if (hadFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
            inp.oninput = () => { query = inp.value; const first = SECTIONS.find(x => norm(x.name + ' ' + (x.sub || '') + ' ' + x.keys).includes(norm(query))); if (first && query) current = first.id; draw(); };
            wire();
        }
        function go(id) { current = id; store.set('settings.section', id); draw(); renderMenubar(); }

        async function uploadWall(file) {
            if (!file) return;
            const fd = new FormData(); fd.append('image', file);
            toast('Caricamento dello sfondo…');
            try { Object.assign(S, await api('POST', '/settings/wallpaper', fd)); applySettings(); draw(); toast('Sfondo aggiornato'); } catch (e) { toast(e.message); }
        }
        function wire() {
            body.querySelectorAll('[data-set]').forEach(el => {
                const k = el.dataset.set;
                const val = () => el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
                el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
                    setSetting(k, val());
                    const out = el.parentElement.querySelector('output');
                    if (out && k === 'soundVolume') { out.textContent = Math.round(el.value * 100) + '%'; return; }
                    if (out) out.textContent = k === 'dockSize' ? el.value + ' px' : '×' + (+el.value).toFixed(k === 'cursorSize' ? 2 : 1).replace(/\.?0+$/, '').replace('.', ',');
                    if (el.type !== 'range') draw();
                });
            });
            const mag = $('[data-set="dockMagnifyScale"]', body); if (mag) mag.disabled = !S.dockMagnify;
            const nf = $('#nameForm', body);
            if (nf) nf.onsubmit = async e => {
                e.preventDefault();
                try { const r = await api('PUT', '/profile', Object.fromEntries(new FormData(nf))); MARX.user.name = r.name; $('.menu-item-user').textContent = r.name; toast('Nome aggiornato'); draw(); } catch (err) { toast(err.message); }
            };
            const pf = $('#pwForm', body);
            if (pf) pf.onsubmit = async e => {
                e.preventDefault(); const msg = $('.form-msg', pf);
                try { await api('PUT', '/password', Object.fromEntries(new FormData(pf))); pf.reset(); msg.className = 'form-msg ok'; msg.textContent = 'Password cambiata.'; }
                catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
            };
            body.querySelectorAll('[data-color]').forEach(el => {
                el.oninput = () => { S[el.dataset.color] = el.value; applyCursors(); };
                el.onchange = () => setSetting(el.dataset.color, el.value);
            });
            const cs = $('[data-set="cursorSize"]', body); if (cs) cs.disabled = S.cursorStyle !== 'mac';
            const wf = $('#wallFile', body); if (wf) wf.onchange = () => uploadWall(wf.files[0]);
            const wc = $('#wallColor', body);
            if (wc) { wc.oninput = () => { S.wallpaperColor = wc.value; if (S.wallpaper === 'color') applySettings(); }; wc.onchange = () => { setSetting('wallpaperColor', wc.value); setSetting('wallpaper', 'color'); draw(); }; }
            const drop = $('#wallDrop', body);
            if (drop) {
                drop.ondragover = e => { e.preventDefault(); drop.classList.add('drop'); };
                drop.ondragleave = () => drop.classList.remove('drop');
                drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drop'); uploadWall(e.dataTransfer.files[0]); };
            }
            const mb = $('#mbPreview', body); if (mb) mb.textContent = $('#clock').textContent;
            const dsel = $('#dndSel', body); if (dsel) dsel.onchange = () => { setDnd(dsel.value); draw(); };
            if (current === 'utenti') loadUsers();
            if (current === 'aggiornamento') loadUpdate();
        }
        // Registrazione di una nuova scorciatoia
        function recordKey(btn) {
            const id = btn.dataset.key;
            btn.textContent = 'Premi i tasti…'; btn.classList.add('rec');
            recordingShortcut = e => {
                e.preventDefault(); e.stopPropagation();
                if (e.key === 'Escape') { recordingShortcut = null; return draw(); }
                if (e.key === 'Delete' || e.key === 'Backspace') { const sc = { ...(S.shortcuts || {}) }; delete sc[id]; setSetting('shortcuts', sc); recordingShortcut = null; return draw(); }
                const c = comboOf(e); if (!c) return;
                if (!/(Ctrl|Alt|Meta)\+/.test(c) && !/^F\d+$/.test(c)) { btn.textContent = 'Usa Ctrl, Alt o ⌘ (oppure un tasto F)'; return; }
                const clash = SHORTCUT_DEFS.find(([o]) => o !== id && shortcutOf(o) === c);
                if (clash) { btn.textContent = `Già usata da «${clash[1]}»`; return; }
                setSetting('shortcuts', { ...(S.shortcuts || {}), [id]: c }); recordingShortcut = null; draw();
            };
        }
        // Gestione utenti (amministratori)
        async function loadUsers() {
            const box = $('#usersBox', body); if (!box) return;
            let users; try { users = await api('GET', '/admin/users'); } catch (e) { box.innerHTML = `<p class="st-note">${esc(e.message)}</p>`; return; }
            box.innerHTML = `${group(`Utenti (${users.length})`, users.map(u => row(
                `<span class="st-user"><span class="st-avatar sm">${esc(u.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span><span><b>${esc(u.name)}</b><small>${esc(u.email)}${u.is_admin ? ' · Amministratore' : ''}${u.email === MARX.user.email ? ' · Tu' : ''}</small></span></span>`,
                u.email === MARX.user.email ? '' : `<button class="btn" data-uact="menu" data-uid="${u.id}">Gestisci…</button>`)))}
                <div class="st-foot"><button class="btn primary" data-uact="add">Aggiungi utente…</button></div>`;
            box.onclick = async e => {
                const b = e.target.closest('[data-uact]'); if (!b) return;
                const u = users.find(x => x.id === +b.dataset.uid);
                if (b.dataset.uact === 'add') {
                    const r = await sheet(win, { title: 'Nuovo utente', ok: 'Crea', text: 'La password viene generata e mostrata una sola volta.', fields: [{ name: 'name', label: 'Nome e cognome' }, { name: 'email', label: 'Email', type: 'email' }, { type: 'checkbox', name: 'is_admin', label: 'Amministratore', value: false }] });
                    if (!r) return;
                    try { const res = await api('POST', '/admin/users', r); showPassword(res.user.name, res.password); loadUsers(); } catch (err) { toast(err.message); }
                }
                if (b.dataset.uact === 'menu') {
                    const rect = b.getBoundingClientRect();
                    contextMenu(rect.left, rect.bottom + 4, [
                        ['Modifica nome ed email…', async () => {
                            const r = await sheet(win, { title: `Modifica ${u.name}`, ok: 'Salva', fields: [{ name: 'name', label: 'Nome', value: u.name }, { name: 'email', label: 'Email', type: 'email', value: u.email }] });
                            if (r) try { await api('PUT', `/admin/users/${u.id}`, r); loadUsers(); } catch (err) { toast(err.message); }
                        }],
                        [u.is_admin ? 'Togli permessi di amministratore' : 'Rendi amministratore', async () => { try { await api('PUT', `/admin/users/${u.id}`, { is_admin: !u.is_admin }); loadUsers(); } catch (err) { toast(err.message); } }],
                        ['Reimposta password…', async () => {
                            const ok = await sheet(win, { title: `Nuova password per ${u.name}?`, text: 'La password attuale smetterà di funzionare.', ok: 'Reimposta', danger: true });
                            if (ok) try { const res = await api('POST', `/admin/users/${u.id}/password`); showPassword(u.name, res.password); } catch (err) { toast(err.message); }
                        }],
                        '-',
                        ['Elimina utente…', async () => {
                            const ok = await sheet(win, { title: `Eliminare ${u.name}?`, text: 'Verranno cancellati anche le sue note e i suoi file. Non si può annullare.', ok: 'Elimina', danger: true });
                            if (ok) try { await api('DELETE', `/admin/users/${u.id}`); playSound('trash'); loadUsers(); } catch (err) { toast(err.message); }
                        }],
                    ]);
                }
            };
        }
        async function loadUpdate(force = false) {
            const box = $('#updBox', body); if (!box) return;
            if (force) box.innerHTML = '<p class="st-note">Controllo in corso…</p>';
            let u; try { u = await api('GET', '/system/update' + (force ? '?force=1' : '')); } catch (e) { box.innerHTML = `<p class="st-note">${esc(e.message)}</p>`; return; }
            updateInfo = u; drawUpdateBadge();
            const when = u.checked_at ? new Date(u.checked_at * 1000).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'mai';
            box.innerHTML = `
                <div class="upd-hero ${u.available ? 'avail' : ''}">
                    <div class="upd-logo"><svg viewBox="0 0 24 24" width="34" height="34"><path d="M3 20V4l9 9 9-9v16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg></div>
                    <div class="upd-txt">${u.available
                        ? `<b>È disponibile MarX ${esc(u.latest.version)}</b><span>Hai la versione ${esc(u.current)}. Prima di aggiornare viene fatto un backup del database; se qualcosa non va, MarX torna da solo alla versione precedente.</span>`
                        : `<b>MarX è aggiornato</b><span>Versione ${esc(u.current)} «${esc(MARX.codename)}» · ultimo controllo: ${when}</span>`}
                        ${u.error ? `<span class="upd-err">${esc(u.error)}</span>` : ''}</div>
                    <div class="upd-acts">${u.available ? `<button class="btn primary" data-uact="apply">Aggiorna ora</button>` : ''}<button class="btn" data-uact="check">Controlla ora</button></div>
                </div>
                ${u.available && u.latest.notes ? `<h4 class="st-gt">Novità di ${esc(u.latest.version)}</h4><div class="st-group upd-notes as-md">${md(u.latest.notes.replace(/^## .*\n/, ''))}</div>` : ''}
                ${u.history.length ? group('Aggiornamenti installati', u.history.map(h => row(`${esc(h.from)} → ${esc(h.to)}`, `<span class="st-muted">${new Date(h.at * 1000).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>`,
                    h.ok ? 'Completato' : `Non riuscito${h.rolled_back ? ' · ripristinata la versione precedente' : ''}: ${esc(h.error || '')}`))) : ''}
                <p class="st-note">Gli aggiornamenti arrivano dalle release pubblicate su github.com/marco-giuseppe-starace/marx e vengono installati solo quando lo decidi tu.</p>`;
            box.onclick = e => {
                const a = e.target.closest('[data-uact]')?.dataset.uact;
                if (a === 'check') loadUpdate(true);
                if (a === 'apply') runUpdate(u.latest);
            };
        }
        function showPassword(name, pw) {
            sheet(win, { title: `Password di ${name}`, text: `${pw}  —  Copiala ora e consegnala all'utente: non verrà più mostrata. Potrà cambiarla dalle sue Impostazioni.`, ok: 'Copia e chiudi', cancel: false })
                .then(() => navigator.clipboard?.writeText(pw).then(() => toast('Password copiata'), () => {}));
        }
        body.addEventListener('click', async e => {
            const kb = e.target.closest('[data-key]'); if (kb) return recordKey(kb);
            const sv = e.target.closest('[data-saver]'); if (sv) { setSetting('screensaverStyle', sv.dataset.saver); return draw(); }
            const t = e.target.closest('[data-sec],[data-theme-pick],[data-accent],[data-wall-pick],[data-act]'); if (!t) return;
            if (t.dataset.sec) return go(t.dataset.sec);
            if (t.dataset.themePick) { setSetting('theme', t.dataset.themePick); return draw(); }
            if (t.dataset.accent) { setSetting('accent', t.dataset.accent); return draw(); }
            if (t.dataset.wallPick) { setSetting('wallpaper', t.dataset.wallPick); return draw(); }
            const act = t.dataset.act;
            if (act === 'cursor-reset') { ['cursorSize', 'cursorFill', 'cursorOutline'].forEach(k => setSetting(k, DEFAULTS[k])); return draw(); }
            if (act === 'mission') missionControl();
            if (act === 'open-nc') toggleNC(true);
            if (act === 'clear-nc') { store.set('notifications', []); draw(); }
            if (act === 'test-notify') toast('Questa è una notifica di prova', { app: 'Impostazioni' });
            if (act === 'play-notify') { try { audioCtx = audioCtx || new AudioContext(); } catch {} playSound('notify'); }
            if (act === 'play') { try { audioCtx = audioCtx || new AudioContext(); } catch {} playSound(t.dataset.snd); }
            if (act === 'saver-preview') startScreensaver();
            if (act === 'keys-reset') { setSetting('shortcuts', {}); draw(); }
            if (act === 'lock') lock();
            if (act === 'logout') logout();
            if (act === 'close-all') [...wins.keys()].filter(k => k !== 'settings').forEach(close);
            if (act === 'reset-pos') { Object.keys(APPS).forEach(k => { try { localStorage.removeItem('marx.win.' + k); } catch {} }); toast('Posizioni ripristinate'); }
            if (act === 'wall-delete') {
                const ok = await sheet(win, { title: 'Rimuovere la tua immagine?', text: 'Tornerà lo sfondo predefinito.', ok: 'Rimuovi', danger: true });
                if (!ok) return;
                try { Object.assign(S, await api('DELETE', '/settings/wallpaper')); delete S.wallpaperVersion; applySettings(); draw(); } catch (err) { toast(err.message); }
            }
        });
        const clockSync = setInterval(() => { if (!body.isConnected) return clearInterval(clockSync); const mb = $('#mbPreview', body); if (mb) mb.textContent = $('#clock').textContent; }, 1000);
        draw();
        return {
            open: go,
            menus: () => ({ Vista: SECTIONS.map(x => [check(x.id === current, x.avatar ? 'Account' : x.name), () => go(x.id)]) }),
        };
    }

    function about(body) {
        body.innerHTML = `<div class="about"><div class="logo"><svg viewBox="0 0 24 24" width="46" height="46"><path d="M3 20V4l9 9 9-9v16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg></div>
            <h2>${esc(MARX.name)}</h2><p>Versione ${esc(MARX.version)} «${esc(MARX.codename)}»</p><p style="margin-top:10px">Basato su Laravel ${esc(MARX.laravel)}</p><p>© ${new Date().getFullYear()} Marco Starace</p></div>`;
    }




    /* ---------- webX: browser a schede dentro MarX ---------- */
    function webx(body, win) {
        const SEARCH = { bing: ['Bing', q => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=it`], wikipedia: ['Wikipedia', q => `https://it.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`] };
        const START = 'webx:start';
        let tabs = [], cur = null, seq = 0;
        const history = () => store.get('webx.history', []);
        const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
        const favicon = u => `https://icons.duckduckgo.com/ip3/${host(u)}.ico`;
        const bookmarks = () => S.webxBookmarks || [];
        const isBookmarked = u => bookmarks().some(b => b.url === u);
        const tab = () => tabs.find(t => t.id === cur);

        body.innerHTML = `<div class="wx">
            <div class="wx-bar">
                <button data-wx="back" title="Indietro" aria-label="Indietro">‹</button><button data-wx="fwd" title="Avanti" aria-label="Avanti">›</button>
                <button data-wx="reload" title="Ricarica" aria-label="Ricarica">↻</button>
                <form class="wx-addr"><span class="wx-lock" aria-hidden="true"></span><input id="wxAddr" placeholder="Cerca con ${SEARCH[S.webxSearch]?.[0] || 'Bing'} o inserisci un indirizzo" autocomplete="off" spellcheck="false" aria-label="Indirizzo"><i class="wx-load"></i></form>
                <button data-wx="star" title="Aggiungi ai preferiti" aria-label="Preferiti">☆</button>
                <button data-wx="external" title="Apri in una nuova scheda del browser" aria-label="Apri fuori da webX">⇱</button>
                <button data-wx="new" title="Nuova scheda" aria-label="Nuova scheda">＋</button>
            </div>
            <div class="wx-tabs"></div>
            <div class="wx-pages"></div></div>`;
        const addr = $('#wxAddr', body), tabsEl = $('.wx-tabs', body), pages = $('.wx-pages', body);

        function toURL(text) {
            const t = text.trim();
            if (!t) return null;
            if (/^https?:\/\//i.test(t)) return t;
            if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !/\s/.test(t)) return 'https://' + t;
            return (SEARCH[S.webxSearch] || SEARCH.bing)[1](t);
        }
        function newTab(url = START, activate = true) {
            const t = { id: ++seq, url: null, title: 'Nuova scheda', hist: [], pos: -1, state: 'start' };
            t.page = document.createElement('div'); t.page.className = 'wx-page'; pages.append(t.page);
            tabs.push(t);
            if (activate) select(t.id);
            go(t, url);
            return t;
        }
        function select(id) {
            cur = id;
            tabs.forEach(t => { t.page.hidden = t.id !== id; });
            drawChrome();
            if (tab().state === 'start') setTimeout(() => $('.wx-start input', tab().page)?.focus(), 50);
        }
        function closeTab(id) {
            const i = tabs.findIndex(t => t.id === id); if (i < 0) return;
            tabs[i].page.remove(); tabs.splice(i, 1);
            if (!tabs.length) return newTab();
            if (cur === id) select(tabs[Math.min(i, tabs.length - 1)].id); else drawChrome();
        }
        // Naviga: pagina iniziale, oppure controllo sul server e poi caricamento diretto nel riquadro
        async function go(t, url, push = true) {
            if (push) { t.hist = t.hist.slice(0, t.pos + 1); t.hist.push(url); t.pos = t.hist.length - 1; }
            t.url = url;
            if (url === START) { t.state = 'start'; t.title = 'Nuova scheda'; renderStart(t); drawChrome(); return; }
            t.state = 'loading'; t.title = host(url); drawChrome();
            let info;
            try { info = await api('GET', '/webx/check?url=' + encodeURIComponent(url)); } catch (e) { info = { frameable: false, reason: 'error', url }; }
            if (t.url !== url) return;  // nel frattempo l'utente è andato altrove
            if (info.url && info.url !== url) { t.url = info.url; t.hist[t.pos] = info.url; }
            t.title = info.title || host(t.url);
            const h = history().filter(x => x.url !== t.url); h.unshift({ url: t.url, title: t.title, t: Date.now() }); store.set('webx.history', h.slice(0, 200));
            if (info.frameable) {
                t.state = 'loading';
                t.page.innerHTML = `<iframe class="wx-frame" src="${esc(t.url)}" title="${esc(t.title)}" referrerpolicy="strict-origin-when-cross-origin"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation"
                    allow="fullscreen; clipboard-write; autoplay; encrypted-media; picture-in-picture"></iframe>`;
                $('iframe', t.page).onload = () => { t.state = 'ready'; drawChrome(); };
                setTimeout(() => { if (t.state === 'loading' && t.url === url) { t.state = 'ready'; drawChrome(); } }, 15000);
            } else { t.state = 'blocked'; renderBlocked(t, info); }
            drawChrome();
        }
        function renderStart(t) {
            const recent = history().slice(0, 8);
            t.page.innerHTML = `<div class="wx-start">
                <div class="wx-logo"><span class="ico ico-webx"></span><h1>webX</h1></div>
                <form class="wx-search"><input placeholder="Cerca con ${esc(SEARCH[S.webxSearch]?.[0] || 'Bing')} o inserisci un indirizzo" aria-label="Cerca"></form>
                <h3>Preferiti</h3>
                <div class="wx-grid">${bookmarks().map((b, i) => `<button class="wx-fav" data-url="${esc(b.url)}" data-bm="${i}" title="${esc(b.url)}"><span><img src="${esc(favicon(b.url))}" alt="" onerror="this.replaceWith(document.createTextNode('${esc(b.title[0] || '?')}'))"></span>${esc(b.title)}</button>`).join('')}</div>
                ${recent.length ? `<h3>Visitati di recente</h3><div class="wx-recent">${recent.map(r => `<button data-url="${esc(r.url)}"><img src="${esc(favicon(r.url))}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(r.title)}</span><small>${esc(host(r.url))}</small></button>`).join('')}</div>` : ''}
                <p class="wx-hint">Alcuni siti (per esempio Google, YouTube, GitHub) non permettono di essere aperti dentro altre pagine: webX te lo segnala e li apre in una nuova scheda del tuo browser.</p></div>`;
            $('.wx-search', t.page).onsubmit = e => { e.preventDefault(); const u = toURL($('input', e.target).value); if (u) go(t, u); };
        }
        function renderBlocked(t, info) {
            const msg = { blocked: `<strong>${esc(host(t.url))}</strong> non permette di essere aperto dentro altre pagine, quindi webX non può mostrarlo qui.`,
                private: 'Per sicurezza webX non apre indirizzi della rete interna del server.',
                invalid: 'L\'indirizzo non è valido. Controlla di averlo scritto bene.',
                unreachable: `Il sito <strong>${esc(host(t.url))}</strong> non risponde. Controlla l'indirizzo o riprova tra poco.`,
                error: 'Non è stato possibile controllare il sito. Riprova tra poco.' }[info.reason] || 'Questa pagina non può essere aperta qui.';
            const canOpen = ['blocked', 'unreachable', 'error'].includes(info.reason);
            t.page.innerHTML = `<div class="wx-blocked"><img src="${esc(favicon(t.url))}" alt="" onerror="this.style.display='none'"><h2>${esc(t.title)}</h2><p>${msg}</p>
                <div class="wx-actions">${canOpen ? `<button class="btn primary" data-wx="external">Apri in una nuova scheda</button>` : ''}<button class="btn" data-wx="back">Torna indietro</button></div>
                <code>${esc(t.url)}</code></div>`;
        }
        function drawChrome() {
            const t = tab(); if (!t) return;
            tabsEl.innerHTML = tabs.map(x => `<div class="wx-tab ${x.id === cur ? 'on' : ''}" data-tab="${x.id}" title="${esc(x.url === START ? 'Nuova scheda' : x.url)}">
                ${x.url && x.url !== START ? `<img src="${esc(favicon(x.url))}" alt="" onerror="this.style.visibility='hidden'">` : '<span class="ico ico-webx"></span>'}<span>${esc(x.title)}</span>
                <button data-close="${x.id}" aria-label="Chiudi scheda">×</button></div>`).join('');
            tabsEl.hidden = tabs.length < 2;
            if (document.activeElement !== addr) addr.value = t.url === START ? '' : t.url || '';
            $('.wx-lock', body).classList.toggle('on', /^https:/.test(t.url || ''));
            $('.wx-load', body).classList.toggle('on', t.state === 'loading');
            $('[data-wx=back]', body).disabled = t.pos <= 0;
            $('[data-wx=fwd]', body).disabled = t.pos >= t.hist.length - 1;
            const star = $('[data-wx=star]', body); star.textContent = isBookmarked(t.url) ? '★' : '☆'; star.disabled = !t.url || t.url === START; star.classList.toggle('on', isBookmarked(t.url));
            $('.titlebar .title', win).textContent = t.url === START ? 'webX' : t.title;
        }
        function toggleBookmark() {
            const t = tab(); if (!t.url || t.url === START) return;
            const list = bookmarks();
            setSetting('webxBookmarks', isBookmarked(t.url) ? list.filter(b => b.url !== t.url) : [...list, { title: (t.title || host(t.url)).slice(0, 200), url: t.url }]);
            toast(isBookmarked(t.url) ? 'Aggiunto ai preferiti' : 'Rimosso dai preferiti');
            drawChrome(); tabs.filter(x => x.state === 'start').forEach(renderStart);
        }
        const external = () => { const t = tab(); if (t.url && t.url !== START) window.open(t.url, '_blank', 'noopener'); };
        const reload = () => { const t = tab(); if (t.url === START) renderStart(t); else go(t, t.url, false); };
        const back = () => { const t = tab(); if (t.pos > 0) { t.pos--; go(t, t.hist[t.pos], false); } };
        const fwd = () => { const t = tab(); if (t.pos < t.hist.length - 1) { t.pos++; go(t, t.hist[t.pos], false); } };

        $('.wx-addr', body).onsubmit = e => { e.preventDefault(); const u = toURL(addr.value); if (u) { go(tab(), u); addr.blur(); } };
        addr.onfocus = () => addr.select();
        body.addEventListener('click', e => {
            const c = e.target.closest('[data-close]'); if (c) { e.stopPropagation(); return closeTab(+c.dataset.close); }
            const tb = e.target.closest('[data-tab]'); if (tb) return select(+tb.dataset.tab);
            const u = e.target.closest('[data-url]'); if (u) return go(tab(), u.dataset.url);
            const a = e.target.closest('[data-wx]')?.dataset.wx;
            ({ back, fwd, reload, star: toggleBookmark, external, new: () => newTab() }[a] || (() => {}))();
        });
        tabsEl.addEventListener('auxclick', e => { const tb = e.target.closest('[data-tab]'); if (tb && e.button === 1) closeTab(+tb.dataset.tab); });
        body.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (e.key === 'l') { e.preventDefault(); addr.focus(); }
            if (e.key === 't' && e.altKey) { e.preventDefault(); newTab(); }
        });
        newTab();
        return {
            openURL: text => { const u = toURL(text); if (!u) return; const t = tab(); t.state === 'start' ? go(t, u) : newTab(u); },
            prefs: async () => {
                const r = await sheet(win, { title: 'Impostazioni webX', ok: 'Salva', fields: [
                    { type: 'select', name: 'webxSearch', label: 'Motore di ricerca', value: S.webxSearch, options: Object.entries(SEARCH).map(([k, v]) => [k, v[0]]) },
                ] });
                if (r) { setSetting('webxSearch', r.webxSearch); addr.placeholder = `Cerca con ${SEARCH[r.webxSearch][0]} o inserisci un indirizzo`; tabs.filter(x => x.state === 'start').forEach(renderStart); }
            },
            context: e => {
                const tb = e.target.closest('[data-tab]');
                if (tb) { const id = +tb.dataset.tab, t = tabs.find(x => x.id === id); return [['Nuova scheda', () => newTab()], ['Duplica scheda', () => newTab(t.url)], '-', ['Chiudi scheda', () => closeTab(id)], ['Chiudi le altre schede', () => tabs.filter(x => x.id !== id).forEach(x => closeTab(x.id))]]; }
                const fav = e.target.closest('[data-bm]');
                if (fav) { const i = +fav.dataset.bm; return [['Apri', () => go(tab(), bookmarks()[i].url)], ['Apri in una nuova scheda', () => newTab(bookmarks()[i].url)], '-', ['Rimuovi dai preferiti', () => { setSetting('webxBookmarks', bookmarks().filter((_, j) => j !== i)); renderStart(tab()); }]]; }
                return [['Indietro', tab().pos > 0 && back], ['Avanti', tab().pos < tab().hist.length - 1 && fwd], ['Ricarica', reload], '-', ['Nuova scheda', () => newTab()], ['Apri fuori da webX', tab().url !== START && external]];
            },
            menus: () => {
                const t = tab(), h = history().slice(0, 12);
                return {
                    File: [['Nuova scheda', () => newTab(), '⌥⌘T'], ['Chiudi scheda', () => closeTab(cur), '', tabs.length < 2], '-', ['Apri fuori da webX', t.url !== START && external], '-', ['Chiudi finestra', () => close('webx'), '⌘W']],
                    Vista: [['Ricarica pagina', reload, '⌘R'], ['Pagina iniziale', () => go(t, START)], '-', ['Vai all\'indirizzo', () => addr.focus(), '⌘L']],
                    Cronologia: [['Indietro', t.pos > 0 && back, '⌘['], ['Avanti', t.pos < t.hist.length - 1 && fwd, '⌘]'], '-',
                        ...(h.length ? h.map(x => [x.title.slice(0, 50), () => go(tab(), x.url)]) : [['Nessuna pagina visitata', null]]), '-',
                        ['Cancella cronologia', h.length && (() => { store.set('webx.history', []); tabs.filter(x => x.state === 'start').forEach(renderStart); toast('Cronologia cancellata'); })]],
                    Preferiti: [[isBookmarked(t.url) ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti', t.url !== START && toggleBookmark, '⌘D'], '-',
                        ...bookmarks().map(b => [b.title.slice(0, 50), () => go(tab(), b.url)])],
                };
            },
        };
    }

    /* ---------- App installate dal Soft Store ---------- */
    function webApp(app) {
        return {
            name: app.name, iconUrl: app.icon, url: app.url, web: true, w: 1100, h: 700,
            render: (body, win) => {
                body.innerHTML = `<iframe class="webapp" src="${esc(app.url)}" title="${esc(app.name)}" allow="clipboard-read; clipboard-write; fullscreen"></iframe>`;
                const frame = $('iframe', body);
                return {
                    menus: () => ({ File: [['Ricarica', () => { frame.src = app.url; }, '⌘R'], ['Apri in una nuova scheda', () => window.open(app.url, '_blank', 'noopener')], '-', ['Chiudi finestra', () => close('app-' + app.id), '⌘W']] }),
                };
            },
        };
    }
    async function loadWebApps() {
        try {
            const list = await api('GET', '/appstore/installed');
            Object.keys(APPS).filter(k => APPS[k].web).forEach(k => { if (!wins.has(k)) delete APPS[k]; });
            list.filter(a => a.status === 'installed').forEach(a => { APPS['app-' + a.id] = webApp(a); });
            updateDock();
        } catch {}
    }

    // Markdown essenziale: titoli, grassetto, corsivo, codice, link, elenchi. Tutto il testo viene escapato prima.
    function md(src) {
        const inline = t => esc(t)
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        const out = []; let list = null, para = [];
        const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } if (list) { out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; } };
        for (const raw of src.replace(/<[^>]+>/g, '').split('\n')) {
            const line = raw.trimEnd();
            let m;
            if (!line.trim()) { flush(); continue; }
            if ((m = /^(#{1,6})\s+(.*)/.exec(line))) { flush(); out.push(`<h4>${inline(m[2])}</h4>`); continue; }
            if ((m = /^\s*[-*+]\s+(.*)/.exec(line))) { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } (list ||= []).push(m[1]); continue; }
            if (list) flush();
            para.push(line.trim());
        }
        flush();
        return out.join('');
    }

    /* ---------- Soft Store ---------- */
    function appstore(body, win) {
        let cat = [], inst = {}, view = 'discover', detail = null, loading = true, query = '';
        // Ricerca senza accenti e maiuscole: «produttivita» trova «Produttività»
        const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const matches = a => norm([a.name, a.summary, a.description, a.author, ...(a.categories || [a.category])].join(' ')).includes(norm(query.trim()));
        const inCat = (a, c) => (a.categories || [a.category]).includes(c);
        const descs = {}; // descrizioni lunghe già scaricate
        const running = {}; // app -> {progress, step, kind}
        async function refresh() {
            try {
                const [c, i] = await Promise.all([api('GET', '/appstore/catalog'), api('GET', '/appstore/installed')]);
                cat = c; inst = Object.fromEntries(i.map(a => [a.id, a])); loading = false; draw();
            } catch (e) { loading = false; body.innerHTML = `<div class="as-empty">${esc(e.message)}</div>`; }
        }
        const isInstalled = id => inst[id]?.status === 'installed';
        const card = a => `<div class="as-card ${a.installable ? '' : 'blocked'}" data-act="detail" data-id="${a.id}" tabindex="0">
            <img src="${esc(a.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><div class="as-info"><strong>${esc(a.name)}</strong><span>${esc(a.summary)}</span></div>${button(a)}</div>`;
        async function openDetail(id) {
            detail = id; draw(); $('.as-main', body)?.scrollTo(0, 0);
            const a = cat.find(x => x.id === id);
            if (a?.source === 'community' && descs[id] === undefined) {
                try { descs[id] = await api('GET', `/appstore/${id}/describe`) || ''; } catch { descs[id] = ''; }
                if (detail === id) { const el = $('#asDesc', body); if (el && descs[id]) el.innerHTML = md(descs[id]); }
            }
        }
        async function refreshStore() {
            toast('Scarico il catalogo aggiornato…');
            try { const r = await api('POST', '/appstore/refresh'); toast(`Catalogo aggiornato: ${r.count} app dalla community`); await refresh(); } catch (e) { toast(e.message); }
        }
        const button = a => {
            const j = running[a.id];
            if (j) return `<div class="as-progress" title="${esc(j.step)}"><i style="width:${j.progress}%"></i></div>`;
            if (isInstalled(a.id)) return `<button class="as-btn" data-act="open" data-id="${a.id}">Apri</button>`;
            if (inst[a.id]?.status === 'error') return `<button class="as-btn warn" data-act="detail" data-id="${a.id}">Errore</button>`;
            if (!a.installable) return `<button class="as-btn off" data-act="detail" data-id="${a.id}" title="${esc(a.blocked_reason)}">Non compatibile</button>`;
            return `<button class="as-btn" data-act="install" data-id="${a.id}">${inst[a.id]?.status === 'removed-keep-data' ? 'Reinstalla' : 'Installa'}</button>`;
        };
        function draw() {
            const cats = [...new Set(cat.flatMap(a => a.categories || [a.category]))].sort((x, y) => x.localeCompare(y, 'it'));
            const nInst = cat.filter(a => isInstalled(a.id)).length;
            const side = `<aside class="sidebar as-side">
                <div class="as-search"><input id="asSearch" type="search" placeholder="Cerca" value="${esc(query)}" aria-label="Cerca app" autocomplete="off"></div>
                <button class="${view === 'discover' && !detail && !query.trim() ? 'active' : ''}" data-view="discover"><span class="dot"></span>Scopri</button>
                <button class="${view === 'installed' && !detail && !query.trim() ? 'active' : ''}" data-view="installed"><span class="dot" style="background:#28c840"></span>Installate <small>${nInst}</small></button>
                <h4>Categorie</h4>${cats.map(c => `<button class="${view === c && !detail && !query.trim() ? 'active' : ''}" data-view="${esc(c)}"><span class="dot" style="background:#8e8e93"></span>${esc(c)}</button>`).join('')}</aside>`;
            let main;
            if (loading) main = `<div class="as-empty">Caricamento del catalogo…</div>`;
            else if (detail) main = detailView(cat.find(a => a.id === detail));
            else {
                const searching = query.trim() !== '';
                const byName = (x, y) => (y.installable - x.installable) || x.name.localeCompare(y.name, 'it');
                const list = (searching ? cat.filter(matches) : view === 'installed' ? cat.filter(a => isInstalled(a.id) || running[a.id]) : cat.filter(a => inCat(a, view))).sort(byName);
                const title = searching ? `Risultati per «${query.trim()}»` : view === 'discover' ? 'Scopri' : view === 'installed' ? 'App installate' : view;
                const grid = l => `<div class="as-grid">${l.map(card).join('')}</div>`;
                const nOk = cat.filter(a => a.installable).length;
                let content;
                if (view === 'discover' && !searching) {
                    const mine = cat.filter(a => a.source === 'marx'), comm = cat.filter(a => a.source !== 'marx').sort(byName);
                    content = `<p class="as-sub">${nOk} app pronte da installare sul tuo server con un clic. Ognuna ha il suo indirizzo e i suoi limiti di memoria.</p>
                        <h3 class="as-sec">Selezionate da MarX</h3>${grid(mine)}
                        <h3 class="as-sec">Dalla community <small>${comm.length} app · catalogo Runtipi</small></h3>${grid(comm)}`;
                } else content = list.length ? grid(list) : `<div class="as-empty">${searching ? 'Nessuna app trovata. Prova con un\'altra parola, ad esempio «file», «foto» o «password».' : view === 'installed' ? 'Nessuna app installata.' : 'Nessuna app.'}</div>`;
                main = `<div class="as-main"><h2>${esc(title)}${searching ? ` <small class="as-count">${list.length}</small>` : ''}</h2>${content}</div>`;
            }
            // Ridisegnare la pagina non deve far perdere il cursore nel campo di ricerca
            const hadFocus = document.activeElement?.id === 'asSearch' && body.contains(document.activeElement);
            const caret = hadFocus ? document.activeElement.selectionStart : null;
            body.innerHTML = `<div class="finder as-wrap">${side}${main}</div>`;
            const input = $('#asSearch', body);
            if (hadFocus) { input.focus(); input.setSelectionRange(caret, caret); }
            input.oninput = () => { query = input.value; detail = null; draw(); };
            input.onkeydown = e => {
                if (e.key === 'Escape' && query) { e.stopPropagation(); query = ''; draw(); $('#asSearch', body).focus(); }
                if (e.key === 'Enter') { const first = $('.as-card', body); if (first) openDetail(first.dataset.id); }
            };
        }
        function detailView(a) {
            const i = inst[a.id], j = running[a.id];
            const installed = isInstalled(a.id);
            const ctr = i?.containers || [];
            return `<div class="as-main as-detail">
                <button class="as-back" data-act="back">‹ Indietro</button>
                <header><img src="${esc(a.icon)}" alt=""><div><h2>${esc(a.name)}</h2><span class="as-sub">${esc(a.category)}</span></div><div class="as-head-act">${button(a)}</div></header>
                ${j ? `<p class="as-step">${esc(j.step)}</p>` : ''}
                ${i?.status === 'error' ? `<div class="as-note err"><strong>L'ultima operazione non è riuscita.</strong><br><code>${esc(i.error)}</code></div>` : ''}
                ${!a.installable ? `<div class="as-note err"><strong>Non installabile su MarX.</strong> Per sicurezza MarX non concede a questa app ciò che chiede: ${esc(a.blocked_reason)}.</div>` : ''}
                ${a.source === 'community' ? `<div class="as-md" id="asDesc">${descs[a.id] !== undefined ? (descs[a.id] ? md(descs[a.id]) : `<p>${esc(a.description)}</p>`) : `<p>${esc(a.description)}</p>`}</div>` : `<p>${esc(a.description)}</p>`}
                <div class="as-facts"><div><span>Memoria massima</span><strong>${esc(a.mem.replace('m', ' MB').replace('g', ' GB'))}</strong></div><div><span>CPU massima</span><strong>${esc(a.cpus)} core</strong></div>
                    <div><span>Indirizzo</span><strong>${esc(a.id)}.marx.marcostarace.it</strong></div>
                    ${a.version ? `<div><span>Versione</span><strong>${esc(a.version)}</strong></div>` : ''}
                    ${a.source === 'community' ? `<div><span>Fonte</span><strong>Community${a.author ? ' · ' + esc(a.author) : ''}</strong></div>` : ''}
                    ${a.website ? `<div><span>Sito del progetto</span><strong><a href="${esc(a.website)}" target="_blank" rel="noopener">${esc(a.website.replace(/^https?:\/\//, '').slice(0, 40))}</a></strong></div>` : ''}</div>
                ${a.source === 'community' && a.installable ? `<p class="as-sub">App della community: la ricetta è stata controllata da MarX (dati nella sua cartella, nessun accesso al sistema, porte solo interne). Al primo avvio potrebbe chiederti di creare un account.</p>` : ''}
                ${a.first_run ? `<div class="as-note"><strong>Primo accesso</strong><br>${esc(a.first_run)}</div>` : ''}
                ${installed ? `<h3>Gestione</h3>
                    <p class="as-sub">Stato: <span class="pill ${i.running ? 'on' : 'off'}">${i.running ? 'In esecuzione' : 'Fermata'}</span> · <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.url)}</a></p>
                    <div class="as-actions">
                        ${i.running ? `<button class="btn" data-act="stop" data-id="${a.id}">Ferma</button>` : `<button class="btn" data-act="start" data-id="${a.id}">Avvia</button>`}
                        <button class="btn" data-act="restart" data-id="${a.id}">Riavvia</button>
                        <button class="btn" data-act="update" data-id="${a.id}">Aggiorna</button>
                        <button class="btn" data-act="logs" data-id="${a.id}">Log</button>
                        <button class="btn danger" data-act="uninstall" data-id="${a.id}">Disinstalla…</button></div>
                    ${ctr.length ? `<p class="as-sub">${ctr.map(c => `${esc(c.name)}: ${esc(c.mem || '—')} · CPU ${esc(c.cpu || '—')}`).join('<br>')}</p>` : ''}`
                : i?.status === 'removed-keep-data' ? `<div class="as-note">I dati di una precedente installazione sono conservati: reinstallando li ritrovi.
                    <br><button class="btn danger" style="margin-top:8px" data-act="purge" data-id="${a.id}">Elimina i dati conservati…</button></div>`
                : i?.status === 'error' ? `<div class="as-actions"><button class="btn danger" data-act="purge" data-id="${a.id}">Rimuovi l'installazione non riuscita</button></div>` : ''}
            </div>`;
        }
        async function track(jid, id, kind) {
            const name = cat.find(a => a.id === id)?.name || id;
            running[id] = { progress: 2, step: 'In coda…', kind }; draw();
            for (;;) {
                await new Promise(r => setTimeout(r, 1200));
                let j; try { j = await api('GET', '/appstore/jobs/' + jid); } catch (e) { toast(e.message); continue; }
                running[id] = { progress: j.progress, step: j.step, kind };
                if (body.isConnected) {
                    const bar = body.querySelector(`.as-progress i`); const st = body.querySelector('.as-step');
                    if (detail === id && st) st.textContent = j.step;
                    draw();
                }
                if (j.done) {
                    delete running[id];
                    if (j.error) { toast(`${name}: ${j.error.slice(0, 160)}`); }
                    else toast({ install: `${name} è installata`, uninstall: `${name} è stata disinstallata`, update: `${name} è aggiornata` }[kind] || 'Fatto');
                    await refresh(); await loadWebApps();
                    if (!j.error && kind === 'install') open('app-' + id);
                    return;
                }
            }
        }
        async function install(id) {
            const a = cat.find(x => x.id === id);
            const ask = (a.params || []).filter(p => !p.generate);
            let params = {};
            if (ask.length && inst[id]?.status !== 'removed-keep-data') {
                const type = { password: 'password', email: 'email', url: 'url', number: 'number', boolean: 'checkbox' };
                const r = await sheet(win, { title: `Installa ${a.name}`, ok: 'Installa', text: 'Compila i campi richiesti dall\'app. Le chiavi segrete vengono generate da sole.',
                    fields: ask.map(p => ({ name: p.key, label: p.label + (p.required ? ' *' : '') + (p.min && p.type !== 'number' ? ` (min. ${p.min} caratteri)` : ''), type: type[p.type] || 'text',
                        value: p.type === 'boolean' ? String(p.default) === 'true' : (p.default ?? '') })) });
                if (!r) return;
                params = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v]));
            } else {
                const r = await sheet(win, { title: `Installare ${a.name}?`, text: `Userà al massimo ${a.mem.replace('m', ' MB').replace('g', ' GB')} di memoria. Sarà disponibile su ${a.id}.marx.marcostarace.it`, ok: 'Installa' });
                if (!r) return;
            }
            try { const { job } = await api('POST', `/appstore/${id}/install`, { params }); track(job, id, 'install'); } catch (e) { toast(e.message); }
        }
        async function uninstall(id, purge = false) {
            const a = cat.find(x => x.id === id);
            let keep = false;
            if (purge) {
                const r = await sheet(win, { title: `Eliminare i dati di ${a.name}?`, text: 'Tutti i dati dell\'app verranno cancellati definitivamente.', ok: 'Elimina', danger: true });
                if (!r) return;
            } else {
                const r = await sheet(win, { title: `Disinstallare ${a.name}?`, ok: 'Disinstalla', danger: true,
                    fields: [{ type: 'checkbox', name: 'wipe', label: 'Elimina anche tutti i dati (non si può annullare)', value: false }] });
                if (!r) return; keep = !r.wipe;
            }
            if (wins.has('app-' + id)) close('app-' + id);
            try { const { job } = await api('DELETE', `/appstore/${id}`, { keep_data: keep }); track(job, id, 'uninstall'); } catch (e) { toast(e.message); }
        }
        async function action(id, act) {
            if (act === 'update') { try { const { job } = await api('POST', `/appstore/${id}/update`); track(job, id, 'update'); } catch (e) { toast(e.message); } return; }
            const labels = { start: 'Avvio', stop: 'Arresto', restart: 'Riavvio' };
            running[id] = { progress: 50, step: labels[act] + '…' }; draw();
            try { await api('POST', `/appstore/${id}/${act}`); } catch (e) { toast(e.message); }
            delete running[id]; await refresh();
        }
        async function logs(id) {
            const a = cat.find(x => x.id === id);
            try {
                const text = await api('GET', `/appstore/${id}/logs`);
                APPS.logs = { name: `Log · ${a.name}`, icon: 'doc', w: 820, h: 520, hidden: true, render: b => { b.innerHTML = `<pre class="logview">${esc(text || 'Nessun log.')}</pre>`; const pre = $('pre', b); pre.scrollTop = pre.scrollHeight; } };
                if (wins.has('logs')) { wins.get('logs').remove(); wins.delete('logs'); }
                open('logs');
            } catch (e) { toast(e.message); }
        }
        body.addEventListener('click', e => {
            const v = e.target.closest('[data-view]'); if (v) { view = v.dataset.view; detail = null; query = ''; return draw(); }
            const el = e.target.closest('[data-act]'); if (!el) return;
            const id = el.dataset.id, act = el.dataset.act;
            if (el.tagName === 'BUTTON' && el.closest('.as-card')) e.stopPropagation();
            ({ detail: () => openDetail(id), back: () => { detail = null; draw(); }, open: () => open('app-' + id), install: () => install(id),
               uninstall: () => uninstall(id), purge: () => uninstall(id, true), logs: () => logs(id),
               start: () => action(id, 'start'), stop: () => action(id, 'stop'), restart: () => action(id, 'restart'), update: () => action(id, 'update') }[act] || (() => {}))();
        });
        body.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('as-card')) openDetail(e.target.dataset.id); });
        draw(); refresh();
        return {
            menus: () => ({
                File: [['Cerca…', () => $('#asSearch', body)?.focus(), '⌘F'], ['Aggiorna elenco', refresh, '⌘R'], ['Scarica catalogo aggiornato dalla community', refreshStore], '-', ['Chiudi finestra', () => close('appstore'), '⌘W']],
                Vista: [['Scopri', () => { view = 'discover'; detail = null; draw(); }], ['App installate', () => { view = 'installed'; detail = null; draw(); }]],
            }),
        };
    }

    /* ---------- Monitoraggio Attività ---------- */
    function activity(body, win) {
        const hist = { cpu: [], mem: [] };
        let timer = null, last = null, sortBy = 'mem';
        const gb = b => (b / 1073741824).toFixed(1).replace('.', ',') + ' GB';
        const parseMem = s => { const m = /([\d.]+)\s*([KMG]i?B)/.exec(s || ''); if (!m) return 0; return +m[1] * { KiB: 1 / 1024, MiB: 1, GiB: 1024, KB: 1 / 1000, MB: 1, GB: 1000 }[m[2]]; };
        const spark = (arr, color) => {
            if (arr.length < 2) return '<svg class="spark"></svg>';
            const pts = arr.map((v, i) => `${(i / 59) * 200},${40 - (v / 100) * 38}`).join(' ');
            return `<svg class="spark" viewBox="0 0 200 40" preserveAspectRatio="none"><polygon points="0,40 ${pts} ${((arr.length - 1) / 59) * 200},40" fill="${color}" opacity=".18"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
        };
        function draw() {
            if (!last) { body.innerHTML = '<div class="as-empty">Lettura dei dati…</div>'; return; }
            const s = last.system, memUsed = s.mem_total - s.mem_available, diskUsed = s.disk_total - s.disk_free;
            const memP = memUsed / s.mem_total * 100, diskP = diskUsed / s.disk_total * 100;
            const up = s.uptime, upTxt = up > 86400 ? `${Math.floor(up / 86400)} g ${Math.floor(up % 86400 / 3600)} h` : `${Math.floor(up / 3600)} h ${Math.floor(up % 3600 / 60)} min`;
            const rows = last.apps.filter(a => a.status === 'installed').map(a => {
                const cpu = a.containers.reduce((t, c) => t + (parseFloat(c.cpu) || 0), 0);
                const mem = a.containers.reduce((t, c) => t + parseMem(c.mem), 0);
                return { ...a, cpu, mem };
            }).sort((x, y) => sortBy === 'name' ? x.name.localeCompare(y.name) : y[sortBy] - x[sortBy]);
            const totMem = rows.reduce((t, r) => t + r.mem, 0);
            body.innerHTML = `<div class="am">
                <div class="am-tiles">
                    <div class="am-tile"><span>CPU</span><strong>${s.cpu.toFixed(0)}%</strong><small>${s.cores} core · carico ${s.load.join(' ')}</small>${spark(hist.cpu, '#0a84ff')}</div>
                    <div class="am-tile"><span>Memoria</span><strong>${gb(memUsed)}</strong><small>su ${gb(s.mem_total)} · ${memP.toFixed(0)}%</small>${spark(hist.mem, '#28c840')}</div>
                    <div class="am-tile"><span>Disco</span><strong>${gb(diskUsed)}</strong><small>su ${gb(s.disk_total)} · liberi ${gb(s.disk_free)}</small><div class="am-bar"><i style="width:${diskP}%"></i></div></div>
                    <div class="am-tile"><span>Acceso da</span><strong>${upTxt}</strong><small>App Docker: ${rows.length} · ${totMem.toFixed(0)} MB</small></div>
                </div>
                <div class="am-table-wrap"><table class="am-table"><thead><tr>
                    <th data-sort="name">App</th><th>Stato</th><th data-sort="cpu" class="num">CPU</th><th data-sort="mem" class="num">Memoria</th><th class="num">Limite</th><th class="num">Rete (in / out)</th></tr></thead>
                    <tbody>${rows.length ? rows.map(r => `<tr><td><img src="${esc(r.icon)}" alt="">${esc(r.name)}</td>
                        <td><span class="pill ${r.running ? 'on' : 'off'}">${r.running ? 'Attiva' : 'Ferma'}</span></td>
                        <td class="num">${r.running ? r.cpu.toFixed(1) + '%' : '—'}</td><td class="num">${r.running ? r.mem.toFixed(0) + ' MB' : '—'}</td>
                        <td class="num">${esc((r.mem_limit || '').replace('m', ' MB').replace('g', ' GB'))}</td><td class="num">${esc(r.containers[0]?.net || '—')}</td></tr>`).join('')
                        : '<tr><td colspan="6" class="as-empty">Nessuna app installata dal Soft Store.</td></tr>'}</tbody></table></div>
                <p class="as-sub">Aggiornamento ogni 3 secondi. I valori riguardano tutto il server, compresi gli altri siti.</p></div>`;
            body.querySelectorAll('[data-sort]').forEach(th => { th.classList.toggle('sorted', th.dataset.sort === sortBy); th.onclick = () => { sortBy = th.dataset.sort; draw(); }; });
        }
        async function tick() {
            if (!body.isConnected) return clearInterval(timer);
            if (win.hidden) return;
            try {
                last = await api('GET', '/system/stats');
                hist.cpu.push(last.system.cpu); hist.mem.push((last.system.mem_total - last.system.mem_available) / last.system.mem_total * 100);
                hist.cpu = hist.cpu.slice(-60); hist.mem = hist.mem.slice(-60);
                draw();
            } catch (e) { if (!last) body.innerHTML = `<div class="as-empty">${esc(e.message)}</div>`; }
        }
        draw(); tick(); timer = setInterval(tick, 3000);
        return {
            menus: () => ({
                Vista: [[check(sortBy === 'mem', 'Ordina per memoria'), () => { sortBy = 'mem'; draw(); }], [check(sortBy === 'cpu', 'Ordina per CPU'), () => { sortBy = 'cpu'; draw(); }], [check(sortBy === 'name', 'Ordina per nome'), () => { sortBy = 'name'; draw(); }]],
            }),
        };
    }

    function launchpad() {
        if ($('.launchpad')) return $('.launchpad').remove();
        const lp = document.createElement('div');
        lp.className = 'launchpad';
        const list = Object.entries(APPS).filter(([, a]) => !a.special && !a.hidden);
        lp.innerHTML = `<input placeholder="Cerca" aria-label="Cerca app"><div class="lp-grid">${list.map(([k, a]) => `<button data-open="${k}">${icoHTML(a)}${esc(a.name)}</button>`).join('')}</div>`;
        document.body.append(lp);
        const inp = $('input', lp); inp.focus();
        inp.oninput = () => lp.querySelectorAll('.lp-grid button').forEach(b => b.hidden = !b.textContent.toLowerCase().includes(inp.value.toLowerCase()));
        lp.addEventListener('click', e => { if (e.target === lp || e.target.closest('[data-open]')) lp.remove(); });
    }

    /* ---------- Menu ---------- */
    const ctlOf = id => wins.get(id)?.ctl || {};
    function appInfo(id) {
        const a = APPS[id], w = wins.get(id); if (!w) return;
        sheet(w, { title: a.name, text: `App di ${MARX.name} · versione ${MARX.version}`, ok: 'OK', cancel: false });
    }
    function openSettings(section) { open('settings'); ctlOf('settings').open?.(section); }
    function wallNext() { const n = ((+S.wallpaper || 0) % Object.keys(WALLPAPERS).length) + 1; setSetting('wallpaper', String(n)); }
    const theme = () => S.theme;
    const STD = {
        File: () => [['Nuova finestra Finder', () => open('finder'), '⌘N'], ['Nuova nota', () => open('notes')], '-', ['Chiudi finestra', active && (() => close(active)), '⌘W']],
        Modifica: () => [['Annulla', () => document.execCommand('undo'), '⌘Z'], ['Ripeti', () => document.execCommand('redo'), '⇧⌘Z'], '-',
            ['Taglia', () => document.execCommand('cut'), '⌘X'], ['Copia', () => document.execCommand('copy'), '⌘C'], ['Incolla', null, '⌘V'], '-',
            ['Seleziona tutto', () => document.execCommand('selectAll'), '⌘A']],
        Vista: () => [[check(theme() === 'light', 'Modalità chiara'), () => setTheme('light')], [check(theme() === 'dark', 'Modalità scura'), () => setTheme('dark')], [check(theme() === 'auto', 'Automatica'), () => setTheme('auto')]],
        Finestra: () => [['Riduci', active && (() => minimize(active)), '⌘M'], ['Ingrandisci', active && !APPS[active].fixed && (() => maximize(active))], '-',
            ['Affianca a sinistra', active && !APPS[active].fixed && (() => snapTo(active, 'left')), '⌃⌥←'], ['Affianca a destra', active && !APPS[active].fixed && (() => snapTo(active, 'right')), '⌃⌥→'],
            ['Riempi', active && !APPS[active].fixed && (() => snapTo(active, 'full')), '⌃⌥↑'], ['Centra', active && !APPS[active].fixed && (() => snapTo(active, 'center')), '⌃⌥↓'], '-',
            ['Mission Control', () => missionControl(), 'F3'], [check(S.stageManager, 'Stage Manager'), () => setSetting('stageManager', !S.stageManager)], '-',
            ...[...Array(spaces.count).keys()].filter(i => i !== spaces.current).map(i => [`Sposta su Scrivania ${i + 1}`, active && (() => moveToSpace(active, i))]),
            ['Sposta su nuova scrivania', active && (() => { addSpace(); moveToSpace(active, spaces.count - 1); })], '-',
            ...[...wins.keys()].map(k => [check(k === active, APPS[k].name), () => { wins.get(k).hidden = false; focus(k); }]),
            ...(wins.size ? ['-'] : []), ['Chiudi tutte', wins.size && (() => [...wins.keys()].forEach(close))]],
        Aiuto: () => [['Ricerca Spotlight', () => spotlight(), '⌘K'], ['Scorciatoie da tastiera', showShortcuts], '-', ['Info su MarX', () => open('about')]],
    };
    function appMenus() {
        const extra = active ? ctlOf(active).menus?.() || {} : {};
        const order = ['File', 'Modifica', 'Vista', ...Object.keys(extra).filter(k => !STD[k]), 'Finestra', 'Aiuto'];
        return Object.fromEntries(order.map(k => [k, extra[k] || STD[k]()]));
    }
    function menuFor(key) {
        if (key === 'system') return [['Info su MarX', () => open('about')], '-', ['Impostazioni di sistema…', () => open('settings')],
            ...(updateInfo?.available ? [[`Aggiornamento disponibile: ${updateInfo.latest.version}`, () => openSettings('aggiornamento')]] : []), '-', ['Blocca schermo', () => lock(), '⌃⌘Q'], [`Esci da ${MARX.user.name}…`, logout, '⇧⌘Q']];
        if (key === 'user') return [[MARX.user.email, null], '-', ['Impostazioni account…', () => openSettings('account')], ['Blocca schermo', () => lock()], ['Esci', logout]];
        if (key === 'appname') {
            if (!active) return [['Info su Finder', () => open('about')], '-', ['Impostazioni Finder…', () => { open('finder'); ctlOf('finder').prefs?.(); }, '⌘,'], '-', ['Impostazioni di sistema…', () => open('settings')]];
            const n = APPS[active].name, c = ctlOf(active), id = active;
            return [[`Info su ${n}`, () => appInfo(id)], '-', [`Impostazioni ${n}…`, c.prefs, '⌘,'], '-',
                [`Nascondi ${n}`, () => minimize(id), '⌘H'], ['Nascondi le altre', () => wins.forEach((w, k) => k !== id && minimize(k))], '-', [`Esci da ${n}`, () => close(id), '⌘Q']];
        }
        return appMenus()[key] || [];
    }
    function renderMenubar() {
        $('#activeAppName').textContent = active ? APPS[active].name : 'Finder';
        $('#appMenus').innerHTML = Object.keys(appMenus()).map(k => `<button class="menu-item" data-menu="${esc(k)}">${esc(k)}</button>`).join('');
    }
    function dockMenu(id) {
        const a = APPS[id], running = wins.has(id);
        if (id === 'launchpad') return [['Apri Launchpad', launchpad]];
        if (id === 'trash') return [['Apri', () => open('trash')], '-', ['Svuota il Cestino…', async () => {
            open('trash'); const w = wins.get('finder');
            const ok = await sheet(w, { title: 'Svuotare il Cestino?', text: 'Gli elementi verranno eliminati definitivamente. Non si può annullare.', ok: 'Svuota', danger: true });
            if (ok) try { const r = await api('DELETE', '/files/trash', {}); playSound('trash'); setTrashFull(r.trash); filesChanged(); } catch (e) { toast(e.message); }
        }]];
        if (a.web) {
            const pins = store.get('dockPins', []), pinned = pins.includes(id);
            return [[a.name, null], '-', running ? ['Mostra', () => open(id)] : ['Apri', () => open(id)],
                ['Apri in una nuova scheda', () => window.open(a.url, '_blank', 'noopener')],
                [pinned ? 'Togli dal Dock' : 'Mantieni nel Dock', () => { store.set('dockPins', pinned ? pins.filter(x => x !== id) : [...pins, id]); updateDock(); }],
                ...(running ? ['-', ['Esci', () => close(id)]] : [])];
        }
        return [[a.name, null], '-', running ? ['Mostra', () => open(id)] : ['Apri', () => open(id)],
            ...(running ? [['Nascondi', () => minimize(id)], ['Impostazioni…', ctlOf(id).prefs && (() => { open(id); ctlOf(id).prefs(); })], '-', ['Esci', () => close(id)]] : [])];
    }
    // Tasto destro su tutta l'interfaccia (i campi di testo mantengono il menu del browser per copia/incolla)
    document.addEventListener('contextmenu', e => {
        if (e.defaultPrevented) return;
        const t = e.target;
        if (t.closest('input, textarea, [contenteditable], .lockscreen')) return;
        e.preventDefault();
        let items = null;
        const dock = t.closest('.dock-item'), desk = t.closest('.desk-icon'), win = t.closest('.window');
        if (dock) items = dockMenu(dock.dataset.open);
        else if (desk && !desk.dataset.open) return;
        else if (desk) items = [['Apri', () => open(desk.dataset.open)], '-', ['Ottieni informazioni', () => toast(`${desk.textContent.trim()} · ${APPS[desk.dataset.open].name}`)]];
        else if (win) {
            const id = [...wins.entries()].find(([, w]) => w === win)?.[0]; if (!id) return;
            focus(id);
            if (t.closest('.titlebar')) items = [['Riduci', () => minimize(id)], ['Ingrandisci', !APPS[id].fixed && (() => maximize(id))], '-', [`Impostazioni ${APPS[id].name}…`, ctlOf(id).prefs], '-', ['Chiudi', () => close(id)]];
            else {
                items = ctlOf(id).context?.(e);
                if (!items) {
                    const first = Object.values(ctlOf(id).menus?.() || {})[0];
                    items = [...(first || [['Chiudi finestra', () => close(id)]])];
                    if (ctlOf(id).prefs) items.push('-', [`Impostazioni ${APPS[id].name}…`, ctlOf(id).prefs]);
                }
            }
        } else if (t.closest('.menubar, .dock-wrap, .dropdown, .control, .spotlight')) return;
        else items = [['Nuova nota', () => open('notes')], ['Apri Finder', () => open('finder')], '-',
            ['Nuova cartella sulla scrivania', async () => { try { await api('POST', '/files/folder', { path: 'Scrivania', name: 'Cartella senza titolo' }); filesChanged(); } catch (e) { toast(e.message); } }],
            [check(S.desktopStacks, 'Usa pile'), () => { setSetting('desktopStacks', !S.desktopStacks); deskView.draw(); }], '-',
            ['Cambia sfondo', wallNext], ['Personalizza sfondo…', () => openSettings('sfondo')], [document.documentElement.dataset.theme === 'dark' ? 'Passa a modalità chiara' : 'Passa a modalità scura', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')], '-',
            ['Impostazioni di sistema…', () => open('settings')], '-', ['Blocca schermo', () => lock()], ['Esci', logout]];
        if (items?.length) contextMenu(e.clientX, e.clientY, items);
    });
    function logout() { $('#logoutForm').submit(); }
    function lock() {
        closePanels(); sp.hidden = true;
        if ($('.lockscreen')) return;
        const initials = MARX.user.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const ls = document.createElement('div'); ls.className = 'lockscreen'; ls.style.background = 'var(--desk-bg)';
        ls.innerHTML = `<div class="lock-clock"><div class="lock-date"></div><div class="lock-time"></div></div>
            <form class="lock-form"><div class="avatar">${esc(initials)}</div><div class="lock-name">${esc(MARX.user.name)}</div>
            <div class="lock-pass"><input class="lock-input" type="password" placeholder="Password" autocomplete="current-password" aria-label="Password"><button aria-label="Sblocca">→</button></div>
            <p class="lock-error" hidden></p><button type="button" class="lock-remember" data-out style="cursor:pointer">Cambia utente</button></form>`;
        document.body.append(ls); store.set('locked', true);
        const clk = () => { const d = new Date(); $('.lock-date', ls).textContent = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }); $('.lock-time', ls).textContent = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); };
        clk(); const ci = setInterval(clk, 5000);
        const inp = $('input', ls); inp.focus();
        $('[data-out]', ls).onclick = logout;
        $('form', ls).onsubmit = async e => {
            e.preventDefault();
            try { await api('POST', '/unlock', { password: inp.value }); clearInterval(ci); ls.remove(); store.set('locked', false); }
            catch (err) { const er = $('.lock-error', ls); er.hidden = false; er.textContent = err.message; inp.value = ''; const p = $('.lock-pass', ls); p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake'); }
        };
    }
    const dd = $('#dropdown');
    function showMenu(btn) {
        closePanels();
        const items = menuFor(btn.dataset.menu);
        dd.innerHTML = menuHTML(items);
        dd.hidden = false; btn.classList.add('open');
        dd.style.left = Math.max(4, Math.min(btn.getBoundingClientRect().left, innerWidth - dd.offsetWidth - 6)) + 'px';
        // Il clic si ferma qui: altrimenti arriverebbe alla scrivania e richiuderebbe subito ciò che la voce ha aperto (es. Spotlight)
        dd.onclick = e => { e.stopPropagation(); const b = e.target.closest('[data-i]'); if (!b || b.disabled) return; closePanels(); items[b.dataset.i][1](); };
    }
    function setTheme(t) { setSetting('theme', t); }
    function closePanels() {
        dd.hidden = true; $('#control').hidden = true;
        document.querySelectorAll('.menubar .open').forEach(b => b.classList.remove('open'));
    }
    // Delegato: i pulsanti dei menu app vengono ricreati a ogni cambio di app
    const menubar = $('.menubar');
    menubar.addEventListener('click', e => {
        const b = e.target.closest('[data-menu]'); if (!b) return;
        e.stopPropagation(); const wasOpen = b.classList.contains('open'); closePanels(); if (!wasOpen) showMenu(b);
    });
    menubar.addEventListener('mouseover', e => {
        const b = e.target.closest('[data-menu]');
        if (b && !dd.hidden && !b.classList.contains('open')) showMenu(b);
    });
    renderMenubar();
    function drawControlExtras() {
        const box = $('#ccExtras'); if (!box) return;
        const dnd = dndActive();
        box.innerHTML = `<button class="cc-btn ${dnd ? 'on' : ''}" data-cc="dnd"><b>Non disturbare</b><small>${dnd ? (S.dndUntil === 1 ? 'Attivo' : 'Fino alle ' + new Date(S.dndUntil).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })) : 'Disattivo'}</small></button>
            <button class="cc-btn ${S.stageManager ? 'on' : ''}" data-cc="stage"><b>Stage Manager</b><small>${S.stageManager ? 'Attivo' : 'Disattivo'}</small></button>
            <button class="cc-btn" data-cc="mission"><b>Mission Control</b><small>F3</small></button>
            <button class="cc-btn" data-cc="desktop"><b>Mostra scrivania</b><small>F11</small></button>`;
    }
    $('#control').addEventListener('click', e => {
        const b = e.target.closest('[data-cc]'); if (!b) return;
        if (b.dataset.cc === 'stage') { setSetting('stageManager', !S.stageManager); drawControlExtras(); }
        if (b.dataset.cc === 'dnd') { if (dndActive()) setDnd('off'); else dndMenu(b); drawControlExtras(); }
        if (b.dataset.cc === 'mission') { $('#control').hidden = true; missionControl(); }
        if (b.dataset.cc === 'desktop') { $('#control').hidden = true; showDesktop(); }
    });
    $('#controlBtn').addEventListener('click', () => drawControlExtras());
    $('#controlBtn').addEventListener('click', e => { e.stopPropagation(); const c = $('#control'); const h = c.hidden; closePanels(); c.hidden = !h; });
    $('#control').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', e => {
        const t = e.target.closest('[data-theme-set]'); if (t) setTheme(t.dataset.themeSet);
        if (!e.target.closest('.dropdown')) closePanels();
        const o = e.target.closest('[data-open]'); if (o && !o.classList.contains('desk-icon')) open(o.dataset.open);
    });
    // Icone di sistema sulla scrivania (il contenuto viene ridisegnato: ascolto sul contenitore)
    $('.desktop-icons').addEventListener('dblclick', e => { const b = e.target.closest('.desk-icon[data-open]'); if (b) open(b.dataset.open); });

    // Luminosità (velo scuro sopra tutto)
    const dim = document.createElement('div'); dim.className = 'dim'; document.body.append(dim);
    const br = $('#brightness');
    const applyBr = () => { dim.style.opacity = (100 - br.value) / 100 * .8; store.set('brightness', br.value); };
    br.value = store.get('brightness', 100); applyBr(); br.oninput = applyBr;

    /* ---------- Spotlight ---------- */
    const sp = $('#spotlight'), spIn = $('#spotlightInput'), spRes = $('#spotlightResults');
    let hl = 0, hits = [];
    function spotlight() {
        closePanels(); sp.hidden = false; spIn.value = ''; spRes.innerHTML = ''; spIn.focus();
    }
    // Risultati raggruppati: ogni voce ha un'azione; ↑/↓ scorrono tutte le voci, Invio esegue
    let spTimer = null, spSeq = 0;
    function drawSpotlight(groups) {
        hits = groups.flatMap(g => g.items);
        if (hl >= hits.length) hl = 0;
        let i = 0;
        spRes.innerHTML = groups.filter(g => g.items.length).map(g => `<div class="sp-group">${esc(g.title)}</div>` + g.items.map(it => {
            const idx = i++;
            return `<button class="${idx === hl ? 'hl' : ''}" data-hit="${idx}">${it.icon}<span class="sp-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
        }).join('')).join('');
    }
    spIn.addEventListener('input', () => {
        const raw = spIn.value.trim(), q = raw.toLowerCase(); hl = 0;
        if (!q) { hits = []; spRes.innerHTML = ''; return; }
        const groups = [];
        if (/^[\d\s.,+\-*/()%^]+$/.test(q) && /\d/.test(q)) {
            try { const v = Function(`"use strict";return (${q.replace(/,/g, '.').replace(/\^/g, '**')})`)(); if (isFinite(v)) { const r = String(+v.toPrecision(12)).replace('.', ',');
                groups.push({ title: 'Calcolatrice', items: [{ icon: '<span class="ico ico-calc"></span>', label: '= ' + r, sub: 'Invio per copiare il risultato', run: () => navigator.clipboard?.writeText(r).then(() => toast('Risultato copiato'), () => {}) }] }); } } catch {}
        }
        const apps = Object.entries(APPS).filter(([, a]) => !a.hidden && !a.special && a.name.toLowerCase().includes(q)).slice(0, 6);
        if (apps.length) groups.push({ title: 'App', items: apps.map(([k, a]) => ({ icon: icoHTML(a), label: a.name, run: () => open(k) })) });
        const looksUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw);
        groups.push({ title: 'Web', items: [{ icon: '<span class="ico ico-webx"></span>', label: looksUrl ? `Apri ${raw}` : `Cerca «${raw}» con webX`, sub: 'webX',
            run: () => { open('webx'); ctlOf('webx').openURL?.(looksUrl ? (/^https?:/.test(raw) ? raw : 'https://' + raw) : raw); } }] });
        drawSpotlight(groups);
        // Note e file: ricerca sul server (con un piccolo ritardo mentre si scrive)
        clearTimeout(spTimer); const seq = ++spSeq;
        spTimer = setTimeout(async () => {
            let r; try { r = await api('GET', '/search?q=' + encodeURIComponent(raw)); } catch { return; }
            if (seq !== spSeq || sp.hidden) return;
            const extra = [];
            if (r.notes.length) extra.push({ title: 'Note', items: r.notes.map(n => ({ icon: '<span class="ico ico-notes"></span>', label: n.title, sub: n.snippet, run: () => { open('notes'); ctlOf('notes').openNote?.(n.id); } })) });
            if (r.files.length) extra.push({ title: 'File', items: r.files.map(f => ({ icon: `<span class="ico ico-${f.type === 'folder' ? 'folder' : 'doc'}"></span>`, label: f.name, sub: f.path, run: () => { open('finder'); ctlOf('finder').reveal?.(f.path, f.type); } })) });
            const web = groups.pop();
            drawSpotlight([...groups, ...extra, web]);
        }, 220);
    });
    spIn.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); if (!hits.length) return;
            hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
            spRes.querySelectorAll('[data-hit]').forEach(b => b.classList.toggle('hl', +b.dataset.hit === hl));
            spRes.querySelector('.hl')?.scrollIntoView({ block: 'nearest' });
        }
        if (e.key === 'Enter' && hits[hl]) { sp.hidden = true; hits[hl].run(); }
    });
    spRes.addEventListener('click', e => { const b = e.target.closest('[data-hit]'); if (!b) return; sp.hidden = true; hits[+b.dataset.hit]?.run(); });
    $('#spotlightBtn').addEventListener('click', e => { e.stopPropagation(); sp.hidden ? spotlight() : (sp.hidden = true); });
    sp.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => { sp.hidden = true; });

    /* ---------- Liquid Glass: rifrazione ---------- */
    // Filtro SVG che deforma leggermente ciò che sta dietro al vetro. Solo Chromium lo supporta dentro backdrop-filter.
    document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
        <filter id="lg-refract" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="2" seed="7" result="noise"/>
            <feGaussianBlur in="noise" stdDeviation="3" result="soft"/>
            <feDisplacementMap in="SourceGraphic" in2="soft" scale="28" xChannelSelector="R" yChannelSelector="G"/>
        </filter></svg>`);
    if (navigator.userAgentData?.brands?.some(b => /Chromium|Chrome|Edge/.test(b.brand))) document.documentElement.classList.add('lg-refract');

    /* ---------- Dock: ingrandimento al passaggio del mouse ---------- */
    (() => {
        const dock = $('#dock'), items = () => [...dock.querySelectorAll('.dock-item')];
        const base = () => (innerWidth <= 640 ? Math.min(40, S.dockSize) : S.dockSize), max = () => base() * S.dockMagnifyScale, range = 150;
        let raf = 0;
        const reset = () => { dock.classList.remove('magnify'); items().forEach(it => { it.style.width = it.style.height = ''; }); };
        dock.addEventListener('mousemove', e => {
            if (reduceMotion() || !S.dockMagnify) return;
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                dock.classList.add('magnify');
                items().forEach(it => {
                    const r = it.getBoundingClientRect(), dist = Math.abs(e.clientX - (r.left + r.width / 2));
                    const k = dist > range ? 0 : (Math.cos((dist / range) * Math.PI) + 1) / 2;
                    const size = base() + (max() - base()) * k;
                    it.style.width = it.style.height = size + 'px';
                });
            });
        });
        dock.addEventListener('mouseleave', () => { cancelAnimationFrame(raf); reset(); });
    })();



    /* ---------- Suoni di sistema (sintetizzati, nessun file da scaricare) ---------- */
    let audioCtx = null;
    addEventListener('pointerdown', () => { try { audioCtx = audioCtx || new AudioContext(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch {} }, { capture: true });
    function tone(freq, start, dur, type = 'sine', gain = 1) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t0 = audioCtx.currentTime + start;
        o.type = type; o.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain * S.soundVolume * .35, t0 + .01); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
        o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0 + dur + .02);
    }
    function noise(start, dur, gain = 1) {
        const len = Math.floor(audioCtx.sampleRate * dur), buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2) * (Math.random() < .3 ? 1 : .3);
        const src = audioCtx.createBufferSource(), f = audioCtx.createBiquadFilter(), g = audioCtx.createGain();
        f.type = 'bandpass'; f.frequency.value = 1800; g.gain.value = gain * S.soundVolume * .5;
        src.buffer = buf; src.connect(f).connect(g).connect(audioCtx.destination); src.start(audioCtx.currentTime + start);
    }
    const SOUNDS = {
        vetro: () => { tone(1568, 0, .5, 'sine', .8); tone(2093, .07, .6, 'sine', .5); },
        gocce: () => { tone(880, 0, .12, 'sine'); tone(1320, .1, .14, 'sine'); tone(990, .2, .2, 'sine', .7); },
        campanello: () => { [523, 659, 784].forEach((f, i) => tone(f, i * .09, .7, 'triangle', .6)); },
        trash: () => { noise(0, .18, .9); noise(.12, .22, .7); },
        error: () => { tone(220, 0, .18, 'square', .35); tone(165, .14, .25, 'square', .35); },
        startup: () => { [261.6, 329.6, 392, 523.3].forEach(f => tone(f, 0, 2.2, 'sine', .45)); tone(130.8, 0, 2.4, 'sine', .35); },
        shutter: () => { noise(0, .05, 1); noise(.07, .06, .8); },
    };
    function playSound(name) {
        if (!S.sounds || !audioCtx) return;
        const key = name === 'notify' ? S.notifySound : name;
        if (!key || key === 'nessuno' || !SOUNDS[key]) return;
        try { SOUNDS[key](); } catch {}
    }

    /* ---------- Non disturbare ---------- */
    const dndActive = () => S.dndUntil && (S.dndUntil === 1 || S.dndUntil > Date.now());
    function setDnd(mode) {
        const until = { off: 0, on: 1, hour: Date.now() + 3600e3, evening: (() => { const d = new Date(); d.setHours(20, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d.getTime(); })(),
            tomorrow: (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); })() }[mode];
        setSetting('dndUntil', until); drawDnd(); drawControlExtras?.();
    }
    function drawDnd() {
        const on = dndActive();
        let el = $('#dndIcon');
        if (!el) { el = document.createElement('button'); el.id = 'dndIcon'; el.className = 'menu-icon'; el.title = 'Non disturbare'; el.setAttribute('aria-label', 'Non disturbare attivo');
            el.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/></svg>';
            $('#clock').before(el); el.onclick = e => { e.stopPropagation(); toggleNC(); }; }
        el.hidden = !on;
    }
    setInterval(() => { if (S.dndUntil > 1 && S.dndUntil < Date.now()) { setSetting('dndUntil', 0); drawDnd(); } }, 30000);

    /* ---------- Centro notifiche ---------- */
    const nc = document.createElement('aside'); nc.className = 'nc'; nc.hidden = true; document.body.append(nc);
    const relTime = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'adesso' : m < 60 ? `${m} min fa` : m < 1440 ? `${Math.round(m / 60)} h fa` : new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); };
    async function drawNC() {
        const list = store.get('notifications', []), d = new Date();
        const y = d.getFullYear(), m = d.getMonth(), first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
        let cal = ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(x => `<b>${x}</b>`).join('') + '<i></i>'.repeat(first);
        for (let i = 1; i <= days; i++) cal += `<i class="${i === d.getDate() ? 'today' : ''}">${i}</i>`;
        const dnd = dndActive();
        nc.innerHTML = `
            <div class="nc-head"><div><strong>${d.toLocaleDateString('it-IT', { weekday: 'long' })}</strong><span>${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</span></div>
                <button class="nc-dnd ${dnd ? 'on' : ''}" data-nc="dnd" title="Non disturbare"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/></svg>${dnd ? 'Non disturbare' : ''}</button></div>
            <div class="nc-widgets">
                <div class="nc-w nc-clock"><span id="ncTime"></span><small>${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</small></div>
                <div class="nc-w nc-cal"><strong>${d.toLocaleDateString('it-IT', { month: 'long' })}</strong><div>${cal}</div></div>
                <div class="nc-w nc-notes"><strong>Note recenti</strong><div id="ncNotes"><small>Caricamento…</small></div></div>
            </div>
            <div class="nc-list-head"><strong>Notifiche</strong>${list.length ? '<button data-nc="clear">Cancella tutto</button>' : ''}</div>
            <div class="nc-list">${list.length ? list.slice(0, 50).map((n, i) => `<div class="nc-item"><div><small>${esc(n.app)}</small><small>${relTime(n.t)}</small></div><p>${esc(n.msg)}</p><button data-nc-del="${i}" aria-label="Elimina">×</button></div>`).join('')
                : '<p class="nc-empty">Nessuna notifica</p>'}</div>`;
        const tick2 = () => { const el = $('#ncTime', nc); if (el) el.textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); };
        tick2();
        try {
            const notes = await api('GET', '/notes');
            const box = $('#ncNotes', nc); if (!box) return;
            box.innerHTML = notes.slice(0, 3).map(n => `<button data-note="${n.id}">${esc((n.body || '').split('\n')[0].trim() || 'Nuova nota')}</button>`).join('') || '<small>Nessuna nota</small>';
        } catch {}
    }
    function toggleNC(force) {
        const show = force ?? nc.hidden;
        closePanels(); sp.hidden = true;
        nc.hidden = !show;
        if (show) drawNC();
    }
    nc.addEventListener('click', e => {
        e.stopPropagation();
        const a = e.target.closest('[data-nc]')?.dataset.nc;
        if (a === 'clear') { store.set('notifications', []); drawNC(); }
        if (a === 'dnd') { dndActive() ? setDnd('off') : dndMenu(e.target.closest('button')); drawNC(); }
        const del = e.target.closest('[data-nc-del]'); if (del) { const l = store.get('notifications', []); l.splice(+del.dataset.ncDel, 1); store.set('notifications', l); drawNC(); }
        const note = e.target.closest('[data-note]'); if (note) { nc.hidden = true; open('notes'); ctlOf('notes').openNote?.(+note.dataset.note); }
    });
    function dndMenu(anchor) {
        const r = anchor.getBoundingClientRect();
        contextMenu(r.left, r.bottom + 4, [['Per 1 ora', () => setDnd('hour')], ['Fino a stasera', () => setDnd('evening')], ['Fino a domani mattina', () => setDnd('tomorrow')], ['Finché non lo disattivo', () => setDnd('on')]]);
    }
    $('#clock').addEventListener('click', e => { e.stopPropagation(); toggleNC(); });
    document.addEventListener('click', e => { if (!nc.hidden && !e.target.closest('.nc, .ctx')) nc.hidden = true; });
    addEventListener('marx:notify', () => { if (!nc.hidden) drawNC(); });

    /* ---------- Salvaschermo ---------- */
    let saver = null;
    function startScreensaver(style = S.screensaverStyle) {
        if (saver || $('.lockscreen')) return;
        closePanels(); nc.hidden = true; sp.hidden = true;
        const el = document.createElement('div'); el.className = 'saver';
        el.innerHTML = '<canvas></canvas><div class="saver-clock"><b></b><span></span></div>';
        document.body.append(el);
        const cv = $('canvas', el), ctx = cv.getContext('2d'), clock = $('.saver-clock', el);
        const resize = () => { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; };
        resize(); addEventListener('resize', resize);
        const blobs = [...Array(style === 'bolle' ? 26 : 5)].map((_, i) => ({ x: Math.random(), y: Math.random(), r: style === 'bolle' ? .02 + Math.random() * .06 : .35 + Math.random() * .25,
            vx: (Math.random() - .5) * .0009, vy: (Math.random() - .5) * .0009, h: [200, 260, 320, 180, 230][i % 5] + Math.random() * 30 }));
        let cx = .3, cy = .4, cvx = .0006, cvy = .0004, raf;
        const frame = () => {
            const W = cv.width, H = cv.height;
            ctx.fillStyle = style === 'orologio' ? '#000' : '#05070f'; ctx.fillRect(0, 0, W, H);
            if (style !== 'orologio') {
                ctx.globalCompositeOperation = style === 'aurora' ? 'lighter' : 'source-over';
                blobs.forEach(b => {
                    b.x += b.vx; b.y += b.vy; if (b.x < -.2 || b.x > 1.2) b.vx *= -1; if (b.y < -.2 || b.y > 1.2) b.vy *= -1;
                    const R = b.r * Math.max(W, H), g = ctx.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, R);
                    if (style === 'aurora') { g.addColorStop(0, `hsla(${b.h},90%,55%,.55)`); g.addColorStop(1, `hsla(${b.h},90%,40%,0)`); }
                    else { g.addColorStop(0, `hsla(${b.h},90%,80%,.08)`); g.addColorStop(.85, `hsla(${b.h},90%,70%,.18)`); g.addColorStop(1, `hsla(${b.h},90%,85%,.6)`); }
                    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x * W, b.y * H, R, 0, Math.PI * 2); ctx.fill();
                });
                ctx.globalCompositeOperation = 'source-over';
            }
            // L'orologio si sposta lentamente per non segnare lo schermo
            cx += cvx; cy += cvy; if (cx < .08 || cx > .62) cvx *= -1; if (cy < .1 || cy > .7) cvy *= -1;
            const d = new Date();
            clock.style.left = cx * 100 + '%'; clock.style.top = cy * 100 + '%';
            $('b', clock).textContent = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
            $('span', clock).textContent = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
            raf = requestAnimationFrame(frame);
        };
        frame();
        const started = Date.now();
        const stop = ev => {
            if (Date.now() - started < 700) return;
            cancelAnimationFrame(raf); el.remove(); saver = null; removeEventListener('resize', resize);
            ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(t => removeEventListener(t, stop, true));
            lastActivity = Date.now(); ev?.preventDefault?.();
        };
        ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(t => addEventListener(t, stop, true));
        saver = el;
    }
    setInterval(() => {
        const m = +S.screensaverMinutes;
        if (m > 0 && !saver && !$('.lockscreen') && Date.now() - lastActivity > m * 60000) startScreensaver();
    }, 5000);

    /* ---------- Aggiornamento software ---------- */
    let updateInfo = null;
    function drawUpdateBadge() {
        const on = !!updateInfo?.available;
        document.querySelector('.dock-item[data-open="settings"]')?.classList.toggle('badge', on);
    }
    async function checkUpdates(force = false) {
        if (!MARX.user.is_admin) return;
        try { updateInfo = await api('GET', '/system/update' + (force ? '?force=1' : '')); } catch { return; }
        drawUpdateBadge();
        const v = updateInfo.latest?.version;
        if (updateInfo.available && store.get('update.snooze', '') !== v + '@' + new Date().toDateString()) {
            playSound('notify');
            toast(`È disponibile MarX ${v}. Vuoi installarlo adesso?`, { app: 'Aggiornamento software', silent: true, actions: [
                { label: 'Dettagli', run: () => openSettings('aggiornamento') },
                { label: 'Più tardi', run: () => store.set('update.snooze', v + '@' + new Date().toDateString()) },
            ] });
        }
    }
    async function runUpdate(latest) {
        const w = wins.get('settings');
        const ok = await sheet(w, { title: `Installare MarX ${latest.version}?`, text: 'Durante l\'aggiornamento MarX non sarà utilizzabile per circa un minuto. Le tue finestre verranno riaperte.', ok: 'Aggiorna', cancel: true });
        if (!ok) return;
        let job; try { job = (await api('POST', '/system/update')).job; } catch (e) { return toast(e.message, { app: 'Aggiornamento software' }); }
        saveSession();
        const ov = document.createElement('div'); ov.className = 'upd-overlay';
        ov.innerHTML = `<div><svg viewBox="0 0 24 24" width="64" height="64"><path d="M3 20V4l9 9 9-9v16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>
            <b>Aggiornamento a MarX ${esc(latest.version)}</b><div class="upd-bar"><i></i></div><span>Preparazione…</span></div>`;
        document.body.append(ov);
        for (;;) {
            await new Promise(r => setTimeout(r, 1500));
            let j; try { j = await api('GET', '/appstore/jobs/' + job); } catch { continue; }  // durante il riavvio il server può non rispondere
            $('.upd-bar i', ov).style.width = j.progress + '%'; $('span', ov).textContent = j.step;
            if (j.done) {
                if (j.error) { $('span', ov).textContent = j.error; ov.insertAdjacentHTML('beforeend', '<button class="btn">Chiudi</button>'); $('button', ov).onclick = () => ov.remove(); return; }
                $('span', ov).textContent = 'Riavvio di MarX…'; setTimeout(() => location.reload(), 2500); return;
            }
        }
    }
    setTimeout(() => checkUpdates(), 8000);
    setInterval(() => checkUpdates(), 6 * 3600e3);

    /* ---------- Scrivanie multiple ---------- */
    const spaceHud = document.createElement('div'); spaceHud.className = 'space-hud'; spaceHud.hidden = true; document.body.append(spaceHud);
    let hudT = null;
    function applySpaces() {
        wins.forEach(w => w.classList.toggle('off-space', !inSpace(w)));
        store.set('spaces', spaces);
    }
    function switchSpace(n, dir) {
        n = Math.max(0, Math.min(spaces.count - 1, n));
        if (n === spaces.current) { bumpHud(); return; }
        const from = spaces.current; spaces.current = n;
        const box = $('#windows');
        if (!reduceMotion() && box.animate) box.animate([{ transform: `translateX(${(dir ?? (n > from ? 1 : -1)) * 60}px)`, opacity: .2 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.2,.8,.3,1)' });
        applySpaces(); active = null; focusTop(); renderMenubar(); bumpHud(); saveSession();
        if (document.body.classList.contains('mc')) missionControl(true);
    }
    function bumpHud() {
        spaceHud.innerHTML = [...Array(spaces.count).keys()].map(i => `<i class="${i === spaces.current ? 'on' : ''}"></i>`).join('') + `<span>Scrivania ${spaces.current + 1}</span>`;
        spaceHud.hidden = false; clearTimeout(hudT); hudT = setTimeout(() => { spaceHud.hidden = true; }, 900);
    }
    function addSpace() { if (spaces.count >= 9) return toast('Puoi avere al massimo 9 scrivanie'); spaces.count++; saveSession(); }
    function removeSpace(i) {
        if (spaces.count <= 1) return;
        wins.forEach(w => { const sp = winSpace(w); if (sp === i) w.dataset.space = Math.max(0, i - 1); else if (sp > i) w.dataset.space = sp - 1; });
        spaces.count--; if (spaces.current >= i && spaces.current > 0) spaces.current--;
        applySpaces(); focusTop(); saveSession();
    }
    function moveToSpace(id, i) { const w = wins.get(id); if (!w) return; w.dataset.space = i; applySpaces(); if (id === active) { active = null; focusTop(); } saveSession(); toast(`${APPS[id].name} spostata su Scrivania ${i + 1}`); }

    /* ---------- Mission Control ---------- */
    let mcEl = null;
    function missionControl(relayout = false) {
        const body = document.body;
        if (body.classList.contains('mc') && !relayout) return exitMC();
        closePanels(); sp.hidden = true; $('.launchpad')?.remove();
        if (!relayout) {
            body.classList.add('mc');
            mcEl = document.createElement('div'); mcEl.className = 'mc-layer';
            body.append(mcEl);
        }
        // Barra delle scrivanie
        mcEl.innerHTML = `<div class="mc-spaces">${[...Array(spaces.count).keys()].map(i => `<div class="mc-space ${i === spaces.current ? 'on' : ''}" data-space="${i}">
                <div class="mc-space-thumb"></div><span>Scrivania ${i + 1}</span>${spaces.count > 1 ? `<button class="mc-space-x" data-del="${i}" aria-label="Rimuovi scrivania">×</button>` : ''}</div>`).join('')}
            <button class="mc-add" data-add title="Nuova scrivania" aria-label="Nuova scrivania">＋</button></div>`;
        const list = [...wins.entries()].filter(([, w]) => !w.hidden && inSpace(w));
        wins.forEach(w => { if (!inSpace(w) || w.hidden) w.style.transform = ''; });
        const top = 150, bottom = innerHeight - (S.dockAutohide ? 30 : S.dockSize + 40), areaW = innerWidth - 80, areaH = bottom - top;
        const n = list.length;
        if (!n) mcEl.insertAdjacentHTML('beforeend', '<p class="mc-empty">Nessuna finestra aperta su questa scrivania</p>');
        const cols = Math.max(1, Math.ceil(Math.sqrt(n * areaW / Math.max(areaH, 1) / 1.4))), rows = Math.ceil(n / cols);
        const cw = areaW / cols, ch = areaH / rows;
        list.sort((a, b) => a[1].offsetLeft - b[1].offsetLeft).forEach(([id, w], i) => {
            const c = i % cols, r = Math.floor(i / cols);
            const s = Math.min((cw - 30) / w.offsetWidth, (ch - 40) / w.offsetHeight, 1);
            const tx = 40 + c * cw + (cw - w.offsetWidth * s) / 2, ty = top + r * ch + (ch - 24 - w.offsetHeight * s) / 2;
            w.style.transformOrigin = '0 0';
            w.style.transform = `translate(${tx - w.offsetLeft}px, ${ty - deskTop() - w.offsetTop}px) scale(${s})`;
            w.dataset.mc = JSON.stringify({ tx, ty, s });
            mcEl.insertAdjacentHTML('beforeend', `<div class="mc-label" style="left:${tx}px;top:${ty + w.offsetHeight * s + 8}px;width:${w.offsetWidth * s}px">${icoHTML(APPS[id])}<span>${esc(APPS[id].name)}</span></div>`);
        });
        mcEl.onclick = e => {
            if (e.target.closest('[data-add]')) { addSpace(); return missionControl(true); }
            const del = e.target.closest('[data-del]'); if (del) { removeSpace(+del.dataset.del); return missionControl(true); }
            const spEl = e.target.closest('[data-space]'); if (spEl) { switchSpace(+spEl.dataset.space); return; }
            if (e.target === mcEl || e.target.classList.contains('mc-empty')) exitMC();
        };
    }
    function exitMC(focusId) {
        document.body.classList.remove('mc');
        wins.forEach(w => { w.style.transform = ''; delete w.dataset.mc; });
        mcEl?.remove(); mcEl = null;
        if (focusId) focus(focusId);
        setTimeout(layoutStage, 360);
    }
    // In Mission Control: clic su una finestra = la apre; trascinata su una scrivania = la sposta lì
    $('#windows').addEventListener('pointerdown', e => {
        if (!document.body.classList.contains('mc')) return;
        const w = e.target.closest('.window'); if (!w) return;
        e.preventDefault(); e.stopPropagation();
        const id = [...wins.entries()].find(([, x]) => x === w)?.[0];
        const m = JSON.parse(w.dataset.mc || '{}'); let moved = false;
        const move = ev => {
            const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
            if (Math.hypot(dx, dy) > 6) moved = true;
            if (moved) { w.style.transition = 'none'; w.style.transform = `translate(${m.tx + dx - w.offsetLeft}px, ${m.ty + dy - deskTop() - w.offsetTop}px) scale(${m.s * .8})`; }
            mcEl?.querySelectorAll('.mc-space').forEach(sp => { const r = sp.getBoundingClientRect(); sp.classList.toggle('drop', ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom); });
        };
        const up = ev => {
            removeEventListener('pointermove', move); removeEventListener('pointerup', up); w.style.transition = '';
            const target = mcEl?.querySelector('.mc-space.drop');
            if (moved) addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
            if (moved && target) { moveToSpace(id, +target.dataset.space); return missionControl(true); }
            if (moved) return missionControl(true);
            exitMC(id);
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
    }, true);

    /* ---------- Mostra scrivania ---------- */
    function showDesktop() {
        const on = document.body.classList.toggle('show-desktop');
        wins.forEach(w => {
            if (!on || w.hidden || !inSpace(w)) { w.style.transform = ''; return; }
            const cx = w.offsetLeft + w.offsetWidth / 2, cy = w.offsetTop + w.offsetHeight / 2;
            const dx = cx < innerWidth / 2 ? -(w.offsetLeft + w.offsetWidth - 40) : innerWidth - w.offsetLeft - 40;
            const dy = cy < innerHeight / 2 ? -(w.offsetTop + w.offsetHeight - 40) : innerHeight - w.offsetTop - 40;
            w.style.transform = `translate(${dx}px, ${dy}px)`;
        });
    }
    $('#desktop').addEventListener('pointerdown', e => { if (document.body.classList.contains('show-desktop') && e.target.closest('.window')) showDesktop(); });

    /* ---------- Stage Manager ---------- */
    function layoutStage() {
        const on = S.stageManager && !document.body.classList.contains('mc');
        document.body.classList.toggle('stage', on);
        wins.forEach(w => { if (w.classList.contains('stage-thumb')) { w.classList.remove('stage-thumb'); w.style.transform = ''; } });
        if (!on) return;
        const others = mru.filter(id => id !== active && wins.get(id) && !wins.get(id).hidden && inSpace(wins.get(id))).slice(0, 6);
        others.forEach((id, i) => {
            const w = wins.get(id), boxW = 150, boxH = 105;
            const s = Math.min(boxW / w.offsetWidth, boxH / w.offsetHeight);
            const tx = 18 + (boxW - w.offsetWidth * s) / 2, ty = 70 + i * 128 + (boxH - w.offsetHeight * s) / 2;
            w.classList.add('stage-thumb'); w.style.transformOrigin = '0 0';
            w.style.transform = `translate(${tx - w.offsetLeft}px, ${ty - deskTop() - w.offsetTop}px) scale(${s}) perspective(600px) rotateY(12deg)`;
        });
        const a = active && wins.get(active);
        if (a && !a.classList.contains('maximized') && !a.dataset.snapped && a.offsetLeft < 190) a.style.left = '190px';
    }

    /* ---------- Passaggio rapido tra le app (Alt+Q, tenendo premuto Alt) ---------- */
    let switcher = null;
    function switcherStep(dir) {
        const list = mru.filter(id => wins.has(id));
        if (list.length < 1) return;
        if (!switcher) {
            switcher = { list, i: list.length > 1 ? 1 : 0, el: document.createElement('div') };
            switcher.el.className = 'app-switcher'; document.body.append(switcher.el);
        } else switcher.i = (switcher.i + dir + switcher.list.length) % switcher.list.length;
        switcher.el.innerHTML = switcher.list.map((id, i) => `<div class="${i === switcher.i ? 'on' : ''}">${icoHTML(APPS[id])}</div>`).join('') + `<span>${esc(APPS[switcher.list[switcher.i]].name)}</span>`;
    }
    function switcherEnd(apply = true) {
        if (!switcher) return;
        const id = switcher.list[switcher.i]; switcher.el.remove(); switcher = null;
        if (apply) open(id);
    }
    addEventListener('keyup', e => { if (e.key === 'Alt' && switcher) switcherEnd(true); });

    /* ---------- Angoli attivi ---------- */
    const HOT_ACTIONS = { none: 'Niente', mission: 'Mission Control', desktop: 'Mostra scrivania', launchpad: 'Launchpad', spotlight: 'Spotlight', notifications: 'Centro notifiche', screensaver: 'Avvia salvaschermo', lock: 'Blocca schermo' };
    function runAction(a) {
        ({ mission: () => missionControl(), desktop: showDesktop, launchpad, spotlight: () => spotlight(), lock: () => lock(),
           notifications: () => toggleNC(true), screensaver: () => startScreensaver() }[a] || (() => {}))();
    }
    (() => {
        let corner = null, t = null;
        addEventListener('pointermove', e => {
            if (dragging || e.buttons) return;
            const c = (e.clientY <= 1 ? 'T' : e.clientY >= innerHeight - 2 ? 'B' : '') + (e.clientX <= 1 ? 'L' : e.clientX >= innerWidth - 2 ? 'R' : '');
            const key = c.length === 2 ? 'hot' + c : null;
            if (key === corner) return;
            corner = key; clearTimeout(t);
            if (key && S[key] && S[key] !== 'none') t = setTimeout(() => { if (corner === key) runAction(S[key]); }, 280);
        }, { passive: true });
    })();

    /* ---------- Scorciatoie ---------- */
    // Scorciatoie: [azione, descrizione, combinazione predefinita]. L'utente può cambiarle in Impostazioni › Tastiera.
    const SHORTCUT_DEFS = [
        ['spotlight', 'Spotlight', 'Ctrl+K'], ['mission', 'Mission Control', 'F3'], ['desktop', 'Mostra scrivania', 'F11'],
        ['notifications', 'Centro notifiche', 'Ctrl+Alt+N'], ['spaceLeft', 'Scrivania precedente', 'Ctrl+ArrowLeft'], ['spaceRight', 'Scrivania successiva', 'Ctrl+ArrowRight'],
        ['snapLeft', 'Affianca a sinistra', 'Ctrl+Alt+ArrowLeft'], ['snapRight', 'Affianca a destra', 'Ctrl+Alt+ArrowRight'],
        ['snapFull', 'Riempi lo schermo', 'Ctrl+Alt+ArrowUp'], ['snapCenter', 'Centra la finestra', 'Ctrl+Alt+ArrowDown'],
        ['minimize', 'Riduci la finestra', 'Ctrl+Alt+M'], ['closeWin', 'Chiudi la finestra', 'Ctrl+Alt+W'], ['prefs', 'Impostazioni dell\'app attiva', 'Ctrl+,'],
        ['launchpad', 'Launchpad', 'F4'], ['screensaver', 'Avvia salvaschermo', 'Ctrl+Alt+S'], ['lock', 'Blocca schermo', 'Ctrl+Meta+Q'],
    ];
    const shortcutOf = id => (S.shortcuts && S.shortcuts[id]) || SHORTCUT_DEFS.find(d => d[0] === id)[2];
    function comboOf(e) {
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
        let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
        if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
        if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
        if (k === ' ') k = 'Space';
        return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', k].filter(Boolean).join('+');
    }
    const prettyCombo = c => c.replace('Meta', '⌘').replace(/Arrow(Left|Right|Up|Down)/, (_, d) => ({ Left: '←', Right: '→', Up: '↑', Down: '↓' }[d])).replace('Space', 'Spazio').replace(/\+/g, ' + ');
    const SHORTCUT_RUN = {
        spotlight: () => spotlight(), mission: () => missionControl(), desktop: () => showDesktop(), notifications: () => toggleNC(),
        spaceLeft: () => switchSpace(spaces.current - 1), spaceRight: () => switchSpace(spaces.current + 1),
        snapLeft: () => active && snapTo(active, 'left'), snapRight: () => active && snapTo(active, 'right'), snapFull: () => active && snapTo(active, 'full'), snapCenter: () => active && snapTo(active, 'center'),
        minimize: () => active && minimize(active), closeWin: () => active && close(active), prefs: () => (active ? ctlOf(active).prefs?.() : open('settings')),
        launchpad: () => launchpad(), screensaver: () => startScreensaver(), lock: () => lock(),
    };
    function showShortcuts() { openSettings('tastiera'); }

    /* ---------- Tastiera ---------- */
    let recordingShortcut = null;  // impostato da Impostazioni › Tastiera mentre si registra una nuova combinazione
    addEventListener('keydown', e => {
        if (recordingShortcut) return recordingShortcut(e);
        if (e.key === 'Escape') { sp.hidden = true; closePanels(); nc.hidden = true; $('.launchpad')?.remove(); if (document.body.classList.contains('mc')) exitMC(); if (switcher) switcherEnd(false); return; }
        if (e.altKey && (e.code === 'KeyQ' || e.key === 'Tab')) { e.preventDefault(); return switcherStep(e.shiftKey ? -1 : 1); }
        const combo = comboOf(e); if (!combo) return;
        const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
        // Mentre si scrive, le combinazioni senza Ctrl/Alt/⌘ (e le frecce con solo Ctrl) restano al campo di testo
        if (typing && (!/(Ctrl|Alt|Meta)\+/.test(combo) || /^Ctrl\+Arrow/.test(combo))) return;
        if (!typing && combo === 'Ctrl+ArrowUp') { e.preventDefault(); return missionControl(); }
        const hit = SHORTCUT_DEFS.find(([id]) => shortcutOf(id) === combo);
        if (hit) { e.preventDefault(); SHORTCUT_RUN[hit[0]](); }
    });
    if (store.get('locked', false)) lock();
    const deskView = desktopFiles(); deskView.load();
    loadWebApps().finally(() => { if (S.restoreWindows) restoreSession(); });
    drawDnd();
    // Il browser fa suonare solo dopo un gesto dell'utente: il suono di avvio parte al primo clic della sessione
    if (S.startupSound && !sessionStorage.getItem('marx.started')) {
        addEventListener('pointerdown', () => { sessionStorage.setItem('marx.started', '1'); setTimeout(() => playSound('startup'), 30); }, { once: true });
    }

    /* ---------- Orologio ---------- */
    function tick() {
        const d = new Date();
        const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', ...(S.clockSeconds ? { second: '2-digit' } : {}) });
        $('#clock').textContent = (S.clockDate ? d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) + '  ' : '') + time;
        $('#dockDay').textContent = d.getDate();
    }
    tick(); setInterval(tick, 1000);

    /* ---------- Dock: trascinare file sul Cestino ---------- */
    (() => {
        const dock = $('#dock');
        dock.addEventListener('dragover', e => { const t = e.target.closest('.dock-item[data-open="trash"]'); if (t && [...e.dataTransfer.types].includes(DRAG_TYPE)) { e.preventDefault(); t.classList.add('drop'); } });
        dock.addEventListener('dragleave', e => e.target.closest('.dock-item')?.classList.remove('drop'));
        dock.addEventListener('drop', e => { const t = e.target.closest('.dock-item[data-open="trash"]'); if (!t) return; e.preventDefault(); t.classList.remove('drop'); dropFiles(e, { trash: true }); });
    })();

    /* ---------- Dock che si nasconde da solo ---------- */
    (() => {
        const wrap = $('.dock-wrap'); let hideT = null;
        const show = () => { clearTimeout(hideT); wrap.classList.add('show'); };
        const hide = () => { clearTimeout(hideT); hideT = setTimeout(() => wrap.classList.remove('show'), 500); };
        addEventListener('mousemove', e => { if (S.dockAutohide && e.clientY >= innerHeight - 4) show(); });
        wrap.addEventListener('mouseenter', show);
        wrap.addEventListener('mouseleave', () => S.dockAutohide && hide());
    })();

    /* ---------- Scuoti il puntatore per trovarlo ---------- */
    (() => {
        let lastX = null, lastDir = 0, flips = [], big = null;
        addEventListener('pointermove', e => {
            if (!S.shakeToLocate || S.cursorStyle !== 'mac' || e.pointerType !== 'mouse') return;
            if (lastX !== null) {
                const dx = e.clientX - lastX, dir = Math.sign(dx);
                if (Math.abs(dx) > 12 && dir && dir !== lastDir) { flips.push(performance.now()); lastDir = dir; }
            }
            lastX = e.clientX;
            const now = performance.now();
            flips = flips.filter(t => now - t < 600);
            if (flips.length >= 5) {
                flips = [];
                applyCursors(Math.min(4.5, (+S.cursorSize || 1) * 3.5));
                clearTimeout(big); big = setTimeout(() => applyCursors(), 900);
            }
        }, { passive: true });
    })();

    /* ---------- Blocco automatico per inattività ---------- */
    let lastActivity = Date.now();
    ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(ev => addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
    setInterval(() => {
        const m = +S.autoLockMinutes;
        if (m > 0 && !$('.lockscreen') && Date.now() - lastActivity > m * 60000) lock();
    }, 15000);
})();
