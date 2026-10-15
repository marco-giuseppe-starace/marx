#!/usr/bin/env python3
"""
Terminale di MarX: apre una shell vera come utente marco e la collega al browser con un WebSocket.

Gira come servizio separato (marx-term, utente marco) e ascolta solo su un socket Unix
che Apache inoltra da /term/ws. Ogni connessione deve presentare un gettone firmato dal sito
(HMAC con il segreto in /etc/marx-term/secret), valido 30 secondi e usabile una volta sola:
il sito lo rilascia solo agli amministratori dopo aver controllato la password.
"""
import asyncio
import base64
import fcntl
import grp
import hashlib
import hmac
import json
import os
import pty
import signal
import struct
import termios
import time
from urllib.parse import parse_qs, urlsplit

SOCK = '/run/marx-term/term.sock'
SECRET_FILE = '/etc/marx-term/secret'
ORIGINS = {'https://marx.marcostarace.it', 'https://dev.marx.marcostarace.it'}
MAX_SESSIONS = 5
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

used_nonces = {}  # nonce -> scadenza
sessions = 0


def secret():
    with open(SECRET_FILE, 'rb') as f:
        return f.read().strip()


def check_token(tok):
    """Gettone «payload.firma», entrambi in base64url; payload JSON {u, exp, n}."""
    try:
        p64, s64 = tok.split('.', 1)
        pad = lambda s: s + '=' * (-len(s) % 4)
        payload = base64.urlsafe_b64decode(pad(p64))
        sig = base64.urlsafe_b64decode(pad(s64))
        if not hmac.compare_digest(sig, hmac.new(secret(), payload, hashlib.sha256).digest()):
            return None
        data = json.loads(payload)
        now = time.time()
        for n, exp in list(used_nonces.items()):
            if exp < now:
                del used_nonces[n]
        if data['exp'] < now or data['n'] in used_nonces:
            return None
        used_nonces[data['n']] = data['exp']
        return data
    except Exception:
        return None


async def read_frame(reader):
    """Un frame WebSocket dal browser (sempre mascherato). Restituisce (opcode, dati)."""
    h = await reader.readexactly(2)
    op, ln = h[0] & 0x0F, h[1] & 0x7F
    if ln == 126:
        ln = struct.unpack('!H', await reader.readexactly(2))[0]
    elif ln == 127:
        ln = struct.unpack('!Q', await reader.readexactly(8))[0]
    if ln > 1 << 20:
        raise ValueError('frame troppo grande')
    mask = await reader.readexactly(4) if h[1] & 0x80 else b'\0\0\0\0'
    data = bytearray(await reader.readexactly(ln))
    for i in range(ln):
        data[i] ^= mask[i % 4]
    return op, bytes(data), bool(h[0] & 0x80)


def frame(op, data):
    n = len(data)
    head = bytes([0x80 | op])
    if n < 126:
        head += bytes([n])
    elif n < 1 << 16:
        head += bytes([126]) + struct.pack('!H', n)
    else:
        head += bytes([127]) + struct.pack('!Q', n)
    return head + data


async def http_error(writer, code, text):
    writer.write(f'HTTP/1.1 {code} {text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'.encode())
    await writer.drain()
    writer.close()


async def handle(reader, writer):
    global sessions
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
    except Exception:
        writer.close()
        return
    lines = head.decode('latin-1').split('\r\n')
    try:
        _method, target, _ = lines[0].split(' ', 2)
    except ValueError:
        return await http_error(writer, 400, 'Bad Request')
    hdr = {k.strip().lower(): v.strip() for k, _, v in (l.partition(':') for l in lines[1:] if l)}
    q = parse_qs(urlsplit(target).query)
    if hdr.get('origin') not in ORIGINS or 'websocket' not in hdr.get('upgrade', '').lower() or 'sec-websocket-key' not in hdr:
        return await http_error(writer, 403, 'Forbidden')
    if not check_token(q.get('t', [''])[0]):
        return await http_error(writer, 401, 'Unauthorized')
    if sessions >= MAX_SESSIONS:
        return await http_error(writer, 429, 'Too Many Sessions')
    accept = base64.b64encode(hashlib.sha1((hdr['sec-websocket-key'] + GUID).encode()).digest()).decode()
    writer.write(f'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n'.encode())
    await writer.drain()

    cols = max(20, min(500, int((q.get('cols') or ['100'])[0] or 100)))
    rows = max(5, min(200, int((q.get('rows') or ['30'])[0] or 30)))
    pid, fd = pty.fork()
    if pid == 0:  # processo figlio: la shell di login dell'utente
        home = os.path.expanduser('~')
        os.chdir(home)
        env = {'HOME': home, 'USER': os.environ.get('USER', 'marco'), 'LOGNAME': os.environ.get('USER', 'marco'), 'SHELL': '/bin/bash',
               'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'LANG': 'it_IT.UTF-8', 'LC_ALL': 'C.UTF-8',
               'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'TERM_PROGRAM': 'MarX'}
        os.execve('/bin/bash', ['-bash'], env)
    sessions += 1
    loop = asyncio.get_running_loop()
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    os.set_blocking(fd, False)
    out = asyncio.Queue()

    def on_output():
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b''
        out.put_nowait(data)
        if not data:
            loop.remove_reader(fd)

    loop.add_reader(fd, on_output)

    async def pump_out():
        while True:
            data = await out.get()
            if not data:
                break
            while not out.empty() and len(data) < 65536:  # accorpa i pezzi piccoli
                more = out.get_nowait()
                if not more:
                    out.put_nowait(b'')
                    break
                data += more
            writer.write(frame(2, data))
            await writer.drain()
        writer.write(frame(8, struct.pack('!H', 1000)))
        await writer.drain()

    async def pump_in():
        buf = b''
        while True:
            op, data, fin = await read_frame(reader)
            if op == 8:
                return
            if op == 9:
                writer.write(frame(10, data))
                continue
            if op in (0, 1, 2):
                buf += data
                if not fin:
                    continue
                msg, buf = buf, b''
                if msg[:1] == b'0':  # tasti digitati
                    os.write(fd, msg[1:])
                elif msg[:1] == b'1':  # nuove dimensioni della finestra
                    try:
                        d = json.loads(msg[1:])
                        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', max(5, min(200, int(d['rows']))), max(20, min(500, int(d['cols']))), 0, 0))
                    except Exception:
                        pass

    tasks = [asyncio.create_task(pump_out()), asyncio.create_task(pump_in())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except Exception:
        pass
    finally:
        for t in tasks:
            t.cancel()
        try:
            loop.remove_reader(fd)
        except Exception:
            pass
        try:
            os.killpg(pid, signal.SIGHUP)
        except Exception:
            pass
        try:
            os.close(fd)
        except OSError:
            pass
        await asyncio.sleep(.5)
        try:
            os.waitpid(pid, os.WNOHANG) == (0, 0) and os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        except Exception:
            pass
        sessions -= 1
        try:
            writer.close()
        except Exception:
            pass


async def main():
    if os.path.exists(SOCK):
        os.unlink(SOCK)
    server = await asyncio.start_unix_server(handle, SOCK)
    os.chown(SOCK, -1, grp.getgrnam('www-data').gr_gid)  # Apache (www-data) deve poterlo aprire
    os.chmod(SOCK, 0o660)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    asyncio.run(main())
