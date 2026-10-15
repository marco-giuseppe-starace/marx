#!/usr/bin/env python3
"""
Agente MarX: l'unico processo autorizzato a usare Docker, Apache e certbot per le app del Soft Store.

Il sito (utente www-data) gli parla tramite un socket Unix con messaggi JSON di una riga.
Accetta solo comandi noti e solo app presenti nel catalogo (/opt/marx-agent/catalog),
così anche chi controllasse il sito non potrebbe eseguire comandi arbitrari sul server.
"""
import json
import os
import re
import secrets
import shutil
import socket
import socketserver
import subprocess
import threading
import time
import uuid

BASE = '/opt/marx-agent'
CATALOG = f'{BASE}/catalog'
DATA = '/var/lib/marx-agent'
APPS = f'{DATA}/apps'
ACME = f'{DATA}/acme'
SOCK_DIR = '/run/marx-agent'
SOCK = f'{SOCK_DIR}/agent.sock'
DOMAIN_SUFFIX = 'marx.marcostarace.it'
PANEL_ORIGIN = f'https://{DOMAIN_SUFFIX}'
PORTS = range(20000, 21000)
APACHE_SITES = '/etc/apache2/sites-available'
STORES = f'{DATA}/stores'
COMMUNITY_REPO = 'https://github.com/runtipi/runtipi-appstore.git'
COMMUNITY = f'{STORES}/runtipi'
COMMUNITY_LOGO = 'https://cdn.jsdelivr.net/gh/runtipi/runtipi-appstore@master/apps/{}/metadata/logo.jpg'
# Limiti per le app della community (le ricette non ne indicano)
COMMUNITY_MEM_MAIN, COMMUNITY_MEM_OTHER, COMMUNITY_CPUS = '1536m', '1g', 2
CATEGORY_IT = {
    'utilities': 'Utilità', 'media': 'Media', 'development': 'Sviluppo', 'network': 'Rete', 'automation': 'Automazione',
    'security': 'Sicurezza', 'social': 'Social', 'books': 'Libri', 'data': 'Dati', 'photography': 'Foto',
    'finance': 'Finanza', 'music': 'Musica', 'gaming': 'Giochi', 'ai': 'Intelligenza artificiale', 'featured': 'In evidenza',
}
ENV_KEY_RE = re.compile(r'^[A-Z][A-Z0-9_]{0,63}$')

ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{1,30}$')
VALUE_RE = re.compile(r'^[^\n\r"\'`$\\]{0,200}$')

# Aggiornamento software di MarX (release pubblicate su GitHub)
REPO = 'marco-giuseppe-starace/marx'
CODE = '/var/www/html/marx'
CODE_OWNER = 'marco'
BACKUPS = f'{DATA}/backups'
UPDATE_STATE = f'{DATA}/update.json'
CHECK_EVERY = 3 * 3600

jobs = {}
lock = threading.Lock()  # una sola installazione/disinstallazione alla volta


# ---------- utilità ----------

def run(cmd, cwd=None, timeout=1800):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    return p.returncode, (p.stdout + p.stderr).strip()


def must(cmd, **kw):
    rc, out = run(cmd, **kw)
    if rc != 0:
        raise RuntimeError(out[-800:] or f'comando fallito: {cmd[0]}')
    return out


def load_meta(app_id):
    """Scheda di un'app: prima il catalogo MarX (curato), poi quello della community."""
    if not ID_RE.match(app_id or ''):
        raise ValueError('App non valida')
    path = f'{CATALOG}/{app_id}/meta.json'
    if os.path.isfile(path):
        meta = json.load(open(path))
        meta.update(id=app_id, source='marx', installable=True)
        return meta
    meta = community_meta(app_id)
    if not meta:
        raise ValueError('App non presente nel catalogo')
    return meta


def catalog():
    out, seen = [], set()
    for d in sorted(os.listdir(CATALOG)):
        try:
            out.append(load_meta(d))
            seen.add(d)
        except Exception:
            pass
    if os.path.isdir(f'{COMMUNITY}/apps'):
        for d in sorted(os.listdir(f'{COMMUNITY}/apps')):
            if d in seen or not ID_RE.match(d):
                continue
            m = community_meta(d)
            # Le app che chiedono accessi al sistema non vengono proposte affatto
            if m and m['installable']:
                out.append(m)
    return out


# ---------- catalogo della community (Runtipi) ----------

def community_meta(app_id):
    base = f'{COMMUNITY}/apps/{app_id}'
    try:
        cfg = json.load(open(f'{base}/config.json'))
        spec = json.load(open(f'{base}/docker-compose.json'))
    except Exception:
        return None
    if not cfg.get('available', True) or cfg.get('deprecated') or cfg.get('no_gui'):
        return None
    if 'amd64' not in cfg.get('supported_architectures', ['amd64']):
        return None
    problems = check_spec(spec)
    cats = [CATEGORY_IT.get(c, c.capitalize()) for c in cfg.get('categories', []) if c != 'featured'] or ['Utilità']
    params = []
    for f in cfg.get('form_fields', []):
        key = f.get('env_variable', '')
        if not ENV_KEY_RE.match(key):
            problems.append('campo di configurazione non valido')
            continue
        params.append({'key': key, 'label': f.get('label', key), 'type': f.get('type', 'text'), 'required': bool(f.get('required')),
                       'default': f.get('default', ''), 'min': f.get('min'), 'max': f.get('max'), 'hint': f.get('hint', ''),
                       'generate': f.get('type') == 'random', 'options': f.get('options')})
    return {
        'id': app_id, 'source': 'community', 'name': cfg.get('name', app_id), 'category': cats[0], 'categories': cats,
        'icon': COMMUNITY_LOGO.format(app_id), 'summary': cfg.get('short_desc', ''), 'description': cfg.get('description', ''),
        'version': cfg.get('version'), 'website': cfg.get('website') or cfg.get('source'), 'author': cfg.get('author'),
        'mem': COMMUNITY_MEM_MAIN, 'cpus': COMMUNITY_CPUS, 'url_suffix': cfg.get('url_suffix', ''),
        'uid': cfg.get('uid'), 'gid': cfg.get('gid'),
        'params': params, 'installable': not problems, 'blocked_reason': '; '.join(sorted(set(problems))),
        'start_timeout': 240,
    }


SAFE_HOST_FILES = {'/etc/localtime', '/etc/timezone'}


def check_spec(spec):
    """Elenca le richieste della ricetta che MarX non concede (accessi al sistema)."""
    problems = []
    services = spec.get('services') or []
    if not any(sv.get('isMain') and sv.get('internalPort') for sv in services):
        problems.append('nessuna interfaccia web')
    for sv in services:
        if not isinstance(sv.get('image'), str) or not sv.get('name'):
            problems.append('ricetta incompleta')
        if sv.get('privileged'):
            problems.append('richiede la modalità privilegiata')
        if sv.get('capAdd'):
            problems.append('richiede permessi speciali del kernel')
        if sv.get('devices'):
            problems.append("richiede l'accesso all'hardware")
        if sv.get('networkMode'):
            problems.append('richiede la rete del server')
        if sv.get('pid'):
            problems.append("richiede l'accesso ai processi del server")
        if sv.get('sysctls'):
            problems.append('modifica parametri del kernel')
        if any(not str(o).startswith('no-new-privileges') for o in sv.get('securityOpt') or []):
            problems.append('disattiva protezioni di sicurezza')
        if 'devices' in json.dumps(sv.get('deploy') or {}):
            problems.append("richiede l'accesso all'hardware")
        for v in sv.get('volumes') or []:
            hp = str(v.get('hostPath', ''))
            if hp.startswith('${APP_DATA_DIR}') or hp.startswith('${ROOT_FOLDER_HOST}') or hp in SAFE_HOST_FILES:
                if '..' in hp:
                    problems.append('percorso non valido')
                continue
            problems.append('richiede il controllo di Docker' if 'docker.sock' in hp else 'richiede cartelle di sistema del server')
    return problems


def community_compose(app_id, meta):
    """Converte la ricetta della community in un compose MarX: dati nella cartella dell'app, porte solo locali, limiti di memoria."""
    spec = json.load(open(f'{COMMUNITY}/apps/{app_id}/docker-compose.json'))
    problems = check_spec(spec)
    if problems:
        raise ValueError('App non compatibile: ' + '; '.join(sorted(set(problems))))
    d = app_dir(app_id)
    services = {}
    for sv in spec['services']:
        main = bool(sv.get('isMain') and sv.get('internalPort'))
        out = {'image': sv['image'], 'restart': 'unless-stopped',
               'mem_limit': '${MEM}' if main else COMMUNITY_MEM_OTHER, 'cpus': COMMUNITY_CPUS}
        if main:
            out['ports'] = [f'127.0.0.1:${{PORT}}:{internal_port(sv["internalPort"])}']
        env = sv.get('environment') or []
        if isinstance(env, dict):
            env = [{'key': k, 'value': v} for k, v in env.items()]
        if env:
            out['environment'] = {str(e['key']): str(e.get('value', '')) for e in env if 'key' in e}
        vols = []
        for v in sv.get('volumes') or []:
            hp, cp = str(v['hostPath']), str(v['containerPath'])
            if hp.startswith('${APP_DATA_DIR}'):
                hp = f'{d}/data' + hp[len('${APP_DATA_DIR}'):]
            elif hp.startswith('${ROOT_FOLDER_HOST}'):
                hp = f'{d}/shared' + hp[len('${ROOT_FOLDER_HOST}'):]
            ro = v.get('readOnly') or hp in SAFE_HOST_FILES
            vols.append(f'{hp}:{cp}' + (':ro' if ro else ''))
        if vols:
            out['volumes'] = vols
        dep = sv.get('dependsOn')
        if dep:
            out['depends_on'] = dep
        if sv.get('healthCheck'):
            hc = sv['healthCheck']
            out['healthcheck'] = {k2: hc[k1] for k1, k2 in (('test', 'test'), ('interval', 'interval'), ('timeout', 'timeout'),
                                                               ('retries', 'retries'), ('startPeriod', 'start_period')) if k1 in hc}
        for k1, k2 in (('command', 'command'), ('entrypoint', 'entrypoint'), ('user', 'user'), ('hostname', 'hostname'),
                       ('workingDir', 'working_dir'), ('shmSize', 'shm_size'), ('ulimits', 'ulimits'), ('tty', 'tty'),
                       ('stdinOpen', 'stdin_open'), ('stopGracePeriod', 'stop_grace_period'), ('stopSignal', 'stop_signal'),
                       ('capDrop', 'cap_drop'), ('securityOpt', 'security_opt')):
            if k1 in sv:
                out[k2] = sv[k1]
        services[sv['name']] = out
    # Compose accetta anche JSON: niente dipendenze YAML
    json.dump({'services': services}, open(f'{d}/compose.yml', 'w'), indent=2)
    # File predefiniti forniti dalla ricetta (configurazioni iniziali)
    src = f'{COMMUNITY}/apps/{app_id}/data'
    os.makedirs(f'{d}/data', exist_ok=True)
    if os.path.isdir(src) and not os.listdir(f'{d}/data'):
        shutil.copytree(src, f'{d}/data', dirs_exist_ok=True, symlinks=False)
    if meta.get('uid') is not None:
        run(['chown', '-R', f'{int(meta["uid"])}:{int(meta.get("gid") or meta["uid"])}', f'{d}/data'])


def internal_port(v):
    """Porta interna: un numero oppure una variabile come ${APP_PORT} o ${X-8080}, risolta da compose."""
    if isinstance(v, int) or str(v).isdigit():
        return int(v)
    if re.match(r'^\$\{[A-Z][A-Z0-9_]*(:?-\d+)?\}$', str(v)):
        return str(v)
    raise ValueError('Porta interna non valida')


def community_refresh():
    os.makedirs(STORES, exist_ok=True)
    if os.path.isdir(f'{COMMUNITY}/.git'):
        must(['git', '-C', COMMUNITY, 'fetch', '--depth', '1', '-q', 'origin'], timeout=300)
        must(['git', '-C', COMMUNITY, 'reset', '--hard', '-q', 'FETCH_HEAD'])
    else:
        shutil.rmtree(COMMUNITY, ignore_errors=True)
        must(['git', 'clone', '--depth', '1', '-q', COMMUNITY_REPO, COMMUNITY], timeout=300)
    return sum(1 for d in os.listdir(f'{COMMUNITY}/apps') if community_meta(d))


def community_description(app_id):
    try:
        return open(f'{COMMUNITY}/apps/{app_id}/metadata/description.md').read()[:30000]
    except FileNotFoundError:
        return ''


def app_dir(app_id):
    return f'{APPS}/{app_id}'


def get_state(app_id):
    try:
        return json.load(open(f'{app_dir(app_id)}/state.json'))
    except Exception:
        return None


def save_state(app_id, st):
    os.makedirs(app_dir(app_id), exist_ok=True)
    tmp = f'{app_dir(app_id)}/state.json.tmp'
    json.dump(st, open(tmp, 'w'))
    os.replace(tmp, f'{app_dir(app_id)}/state.json')


def domain(app_id):
    return f'{app_id}.{DOMAIN_SUFFIX}'


def compose(app_id, *args, timeout=1800):
    d = app_dir(app_id)
    return run(['docker', 'compose', '-p', f'marx-{app_id}', '--env-file', f'{d}/.env', '-f', f'{d}/compose.yml', *args],
               cwd=d, timeout=timeout)


def free_port():
    used = set()
    for a in os.listdir(APPS):
        st = get_state(a)
        if st and st.get('port'):
            used.add(st['port'])
    for p in PORTS:
        if p in used:
            continue
        with socket.socket() as s:
            if s.connect_ex(('127.0.0.1', p)) != 0:
                return p
    raise RuntimeError('Nessuna porta libera')


def write_env(meta, app_id, params, port, old_env=None):
    env = {'PORT': str(port), 'DOMAIN': domain(app_id), 'MEM': meta.get('mem', '512m'), 'CPUS': str(meta.get('cpus', 1)),
           'TZ': 'Europe/Rome'}
    if meta.get('source') == 'community':
        # Variabili che le ricette Runtipi si aspettano
        env.update(APP_DOMAIN=domain(app_id), APP_PROTOCOL='https', APP_PORT=str(port), LOCAL_DOMAIN=DOMAIN_SUFFIX,
                   INTERNAL_IP='127.0.0.1', APP_HOST='127.0.0.1', NETWORK_INTERFACE='eth0',
                   APP_DATA_DIR=f'{app_dir(app_id)}/data', ROOT_FOLDER_HOST=f'{app_dir(app_id)}/shared', APP_ID=app_id)
    for p in meta.get('params', []):
        key = p['key']
        if old_env and key in old_env:
            env[key] = old_env[key]  # reinstallazione con dati conservati: stesse credenziali
        elif p.get('generate'):
            env[key] = secrets.token_hex(max(16, int(p.get('min') or 32) // 2))
        else:
            v = str(params.get(key, p.get('default', '')) or '').strip()
            if p.get('type') == 'boolean':
                v = 'true' if v.lower() in ('true', '1', 'on', 'yes') else 'false'
            if p.get('type') == 'number' and v and not re.match(r'^-?\d+(\.\d+)?$', v):
                raise ValueError(f'{p["label"]}: deve essere un numero')
            if p.get('required') and not v:
                raise ValueError(f'Campo obbligatorio: {p["label"]}')
            if not VALUE_RE.match(v):
                raise ValueError(f'Valore non valido per {p["label"]} (niente virgolette, $ o a capo)')
            if p.get('type') not in ('number', 'boolean') and v:
                if p.get('min') and len(v) < int(p['min']):
                    raise ValueError(f'{p["label"]}: almeno {p["min"]} caratteri')
                if p.get('max') and len(v) > int(p['max']):
                    raise ValueError(f'{p["label"]}: al massimo {p["max"]} caratteri')
            env[key] = v
    with open(f'{app_dir(app_id)}/.env', 'w') as f:
        for k, v in env.items():
            f.write(f'{k}={v}\n')
    os.chmod(f'{app_dir(app_id)}/.env', 0o600)
    return env


def read_env(app_id):
    env = {}
    try:
        for line in open(f'{app_dir(app_id)}/.env'):
            if '=' in line:
                k, v = line.rstrip('\n').split('=', 1)
                env[k] = v
    except FileNotFoundError:
        pass
    return env


# ---------- Apache e certificati ----------

def http_vhost(dom):
    return f"""# Gestito da MarX Soft Store: non modificare a mano
<VirtualHost *:80>
    ServerName {dom}
    Alias /.well-known/acme-challenge/ {ACME}/.well-known/acme-challenge/
    <Directory {ACME}>
        Require all granted
    </Directory>
    RewriteEngine On
    RewriteCond %{{REQUEST_URI}} !^/\\.well-known/acme-challenge/
    RewriteRule ^ https://%{{SERVER_NAME}}%{{REQUEST_URI}} [END,NE,R=permanent]
    ErrorLog ${{APACHE_LOG_DIR}}/marx-apps-error.log
    CustomLog ${{APACHE_LOG_DIR}}/marx-apps-access.log combined
</VirtualHost>
"""


def ssl_vhost(dom, port):
    return f"""# Gestito da MarX Soft Store: non modificare a mano
<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName {dom}
    ProxyPreserveHost On
    ProxyRequests Off
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"
    RewriteEngine On
    RewriteCond %{{HTTP:Upgrade}} =websocket [NC]
    RewriteRule ^/(.*) ws://127.0.0.1:{port}/$1 [P,L]
    ProxyPass / http://127.0.0.1:{port}/ timeout=300
    ProxyPassReverse / http://127.0.0.1:{port}/
    # Permette di aprire l'app in una finestra di MarX (solo da MarX)
    Header unset X-Frame-Options
    Header always unset X-Frame-Options
    Header edit Content-Security-Policy "frame-ancestors[^;]*" "frame-ancestors 'self' {PANEL_ORIGIN}"
    Header always edit Content-Security-Policy "frame-ancestors[^;]*" "frame-ancestors 'self' {PANEL_ORIGIN}"
    ErrorLog ${{APACHE_LOG_DIR}}/marx-apps-error.log
    CustomLog ${{APACHE_LOG_DIR}}/marx-apps-access.log combined
    Include /etc/letsencrypt/options-ssl-apache.conf
    SSLCertificateFile /etc/letsencrypt/live/{dom}/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/{dom}/privkey.pem
</VirtualHost>
</IfModule>
"""


def apache_reload():
    rc, out = run(['apache2ctl', 'configtest'])
    if rc != 0:
        raise RuntimeError('Configurazione Apache non valida: ' + out[-400:])
    must(['systemctl', 'reload', 'apache2'])


def site_files(app_id):
    return f'{APACHE_SITES}/marx-app-{app_id}.conf', f'{APACHE_SITES}/marx-app-{app_id}-ssl.conf'


def publish(app_id, port):
    dom = domain(app_id)
    http_conf, ssl_conf = site_files(app_id)
    os.makedirs(f'{ACME}/.well-known/acme-challenge', exist_ok=True)
    open(http_conf, 'w').write(http_vhost(dom))
    must(['a2ensite', '-q', os.path.basename(http_conf)[:-5]])
    apache_reload()
    if not os.path.isfile(f'/etc/letsencrypt/live/{dom}/fullchain.pem'):
        must(['certbot', 'certonly', '--webroot', '-w', ACME, '-d', dom, '--non-interactive', '--agree-tos',
              '--keep-until-expiring', '--quiet'], timeout=300)
    open(ssl_conf, 'w').write(ssl_vhost(dom, port))
    must(['a2ensite', '-q', os.path.basename(ssl_conf)[:-5]])
    apache_reload()


def unpublish(app_id, delete_cert):
    for conf in site_files(app_id):
        name = os.path.basename(conf)[:-5]
        run(['a2dissite', '-q', name])
        if os.path.exists(conf):
            os.remove(conf)
    apache_reload()
    if delete_cert:
        run(['certbot', 'delete', '--cert-name', domain(app_id), '--non-interactive'], timeout=120)


# ---------- lavori in background ----------

def new_job(app_id, kind):
    jid = uuid.uuid4().hex[:12]
    jobs[jid] = {'id': jid, 'app': app_id, 'kind': kind, 'progress': 0, 'step': 'In coda…', 'done': False, 'error': None,
                 'started': time.time()}
    return jid


def step(jid, progress, text):
    jobs[jid].update(progress=progress, step=text)


def wait_http(port, seconds=120):
    end = time.time() + seconds
    while time.time() < end:
        with socket.socket() as s:
            s.settimeout(2)
            if s.connect_ex(('127.0.0.1', port)) == 0:
                return True
        time.sleep(2)
    return False


def do_install(jid, app_id, params):
    with lock:
        try:
            meta = load_meta(app_id)
            if not meta.get('installable'):
                raise ValueError('App non compatibile con MarX: ' + meta.get('blocked_reason', ''))
            st = get_state(app_id)
            if st and st.get('status') == 'installed':
                raise ValueError("L'app è già installata")
            d = app_dir(app_id)
            os.makedirs(d, exist_ok=True)
            os.chmod(d, 0o700)
            step(jid, 5, 'Preparazione…')
            old_env = read_env(app_id) if st and st.get('status') == 'removed-keep-data' else None
            port = (st or {}).get('port') if old_env else None
            port = port or free_port()
            if meta['source'] == 'marx':
                shutil.copy(f'{CATALOG}/{app_id}/compose.yml', f'{d}/compose.yml')
            else:
                community_compose(app_id, meta)
            write_env(meta, app_id, params, port, old_env)
            save_state(app_id, {'status': 'installing', 'port': port, 'version': meta.get('version'), 'installed_at': None})
            step(jid, 15, 'Download in corso (può richiedere qualche minuto)…')
            rc, out = compose(app_id, 'pull', '--quiet')
            if rc != 0:
                raise RuntimeError('Download non riuscito: ' + out[-400:])
            step(jid, 60, 'Avvio…')
            rc, out = compose(app_id, 'up', '-d', '--remove-orphans')
            if rc != 0:
                raise RuntimeError('Avvio non riuscito: ' + out[-400:])
            step(jid, 72, 'Attendo che l\'app risponda…')
            wait_http(port, meta.get('start_timeout', 120))
            step(jid, 80, 'Certificato HTTPS e indirizzo web…')
            publish(app_id, port)
            save_state(app_id, {'status': 'installed', 'port': port, 'version': meta.get('version'), 'installed_at': int(time.time())})
            step(jid, 100, 'Installata')
        except Exception as e:
            jobs[jid]['error'] = str(e)
            st = get_state(app_id) or {}
            st['status'] = 'error'
            st['error'] = str(e)
            save_state(app_id, st)
        finally:
            jobs[jid]['done'] = True


def do_uninstall(jid, app_id, keep_data):
    with lock:
        try:
            load_meta(app_id)
            step(jid, 20, 'Arresto…')
            if os.path.isfile(f'{app_dir(app_id)}/compose.yml'):
                args = ['down', '--remove-orphans'] + ([] if keep_data else ['-v', '--rmi', 'all'])
                rc, out = compose(app_id, *args)
                if rc != 0:
                    raise RuntimeError(out[-400:])
            step(jid, 70, 'Rimozione indirizzo web…')
            unpublish(app_id, delete_cert=not keep_data)
            if keep_data:
                st = get_state(app_id) or {}
                st['status'] = 'removed-keep-data'
                save_state(app_id, st)
            else:
                shutil.rmtree(app_dir(app_id), ignore_errors=True)
            step(jid, 100, 'Disinstallata')
        except Exception as e:
            jobs[jid]['error'] = str(e)
        finally:
            jobs[jid]['done'] = True


def do_update(jid, app_id):
    with lock:
        try:
            step(jid, 20, 'Download della nuova versione…')
            rc, out = compose(app_id, 'pull', '--quiet')
            if rc != 0:
                raise RuntimeError(out[-400:])
            step(jid, 70, 'Riavvio…')
            rc, out = compose(app_id, 'up', '-d', '--remove-orphans')
            if rc != 0:
                raise RuntimeError(out[-400:])
            run(['docker', 'image', 'prune', '-f'])
            step(jid, 100, 'Aggiornata')
        except Exception as e:
            jobs[jid]['error'] = str(e)
        finally:
            jobs[jid]['done'] = True


def start_job(target, app_id, kind, *args):
    jid = new_job(app_id, kind)
    threading.Thread(target=target, args=(jid, app_id, *args), daemon=True).start()
    return jid


# ---------- aggiornamento software ----------

def as_owner(*cmd, timeout=900):
    """Comandi sul codice eseguiti come proprietario dei file (non come root)."""
    return run(['runuser', '-u', CODE_OWNER, '--', 'env', f'HOME=/home/{CODE_OWNER}', 'COMPOSER_HOME=/home/' + CODE_OWNER + '/.config/composer', *cmd], cwd=CODE, timeout=timeout)


def as_web(*cmd, timeout=600):
    return run(['runuser', '-u', 'www-data', '--', *cmd], cwd=CODE, timeout=timeout)


def current_version():
    m = re.search(r"'version'\s*=>\s*'([^']+)'", open(f'{CODE}/config/marx.php').read())
    return m.group(1) if m else '0.0.0'


def vtuple(v):
    return tuple(int(x) for x in re.findall(r'\d+', v)[:3]) + (0,) * (3 - len(re.findall(r'\d+', v)[:3]))


def github(path):
    import urllib.request
    req = urllib.request.Request(f'https://api.github.com/repos/{REPO}{path}', headers={'User-Agent': 'MarX-updater', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def changelog_for(tag, version):
    """Novità della versione, prese dal CHANGELOG.md di quella release (API di GitHub, sempre aggiornata)."""
    import base64
    try:
        text = base64.b64decode(github(f'/contents/CHANGELOG.md?ref={tag}')['content']).decode()
        m = re.search(rf'^## {re.escape(version)}\b.*?(?=^## |\Z)', text, re.S | re.M)
        return m.group(0).strip() if m else ''
    except Exception:
        return ''


def read_update_state():
    try:
        return json.load(open(UPDATE_STATE))
    except Exception:
        return {'history': []}


def write_update_state(st):
    tmp = UPDATE_STATE + '.tmp'
    json.dump(st, open(tmp, 'w'))
    os.replace(tmp, UPDATE_STATE)


def update_check(force=False):
    st = read_update_state()
    cur = current_version()
    if force or time.time() - st.get('checked_at', 0) > CHECK_EVERY or not st.get('latest'):
        latest = None
        try:
            rel = github('/releases/latest')
            latest = {'tag': rel['tag_name'], 'version': rel['tag_name'].lstrip('v'), 'name': rel.get('name') or rel['tag_name'],
                      'notes': rel.get('body') or '', 'published': rel.get('published_at')}
        except Exception:
            try:
                tags = [t['name'] for t in github('/tags?per_page=100') if re.match(r'^v?\d+\.\d+\.\d+$', t['name'])]
                if tags:
                    tag = max(tags, key=vtuple)
                    latest = {'tag': tag, 'version': tag.lstrip('v'), 'name': 'MarX ' + tag.lstrip('v'), 'notes': '', 'published': None}
            except Exception as e:
                st['error'] = f'Impossibile contattare GitHub: {e}'
        if latest:
            if not latest['notes']:
                latest['notes'] = changelog_for(latest['tag'], latest['version'])
            st['latest'] = latest
            st.pop('error', None)
        st['checked_at'] = int(time.time())
        write_update_state(st)
    latest = st.get('latest')
    return {'current': cur, 'latest': latest, 'available': bool(latest) and vtuple(latest['version']) > vtuple(cur),
            'checked_at': st.get('checked_at'), 'error': st.get('error'), 'history': st.get('history', [])[-10:][::-1], 'running': any(
                j['kind'] == 'system-update' and not j['done'] for j in jobs.values())}


def env_value(key):
    for line in open(f'{CODE}/.env'):
        if line.startswith(key + '='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    return ''


def db_dump(path):
    env = {**os.environ, 'MYSQL_PWD': env_value('DB_PASSWORD')}
    with open(path, 'wb') as f:
        p = subprocess.run(['mysqldump', '--single-transaction', '--routines', '-u', env_value('DB_USERNAME'), '-h', env_value('DB_HOST') or '127.0.0.1', env_value('DB_DATABASE')],
                           stdout=f, stderr=subprocess.PIPE, env=env, timeout=600)
    if p.returncode != 0:
        raise RuntimeError('Backup del database non riuscito: ' + p.stderr.decode()[-300:])


def db_restore(path):
    env = {**os.environ, 'MYSQL_PWD': env_value('DB_PASSWORD')}
    with open(path, 'rb') as f:
        subprocess.run(['mysql', '-u', env_value('DB_USERNAME'), '-h', env_value('DB_HOST') or '127.0.0.1', env_value('DB_DATABASE')], stdin=f, env=env, timeout=600, check=True)


def install_deps():
    """Librerie PHP: Composer gira come proprietario del codice ma senza script; la scoperta dei pacchetti
    di Laravel (che scrive in bootstrap/cache, dell'utente web) gira come www-data dopo aver tolto le cache vecchie."""
    rc, out = as_owner('composer', 'install', '--no-interaction', '--no-dev', '--optimize-autoloader', '--no-scripts', '--quiet', timeout=900)
    if rc != 0:
        return rc, out
    for f in ('packages.php', 'services.php', 'config.php', 'routes-v7.php', 'events.php'):
        try:
            os.remove(f'{CODE}/bootstrap/cache/{f}')
        except FileNotFoundError:
            pass
    return as_web('php', 'artisan', 'package:discover', '--no-interaction')


def site_ok():
    import urllib.request
    url = (env_value('APP_URL') or 'http://127.0.0.1').rstrip('/') + '/login'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'MarX-updater'}), timeout=20) as r:
            return r.status == 200
    except Exception:
        return False


def do_system_update(jid, _app, target):
    with lock:
        st = read_update_state()
        cur = current_version()
        entry = {'from': cur, 'to': target['version'], 'at': int(time.time()), 'ok': False}
        prev = None
        dump = None
        touched_db = False  # il database va ripristinato solo se le migrazioni sono partite
        try:
            step(jid, 5, 'Controllo del sistema…')
            rc, out = as_owner('git', 'status', '--porcelain', '--untracked-files=no')
            if rc != 0:
                raise RuntimeError('Il codice di MarX non è un repository git valido.')
            if out.strip():
                raise RuntimeError('Ci sono modifiche locali non pubblicate: aggiornamento annullato per non perderle.')
            rc, prev = as_owner('git', 'rev-parse', 'HEAD')
            prev = prev.strip()

            step(jid, 15, 'Backup del database…')
            os.makedirs(BACKUPS, mode=0o700, exist_ok=True)
            dump = f'{BACKUPS}/db-{cur}-{time.strftime("%Y%m%d-%H%M%S")}.sql'
            db_dump(dump)
            for old in sorted(f for f in os.listdir(BACKUPS) if f.startswith('db-'))[:-5]:
                os.remove(os.path.join(BACKUPS, old))

            step(jid, 30, f'Download di MarX {target["version"]}…')
            tag = target['tag']
            # «+»: l'etichetta locale può essere rimasta da un tentativo precedente
            rc, out = as_owner('git', 'fetch', '--quiet', f'https://github.com/{REPO}.git', f'+refs/tags/{tag}:refs/tags/{tag}', timeout=300)
            if rc != 0:
                raise RuntimeError('Download non riuscito: ' + out[-300:])
            rc, out = as_owner('git', 'merge', '--ff-only', '--quiet', tag)
            if rc != 0:
                raise RuntimeError('La nuova versione non si applica alla copia installata: ' + out[-300:])

            step(jid, 50, 'Installazione delle librerie…')
            rc, out = install_deps()
            if rc != 0:
                raise RuntimeError('Installazione delle librerie non riuscita: ' + out[-300:])

            step(jid, 70, 'Aggiornamento del database…')
            touched_db = True
            rc, out = as_web('php', 'artisan', 'migrate', '--force', '--no-interaction')
            if rc != 0:
                raise RuntimeError('Aggiornamento del database non riuscito: ' + out[-300:])

            step(jid, 82, 'Ottimizzazione…')
            as_web('php', 'artisan', 'optimize:clear')
            rc, out = as_web('php', 'artisan', 'optimize')
            if rc != 0:
                raise RuntimeError('Ottimizzazione non riuscita: ' + out[-300:])

            step(jid, 92, 'Verifica…')
            if not site_ok():
                raise RuntimeError('Dopo l\'aggiornamento MarX non risponde correttamente.')

            rc, changed = as_owner('git', 'diff', '--name-only', prev, 'HEAD', '--', 'agent')
            entry['ok'] = True
            step(jid, 100, f'MarX {target["version"]} installato')
            if changed.strip():
                # L'agente stesso è cambiato: si reinstalla tra qualche secondo, dopo aver risposto
                run(['systemd-run', '--on-active=5', '--unit', f'marx-agent-reinstall-{int(time.time())}', f'{CODE}/agent/install.sh'])
        except Exception as e:
            entry['error'] = str(e)
            jobs[jid]['error'] = str(e)
            if prev:
                step(jid, 95, 'Ripristino della versione precedente…')
                as_owner('git', 'reset', '--hard', '--quiet', prev)
                install_deps()
                if dump and touched_db:
                    try:
                        db_restore(dump)
                    except Exception:
                        pass
                as_web('php', 'artisan', 'optimize:clear')
                as_web('php', 'artisan', 'optimize')
                entry['rolled_back'] = True
        finally:
            st = read_update_state()
            st.setdefault('history', []).append(entry)
            st['history'] = st['history'][-30:]
            write_update_state(st)
            jobs[jid]['done'] = True


# ---------- stato e statistiche ----------

def containers():
    """Stato e consumi dei container MarX, raggruppati per app."""
    rc, out = run(['docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project', '--format',
                   '{{.Names}}\t{{.State}}\t{{.Label "com.docker.compose.project"}}'])
    info = {}
    for line in out.splitlines():
        try:
            name, state, project = line.split('\t')
        except ValueError:
            continue
        if project.startswith('marx-'):
            info[name] = {'app': project[5:], 'state': state}
    if info:
        rc, out = run(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *info.keys()], timeout=30)
        for line in out.splitlines():
            try:
                s = json.loads(line)
            except ValueError:
                continue
            if s.get('Name') in info:
                info[s['Name']].update(cpu=s.get('CPUPerc'), mem=s.get('MemUsage'), memp=s.get('MemPerc'), net=s.get('NetIO'))
    return info


def installed():
    cs = containers()
    meta = {}
    for a in os.listdir(APPS):
        try:
            meta[a] = load_meta(a)
        except Exception:
            pass
    out = []
    for a in sorted(os.listdir(APPS)):
        st = get_state(a)
        if not st or a not in meta:
            continue
        mine = [c for c in cs.values() if c['app'] == a]
        running = bool(mine) and all(c['state'] == 'running' for c in mine)
        m = meta[a]
        out.append({'id': a, 'name': m.get('name'), 'icon': m.get('icon'), 'category': m.get('category'), 'mem_limit': m.get('mem'),
                    'status': st.get('status'), 'error': st.get('error'), 'running': running,
                    'url': f'https://{domain(a)}{m.get("url_suffix") or ""}', 'source': m.get('source'), 'installed_at': st.get('installed_at'),
                    'containers': [{k: v for k, v in c.items() if k != 'app'} | {'name': n} for n, c in cs.items() if c['app'] == a]})
    return out


_cpu_prev = None


def cpu_percent():
    global _cpu_prev
    vals = list(map(int, open('/proc/stat').readline().split()[1:]))
    idle, total = vals[3] + vals[4], sum(vals)
    if _cpu_prev is None:
        _cpu_prev = (idle, total)
        time.sleep(0.25)
        return cpu_percent()
    di, dt = idle - _cpu_prev[0], total - _cpu_prev[1]
    _cpu_prev = (idle, total)
    return round(100 * (1 - di / dt), 1) if dt else 0.0


def system_stats():
    mem = {}
    for line in open('/proc/meminfo'):
        k, v = line.split(':')
        mem[k] = int(v.split()[0]) * 1024
    fs = os.statvfs('/')
    return {
        'cpu': cpu_percent(), 'cores': os.cpu_count(), 'load': open('/proc/loadavg').read().split()[:3],
        'mem_total': mem['MemTotal'], 'mem_available': mem['MemAvailable'],
        'disk_total': fs.f_blocks * fs.f_frsize, 'disk_free': fs.f_bavail * fs.f_frsize,
        'uptime': int(float(open('/proc/uptime').read().split()[0])),
    }


# ---------- comandi ----------

def handle(req):
    cmd = req.get('cmd')
    app_id = req.get('app')
    if cmd == 'ping':
        return 'pong'
    if cmd == 'catalog':
        return catalog()
    if cmd == 'installed':
        return installed()
    if cmd == 'stats':
        return {'system': system_stats(), 'apps': installed()}
    if cmd == 'describe':
        meta = load_meta(app_id)
        return community_description(app_id) if meta['source'] == 'community' else ''
    if cmd == 'store_refresh':
        with lock:
            return {'count': community_refresh()}
    if cmd == 'update_check':
        return update_check(bool(req.get('force')))
    if cmd == 'update_apply':
        info = update_check(True)
        if not info['available']:
            raise ValueError('MarX è già aggiornato')
        if info['running']:
            raise ValueError('Un aggiornamento è già in corso')
        return {'job': start_job(do_system_update, 'marx', 'system-update', info['latest'])}
    if cmd == 'job':
        j = jobs.get(str(req.get('id')))
        if not j:
            raise ValueError('Operazione sconosciuta')
        return j
    if cmd == 'install':
        load_meta(app_id)
        params = req.get('params') or {}
        if not isinstance(params, dict):
            raise ValueError('Parametri non validi')
        return {'job': start_job(do_install, app_id, 'install', params)}
    if cmd == 'uninstall':
        load_meta(app_id)
        return {'job': start_job(do_uninstall, app_id, 'uninstall', bool(req.get('keep_data')))}
    if cmd == 'update':
        load_meta(app_id)
        return {'job': start_job(do_update, app_id, 'update')}
    if cmd in ('start', 'stop', 'restart'):
        load_meta(app_id)
        st = get_state(app_id)
        if not st or st.get('status') != 'installed':
            raise ValueError("L'app non è installata")
        rc, out = compose(app_id, cmd, timeout=180)
        if rc != 0:
            raise RuntimeError(out[-400:])
        return True
    if cmd == 'logs':
        load_meta(app_id)
        lines = max(10, min(int(req.get('lines') or 200), 1000))
        if not os.path.isfile(f'{app_dir(app_id)}/compose.yml'):
            return ''
        rc, out = compose(app_id, 'logs', '--no-color', '--tail', str(lines), timeout=30)
        return out[-200000:]
    raise ValueError('Comando sconosciuto')


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            line = self.rfile.readline(65536)
            req = json.loads(line or b'{}')
            resp = {'ok': True, 'data': handle(req)}
        except Exception as e:
            resp = {'ok': False, 'error': str(e)}
        self.wfile.write((json.dumps(resp) + '\n').encode())


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def main():
    os.makedirs(APPS, exist_ok=True)
    os.makedirs(f'{ACME}/.well-known/acme-challenge', exist_ok=True)
    os.makedirs(SOCK_DIR, exist_ok=True)
    if os.path.exists(SOCK):
        os.remove(SOCK)
    srv = Server(SOCK, Handler)
    import grp
    os.chown(SOCK, 0, grp.getgrnam('www-data').gr_gid)
    os.chmod(SOCK, 0o660)
    os.chown(SOCK_DIR, 0, grp.getgrnam('www-data').gr_gid)
    os.chmod(SOCK_DIR, 0o750)
    srv.serve_forever()


if __name__ == '__main__':
    main()
