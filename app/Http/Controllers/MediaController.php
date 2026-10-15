<?php

namespace App\Http\Controllers;

use App\Models\MediaMeta;
use App\Models\PhotoAlbum;
use App\Models\PhotoFavorite;
use App\Models\Playlist;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Imagick;
use Throwable;

/**
 * Foto e Musica: raccolgono immagini e brani dai file dell'utente (senza duplicarli),
 * con anteprime ridotte generate al bisogno e dati (EXIF, tag audio) tenuti in cache.
 */
class MediaController extends Controller
{
    private const PHOTO_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff'];

    private const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav'];

    private const SIZES = ['s' => 360, 'm' => 1600];

    private function disk()
    {
        return Storage::disk('local');
    }

    /** Percorso relativo pulito (niente «..», niente Cestino). */
    private function rel(?string $p): string
    {
        $parts = [];
        foreach (explode('/', str_replace('\\', '/', (string) $p)) as $seg) {
            if ($seg === '' || $seg === '.') {
                continue;
            }
            if ($seg === '..' || str_contains($seg, "\0") || ($parts === [] && $seg === '.trash')) {
                throw ValidationException::withMessages(['path' => 'Percorso non valido.']);
            }
            $parts[] = $seg;
        }

        return implode('/', $parts);
    }

    private function abs(Request $request, string $rel): string
    {
        $p = $request->user()->filesRoot().'/'.$rel;
        abort_unless($rel !== '' && $this->disk()->fileExists($p), 404);

        return $this->disk()->path($p);
    }

    /** Elenco dei file di un tipo, con i dati in cache aggiornati solo per i file cambiati. */
    private function scan(Request $request, string $kind): array
    {
        $uid = $request->user()->id;
        $root = $request->user()->filesRoot();
        $exts = $kind === 'photo' ? self::PHOTO_EXT : self::AUDIO_EXT;
        $cache = MediaMeta::where('user_id', $uid)->where('kind', $kind)->get()->keyBy('path_hash');
        $seen = [];
        $out = [];
        if (! $this->disk()->directoryExists($root)) {
            return [];
        }
        foreach ($this->disk()->allFiles($root) as $file) {
            $rel = Str::after($file, $root.'/');
            if (str_starts_with($rel, '.trash/') || ! in_array(strtolower(pathinfo($rel, PATHINFO_EXTENSION)), $exts, true)) {
                continue;
            }
            $abs = $this->disk()->path($file);
            $mtime = (int) @filemtime($abs);
            $size = (int) @filesize($abs);
            $hash = sha1($rel);
            $seen[] = $hash;
            $row = $cache[$hash] ?? null;
            if (! $row || $row->mtime !== $mtime || $row->size !== $size) {
                $meta = $kind === 'photo' ? $this->photoMeta($abs) : $this->audioMeta($abs);
                $row = MediaMeta::updateOrCreate(['user_id' => $uid, 'path_hash' => $hash],
                    ['path' => $rel, 'kind' => $kind, 'mtime' => $mtime, 'size' => $size, 'meta' => $meta]);
            }
            $out[] = ['path' => $rel, 'name' => basename($rel), 'size' => $size, 'modified' => $mtime] + ($row->meta ?? []);
        }
        // Dati di file che non esistono più
        MediaMeta::where('user_id', $uid)->where('kind', $kind)->whereNotIn('path_hash', $seen ?: ['-'])->delete();

        return $out;
    }

    private function photoMeta(string $abs): array
    {
        $meta = ['taken' => null, 'w' => null, 'h' => null];
        $exif = @exif_read_data($abs, null, true);
        if (is_array($exif)) {
            $date = $exif['EXIF']['DateTimeOriginal'] ?? $exif['IFD0']['DateTime'] ?? null;
            if ($date && ($ts = strtotime(str_replace(':', '-', substr($date, 0, 10)).substr($date, 10)))) {
                $meta['taken'] = $ts;
            }
            $meta['camera'] = trim(($exif['IFD0']['Make'] ?? '').' '.($exif['IFD0']['Model'] ?? '')) ?: null;
        }
        try {
            $im = new Imagick;
            $im->pingImage($abs.'[0]');
            $meta['w'] = $im->getImageWidth();
            $meta['h'] = $im->getImageHeight();
            if (in_array($im->getImageOrientation(), [5, 6, 7, 8], true)) {
                [$meta['w'], $meta['h']] = [$meta['h'], $meta['w']];  // foto scattate in verticale
            }
            if (! $meta['taken'] && ($d = $im->getImageProperty('exif:DateTimeOriginal'))) {
                $meta['taken'] = strtotime(str_replace(':', '-', substr($d, 0, 10)).substr($d, 10)) ?: null;
            }
        } catch (Throwable) {
        }

        return $meta;
    }

    private function audioMeta(string $abs): array
    {
        try {
            $info = (new \getID3)->analyze($abs);
            \getid3_lib::CopyTagsToComments($info);
            $c = $info['comments'] ?? [];
            $first = fn ($k) => isset($c[$k][0]) ? trim((string) $c[$k][0]) : null;

            return [
                'title' => $first('title') ?: pathinfo($abs, PATHINFO_FILENAME),
                'artist' => $first('artist') ?: $first('band'),
                'album' => $first('album'),
                'track' => (int) $first('track_number') ?: (int) $first('tracknumber') ?: null,
                'year' => $first('year') ?: (isset($c['date'][0]) ? substr($c['date'][0], 0, 4) : null),
                'duration' => isset($info['playtime_seconds']) ? round($info['playtime_seconds'], 1) : null,
                'cover' => ! empty($c['picture'][0]['data']),
            ];
        } catch (Throwable) {
            return ['title' => pathinfo($abs, PATHINFO_FILENAME)];
        }
    }

    // ---------------------------------------------------------------- Foto

    public function photos(Request $request)
    {
        $favs = PhotoFavorite::where('user_id', $request->user()->id)->pluck('path')->flip();
        $list = array_map(fn ($p) => $p + ['fav' => isset($favs[$p['path']])], $this->scan($request, 'photo'));
        usort($list, fn ($a, $b) => ($b['taken'] ?? $b['modified']) <=> ($a['taken'] ?? $a['modified']));

        return [
            'photos' => $list,
            'albums' => PhotoAlbum::where('user_id', $request->user()->id)->orderBy('name')->get(['id', 'name', 'items']),
        ];
    }

    /** Anteprima ridotta (s = griglia, m = schermo intero), anche per HEIC che il browser non sa mostrare. */
    public function thumb(Request $request)
    {
        $data = $request->validate(['path' => ['required', 'string'], 'size' => ['in:s,m']]);
        $rel = $this->rel($data['path']);
        $abs = $this->abs($request, $rel);
        $size = $data['size'] ?? 's';
        $key = sha1($rel.'|'.filemtime($abs).'|'.filesize($abs).'|'.$size);
        $thumb = 'thumbs/'.$request->user()->id.'/'.substr($key, 0, 2).'/'.$key.'.jpg';
        if (! $this->disk()->exists($thumb)) {
            try {
                $im = new Imagick($abs.'[0]');
                if (method_exists($im, 'autoOrientImage')) {
                    $im->autoOrientImage();
                }
                $max = self::SIZES[$size];
                if ($im->getImageWidth() > $max || $im->getImageHeight() > $max) {
                    $im->thumbnailImage($max, $max, true);
                }
                $im->setImageBackgroundColor('white');
                $im = $im->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
                $im->setImageFormat('jpeg');
                $im->setImageCompressionQuality($size === 's' ? 78 : 86);
                $im->stripImage();
                $this->disk()->put($thumb, $im->getImageBlob());
            } catch (Throwable) {
                abort(415, 'Formato immagine non supportato.');
            }
        }

        return $this->disk()->response($thumb, null, ['Cache-Control' => 'private, max-age=604800', 'Content-Type' => 'image/jpeg']);
    }

    public function photoInfo(Request $request)
    {
        $rel = $this->rel($request->validate(['path' => ['required', 'string']])['path']);
        $abs = $this->abs($request, $rel);
        $exif = @exif_read_data($abs, null, true) ?: [];
        $e = $exif['EXIF'] ?? [];
        $frac = fn ($v) => is_string($v) && str_contains($v, '/') ? (($p = explode('/', $v)) && (float) $p[1] ? (float) $p[0] / (float) $p[1] : null) : (is_numeric($v) ? (float) $v : null);
        $exp = $frac($e['ExposureTime'] ?? null);

        return array_filter([
            'camera' => trim(($exif['IFD0']['Make'] ?? '').' '.($exif['IFD0']['Model'] ?? '')) ?: null,
            'lens' => $e['UndefinedTag:0xA434'] ?? ($e['LensModel'] ?? null),
            'iso' => $e['ISOSpeedRatings'] ?? null,
            'aperture' => ($f = $frac($e['FNumber'] ?? null)) ? 'f/'.round($f, 1) : null,
            'exposure' => $exp ? ($exp >= 1 ? round($exp, 1).' s' : '1/'.round(1 / $exp).' s') : null,
            'focal' => ($fl = $frac($e['FocalLength'] ?? null)) ? round($fl).' mm' : null,
        ]);
    }

    public function favorite(Request $request)
    {
        $data = $request->validate(['path' => ['required', 'string'], 'on' => ['required', 'boolean']]);
        $rel = $this->rel($data['path']);
        $uid = $request->user()->id;
        if ($data['on']) {
            PhotoFavorite::firstOrCreate(['user_id' => $uid, 'path_hash' => sha1($rel)], ['path' => $rel]);
        } else {
            PhotoFavorite::where('user_id', $uid)->where('path_hash', sha1($rel))->delete();
        }

        return ['ok' => true];
    }

    public function storeAlbum(Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:100'], 'items' => ['array'], 'items.*' => ['string', 'max:1024']]);

        return PhotoAlbum::create(['user_id' => $request->user()->id, 'name' => $data['name'], 'items' => array_values(array_unique(array_map(fn ($p) => $this->rel($p), $data['items'] ?? [])))]);
    }

    public function updateAlbum(Request $request, $id)
    {
        $album = PhotoAlbum::where('user_id', $request->user()->id)->findOrFail($id);
        $data = $request->validate(['name' => ['sometimes', 'required', 'string', 'max:100'], 'add' => ['array'], 'add.*' => ['string'], 'remove' => ['array'], 'remove.*' => ['string']]);
        $items = $album->items ?? [];
        foreach ($data['add'] ?? [] as $p) {
            $p = $this->rel($p);
            in_array($p, $items, true) || $items[] = $p;
        }
        $items = array_values(array_diff($items, array_map(fn ($p) => $this->rel($p), $data['remove'] ?? [])));
        $album->update(['items' => $items] + (isset($data['name']) ? ['name' => $data['name']] : []));

        return $album;
    }

    public function destroyAlbum(Request $request, $id)
    {
        PhotoAlbum::where('user_id', $request->user()->id)->findOrFail($id)->delete();

        return response()->noContent();
    }

    // ---------------------------------------------------------------- Musica

    public function music(Request $request)
    {
        $tracks = $this->scan($request, 'audio');
        usort($tracks, fn ($a, $b) => [mb_strtolower($a['artist'] ?? 'zzz'), mb_strtolower($a['album'] ?? ''), $a['track'] ?? 999, mb_strtolower($a['title'] ?? '')]
            <=> [mb_strtolower($b['artist'] ?? 'zzz'), mb_strtolower($b['album'] ?? ''), $b['track'] ?? 999, mb_strtolower($b['title'] ?? '')]);

        return ['tracks' => $tracks, 'playlists' => Playlist::where('user_id', $request->user()->id)->orderBy('name')->get(['id', 'name', 'items'])];
    }

    /** Copertina incorporata nel file audio (ridotta e in cache). */
    public function cover(Request $request)
    {
        $rel = $this->rel($request->validate(['path' => ['required', 'string']])['path']);
        $abs = $this->abs($request, $rel);
        $key = sha1($rel.'|'.filemtime($abs).'|cover');
        $thumb = 'thumbs/'.$request->user()->id.'/'.substr($key, 0, 2).'/'.$key.'.jpg';
        if (! $this->disk()->exists($thumb)) {
            try {
                $info = (new \getID3)->analyze($abs);
                \getid3_lib::CopyTagsToComments($info);
                $data = $info['comments']['picture'][0]['data'] ?? null;
                abort_unless($data, 404);
                $im = new Imagick;
                $im->readImageBlob($data);
                $im->thumbnailImage(400, 400, true);
                $im->setImageFormat('jpeg');
                $im->setImageCompressionQuality(82);
                $this->disk()->put($thumb, $im->getImageBlob());
            } catch (Throwable) {
                abort(404);
            }
        }

        return $this->disk()->response($thumb, null, ['Cache-Control' => 'private, max-age=604800', 'Content-Type' => 'image/jpeg']);
    }

    public function storePlaylist(Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:100'], 'items' => ['array'], 'items.*' => ['string', 'max:1024']]);

        return Playlist::create(['user_id' => $request->user()->id, 'name' => $data['name'], 'items' => array_map(fn ($p) => $this->rel($p), $data['items'] ?? [])]);
    }

    public function updatePlaylist(Request $request, $id)
    {
        $pl = Playlist::where('user_id', $request->user()->id)->findOrFail($id);
        $data = $request->validate(['name' => ['sometimes', 'required', 'string', 'max:100'], 'items' => ['sometimes', 'array'], 'items.*' => ['string', 'max:1024']]);
        if (isset($data['items'])) {
            $data['items'] = array_map(fn ($p) => $this->rel($p), $data['items']);
        }
        $pl->update($data);

        return $pl;
    }

    public function destroyPlaylist(Request $request, $id)
    {
        Playlist::where('user_id', $request->user()->id)->findOrFail($id)->delete();

        return response()->noContent();
    }
}
