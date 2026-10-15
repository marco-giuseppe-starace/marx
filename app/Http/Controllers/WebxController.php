<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * webX: prima di aprire un sito in una finestra, controlla se il sito permette di essere
 * incorporato (X-Frame-Options / CSP frame-ancestors) e ne legge il titolo.
 *
 * Il server non fa da proxy: la pagina viene poi caricata direttamente dal browser dell'utente.
 * Per evitare che questo controllo venga usato per sondare la rete interna, gli indirizzi
 * privati, locali o riservati vengono rifiutati e l'IP verificato è quello effettivamente usato.
 */
class WebxController extends Controller
{
    private const MAX_REDIRECTS = 5;

    private const PANEL_HOST = 'marx.marcostarace.it';

    public function check(Request $request)
    {
        $url = $request->validate(['url' => ['required', 'string', 'max:2000']])['url'];

        return Cache::remember('webx:'.sha1($url), now()->addMinutes(10), fn () => $this->inspect($url));
    }

    private function inspect(string $url): array
    {
        for ($i = 0; $i <= self::MAX_REDIRECTS; $i++) {
            $parts = parse_url($url);
            $scheme = strtolower($parts['scheme'] ?? '');
            $host = strtolower($parts['host'] ?? '');
            if (! in_array($scheme, ['http', 'https'], true) || $host === '' || isset($parts['user'])) {
                return $this->result(false, $url, 'invalid');
            }

            $ip = $this->publicIp($host);
            if ($ip === null) {
                return $this->result(false, $url, 'unreachable');
            }
            if ($ip === false) {
                return $this->result(false, $url, 'private');
            }

            $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
            $res = $this->fetch($url, "{$host}:{$port}:".(str_contains($ip, ':') ? "[{$ip}]" : $ip));
            if ($res === null) {
                return $this->result(false, $url, 'unreachable');
            }

            if ($res['status'] >= 300 && $res['status'] < 400 && isset($res['headers']['location'])) {
                $url = $this->absolute($url, $res['headers']['location']);

                continue;
            }

            $frameable = $this->frameable($res['headers']['x-frame-options'] ?? null, $res['headers']['content-security-policy'] ?? null);
            $title = str_contains(strtolower($res['headers']['content-type'] ?? ''), 'html') ? $this->title($res['body']) : null;

            return $this->result($frameable, $url, $frameable ? null : 'blocked', $title);
        }

        return $this->result(false, $url, 'unreachable');
    }

    /** Richiesta GET con cURL: usa l'IP già verificato e legge solo l'inizio della pagina. */
    private function fetch(string $url, string $resolve): ?array
    {
        $headers = [];
        $body = '';
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RESOLVE => [$resolve],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_ENCODING => '',
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 webX',
            CURLOPT_HTTPHEADER => ['Accept: text/html,*/*;q=0.8', 'Accept-Language: it-IT,it;q=0.9,en;q=0.8'],
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers) {
                if (str_starts_with($line, 'HTTP/')) {
                    $headers = [];  // nuova risposta (es. dopo un 100 Continue)
                } elseif (str_contains($line, ':')) {
                    [$k, $v] = explode(':', $line, 2);
                    $k = strtolower(trim($k));
                    $headers[$k] = isset($headers[$k]) ? $headers[$k].', '.trim($v) : trim($v);
                }

                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$body) {
                $body .= $chunk;

                return strlen($body) > 150_000 ? 0 : strlen($chunk);  // basta l'inizio: interrompe il download
            },
        ]);
        curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $errno = curl_errno($ch);
        curl_close($ch);
        if (! $status || ($errno && $errno !== CURLE_WRITE_ERROR)) {
            return null;
        }

        return ['status' => $status, 'headers' => $headers, 'body' => $body];
    }

    /** IP pubblico del sito; null se il nome non esiste, false se punta a una rete privata o riservata. */
    private function publicIp(string $host): string|false|null
    {
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            $ips = [$host];
        } else {
            $ips = gethostbynamel($host) ?: [];
            foreach (@dns_get_record($host, DNS_AAAA) ?: [] as $rec) {
                $ips[] = $rec['ipv6'];
            }
        }
        if (! $ips) {
            return null;
        }
        foreach ($ips as $ip) {
            if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return false;
            }
        }

        return $ips[0];
    }

    private function frameable(?string $xfo, ?string $csp): bool
    {
        $xfo = strtolower(trim((string) $xfo));
        if ($xfo !== '' && ! str_contains($xfo, self::PANEL_HOST)) {
            return false;
        }
        if ($csp && preg_match('/frame-ancestors([^;]*)/i', $csp, $m)) {
            $sources = strtolower($m[1]);

            return str_contains($sources, '*') || str_contains($sources, 'https:') || str_contains($sources, self::PANEL_HOST);
        }

        return true;
    }

    private function title(string $html): ?string
    {
        try {
            if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $m)) {
                $title = html_entity_decode(trim(preg_replace('/\s+/', ' ', $m[1])), ENT_QUOTES | ENT_HTML5, 'UTF-8');

                return mb_substr($title, 0, 120) ?: null;
            }
        } catch (Throwable) {
        }

        return null;
    }

    private function absolute(string $base, string $location): string
    {
        if (preg_match('#^https?://#i', $location)) {
            return $location;
        }
        $p = parse_url($base);
        $origin = $p['scheme'].'://'.$p['host'].(isset($p['port']) ? ':'.$p['port'] : '');
        if (str_starts_with($location, '//')) {
            return $p['scheme'].':'.$location;
        }
        if (str_starts_with($location, '/')) {
            return $origin.$location;
        }
        $dir = preg_replace('#/[^/]*$#', '/', $p['path'] ?? '/');

        return $origin.$dir.$location;
    }

    private function result(bool $frameable, string $url, ?string $reason, ?string $title = null): array
    {
        return ['frameable' => $frameable, 'url' => $url, 'reason' => $reason, 'title' => $title];
    }
}
