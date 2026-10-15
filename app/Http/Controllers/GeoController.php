<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

/**
 * Meteo e Mappe: le richieste ai servizi gratuiti (Open-Meteo, OpenStreetMap, OSRM, Esri)
 * passano dal server, con una cache, così il browser dell'utente non li contatta direttamente.
 */
class GeoController extends Controller
{
    private const UA = 'MarX/1.0 (+https://marx.marcostarace.it)';

    private const TILES = [
        'street' => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        'satellite' => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ];

    private const ROUTERS = [
        'car' => 'https://router.project-osrm.org/route/v1/driving/',
        'foot' => 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/',
        'bike' => 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/',
    ];

    private function http()
    {
        return Http::withHeaders(['User-Agent' => self::UA, 'Accept-Language' => 'it'])->timeout(12);
    }

    private function coords(Request $request): array
    {
        $d = $request->validate(['lat' => ['required', 'numeric', 'between:-90,90'], 'lon' => ['required', 'numeric', 'between:-180,180']]);

        return [round((float) $d['lat'], 3), round((float) $d['lon'], 3)];
    }

    /** Previsioni: tempo attuale, 24 ore e 10 giorni. Cache di 15 minuti per posizione. */
    public function weather(Request $request)
    {
        [$lat, $lon] = $this->coords($request);

        return Cache::remember("wx:$lat:$lon", 900, function () use ($lat, $lon) {
            $res = $this->http()->get('https://api.open-meteo.com/v1/forecast', [
                'latitude' => $lat, 'longitude' => $lon, 'timezone' => 'auto', 'forecast_days' => 10,
                'current' => 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,surface_pressure,precipitation,visibility',
                'hourly' => 'temperature_2m,weather_code,precipitation_probability,is_day',
                'daily' => 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max',
            ]);
            abort_unless($res->ok(), 502, 'Servizio meteo non raggiungibile');

            return $res->json();
        });
    }

    /** Ricerca di città per il Meteo e l'Orologio (nome, paese, fuso orario). */
    public function cities(Request $request)
    {
        $q = trim((string) $request->validate(['q' => ['required', 'string', 'max:100']])['q']);

        return Cache::remember('wxc:'.mb_strtolower($q), 86400, function () use ($q) {
            $res = $this->http()->get('https://geocoding-api.open-meteo.com/v1/search', ['name' => $q, 'count' => 8, 'language' => 'it']);
            abort_unless($res->ok(), 502, 'Ricerca non disponibile');

            return collect($res->json('results') ?? [])->map(fn ($r) => [
                'name' => $r['name'], 'region' => $r['admin1'] ?? null, 'country' => $r['country'] ?? null,
                'lat' => $r['latitude'], 'lon' => $r['longitude'], 'tz' => $r['timezone'] ?? null,
            ])->values()->all();
        });
    }

    /** Ricerca di indirizzi e luoghi (Nominatim, massimo una richiesta al secondo come da regole OSM). */
    public function search(Request $request)
    {
        $d = $request->validate(['q' => ['required', 'string', 'max:200'], 'lat' => ['nullable', 'numeric'], 'lon' => ['nullable', 'numeric']]);
        $q = trim($d['q']);
        $params = ['q' => $q, 'format' => 'jsonv2', 'limit' => 8, 'addressdetails' => 1];
        if (isset($d['lat'], $d['lon'])) {  // preferisce i risultati vicino a dove si sta guardando
            $params['viewbox'] = ($d['lon'] - 2).','.($d['lat'] + 2).','.($d['lon'] + 2).','.($d['lat'] - 2);
        }

        return Cache::remember('geo:'.md5(json_encode($params)), 86400, function () use ($params) {
            $this->nominatimSlot();
            $res = $this->http()->get('https://nominatim.openstreetmap.org/search', $params);
            abort_unless($res->ok(), 502, 'Ricerca non disponibile');

            return collect($res->json())->map(fn ($r) => [
                'name' => $r['name'] ?: strtok($r['display_name'], ','), 'address' => $r['display_name'],
                'lat' => (float) $r['lat'], 'lon' => (float) $r['lon'], 'type' => $r['type'] ?? null, 'category' => $r['category'] ?? null,
            ])->values()->all();
        });
    }

    /** Indirizzo di un punto della mappa. */
    public function reverse(Request $request)
    {
        [$lat, $lon] = $this->coords($request);
        $zoom = $request->boolean('city') ? 10 : 18;  // 10 = nome della città, 18 = indirizzo

        return Cache::remember("rev:$zoom:$lat:$lon", 86400, function () use ($lat, $lon, $zoom) {
            $this->nominatimSlot();
            $res = $this->http()->get('https://nominatim.openstreetmap.org/reverse', ['lat' => $lat, 'lon' => $lon, 'format' => 'jsonv2', 'zoom' => $zoom]);
            abort_unless($res->ok(), 502, 'Ricerca non disponibile');
            $r = $res->json();

            return ['name' => $r['name'] ?? null ?: strtok($r['display_name'] ?? 'Punto sulla mappa', ','), 'address' => $r['display_name'] ?? null, 'lat' => $lat, 'lon' => $lon];
        });
    }

    private function nominatimSlot(): void
    {
        // Nominatim chiede al massimo una richiesta al secondo da tutto il server
        for ($i = 0; $i < 20 && ! Cache::add('nominatim-slot', 1, 1); $i++) {
            usleep(100_000);
        }
    }

    /** Percorso in auto, a piedi o in bici, con le indicazioni passo passo. */
    public function route(Request $request)
    {
        $d = $request->validate([
            'mode' => ['required', 'in:car,foot,bike'],
            'from' => ['required', 'array', 'size:2'], 'from.*' => ['numeric'],
            'to' => ['required', 'array', 'size:2'], 'to.*' => ['numeric'],
        ]);
        $pts = sprintf('%F,%F;%F,%F', $d['from'][1], $d['from'][0], $d['to'][1], $d['to'][0]);

        return Cache::remember('route:'.$d['mode'].':'.$pts, 3600, function () use ($d, $pts) {
            $res = $this->http()->get(self::ROUTERS[$d['mode']].$pts, ['overview' => 'full', 'geometries' => 'geojson', 'steps' => 'true']);
            abort_unless($res->ok() && $res->json('code') === 'Ok', 502, 'Nessun percorso trovato');
            $r = $res->json('routes.0');

            return [
                'distance' => $r['distance'], 'duration' => $r['duration'],
                'line' => array_map(fn ($c) => [$c[1], $c[0]], $r['geometry']['coordinates']),
                'steps' => collect($r['legs'][0]['steps'])->map(fn ($s) => [
                    'type' => $s['maneuver']['type'], 'modifier' => $s['maneuver']['modifier'] ?? null, 'exit' => $s['maneuver']['exit'] ?? null,
                    'name' => $s['name'] ?? '', 'distance' => $s['distance'], 'at' => [$s['maneuver']['location'][1], $s['maneuver']['location'][0]],
                ])->values()->all(),
            ];
        });
    }

    /** Tasselli della mappa, salvati su disco per 30 giorni. */
    public function tile(string $layer, int $z, int $x, int $y)
    {
        abort_unless(isset(self::TILES[$layer]) && $z >= 0 && $z <= 19 && $x >= 0 && $y >= 0 && $x < 2 ** $z && $y < 2 ** $z, 404);
        $disk = Storage::disk('local');
        $path = "tiles/$layer/$z/$x/$y";
        if (! $disk->exists($path) || $disk->lastModified($path) < time() - 30 * 86400) {
            $res = $this->http()->get(strtr(self::TILES[$layer], ['{z}' => $z, '{x}' => $x, '{y}' => $y]));
            abort_unless($res->ok(), 404);
            $disk->put($path, $res->body());
        }

        return response($disk->get($path), 200, [
            'Content-Type' => $layer === 'street' ? 'image/png' : 'image/jpeg',
            'Cache-Control' => 'private, max-age=604800',
        ]);
    }
}
