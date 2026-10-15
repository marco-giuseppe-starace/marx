<?php

namespace App\Http\Controllers;

use App\Models\FileTag;
use App\Models\Share;
use App\Models\TrashItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use ZipArchive;

/**
 * File personali dell'utente, salvati in storage/app/private/users/{id}.
 * Ogni percorso ricevuto dal client è relativo alla cartella dell'utente.
 * La cartella nascosta «.trash» contiene il Cestino ed è gestita solo da qui.
 */
class FileController extends Controller
{
    private const TRASH = '.trash';

    private const TRASH_DAYS = 30;

    private const UNZIP_MAX_BYTES = 2 * 1024 ** 3;   // protezione dagli archivi «bomba»

    private const UNZIP_MAX_ENTRIES = 5000;

    private function disk()
    {
        return Storage::disk('local');
    }

    /** Normalizza un percorso relativo; rifiuta «..» e il Cestino. Restituisce il percorso relativo pulito. */
    private function rel(?string $relative): string
    {
        $parts = [];
        foreach (explode('/', str_replace('\\', '/', (string) $relative)) as $seg) {
            if ($seg === '' || $seg === '.') {
                continue;
            }
            if ($seg === '..' || str_contains($seg, "\0") || ($parts === [] && $seg === self::TRASH)) {
                throw ValidationException::withMessages(['path' => 'Percorso non valido.']);
            }
            $parts[] = $seg;
        }

        return implode('/', $parts);
    }

    /** Percorso sul disco (relativo al disco «local») a partire da un percorso dell'utente. */
    private function path(Request $request, ?string $relative): string
    {
        return rtrim($request->user()->filesRoot().'/'.$this->rel($relative), '/');
    }

    private function name(string $name): string
    {
        $name = trim(str_replace(['/', '\\', "\0"], '', $name));
        if ($name === '' || $name === '.' || $name === '..' || $name === self::TRASH || mb_strlen($name) > 200) {
            throw ValidationException::withMessages(['name' => 'Nome non valido.']);
        }

        return $name;
    }

    /** Nome libero nella cartella: «file.txt» → «file (2).txt». */
    private function unique(string $dir, string $name): string
    {
        if (! $this->disk()->exists("$dir/$name")) {
            return $name;
        }
        // Le cartelle non hanno estensione: «v1.2» resta «v1.2 (2)»
        $isDir = $this->disk()->directoryExists("$dir/$name");
        $ext = $isDir ? '' : pathinfo($name, PATHINFO_EXTENSION);
        $base = $ext === '' ? $name : substr($name, 0, -strlen($ext) - 1);
        $i = 2;
        do {
            $candidate = $base." ($i)".($ext !== '' ? ".$ext" : '');
            $i++;
        } while ($this->disk()->exists("$dir/$candidate"));

        return $candidate;
    }

    /** Aggiorna tag e condivisioni quando un elemento cambia percorso (o viene tolto, se $to è null). */
    private function repath(Request $request, string $from, ?string $to): void
    {
        $uid = $request->user()->id;
        foreach ([FileTag::class, Share::class] as $model) {
            $model::where('user_id', $uid)->where(fn ($q) => $q->where('path', $from)->orWhere('path', 'like', addcslashes($from, '%_\\').'/%'))
                ->get()->each(function ($row) use ($from, $to) {
                    if ($to === null) {
                        $row->delete();
                    } else {
                        $row->path = $to.substr($row->path, strlen($from));
                        $row->save();
                    }
                });
        }
    }

    private function tagsFor(Request $request, string $dirRel): array
    {
        $prefix = $dirRel === '' ? '' : $dirRel.'/';
        $out = [];
        foreach (FileTag::where('user_id', $request->user()->id)->where('path', 'like', addcslashes($prefix, '%_\\').'%')->get(['path', 'color']) as $t) {
            $rest = substr($t->path, strlen($prefix));
            if ($rest !== '' && ! str_contains($rest, '/')) {
                $out[$rest][] = $t->color;
            }
        }

        return $out;
    }

    private function purgeTrash(Request $request): void
    {
        TrashItem::where('user_id', $request->user()->id)->where('created_at', '<', now()->subDays(self::TRASH_DAYS))->get()
            ->each(function ($item) use ($request) {
                $this->disk()->deleteDirectory($request->user()->filesRoot().'/'.self::TRASH.'/'.$item->stored);
                $item->delete();
            });
    }

    // ---------------------------------------------------------------- elenco e operazioni di base

    public function index(Request $request)
    {
        $rel = $this->rel($request->query('path'));
        $dir = $this->path($request, $rel);
        $disk = $this->disk();
        $root = $request->user()->filesRoot();
        $disk->makeDirectory($root.'/Scrivania');  // la cartella della scrivania esiste sempre
        abort_unless($disk->directoryExists($dir), 404);

        $tags = $this->tagsFor($request, $rel);
        $folders = collect($disk->directories($dir))->reject(fn ($p) => $p === $root.'/'.self::TRASH)->map(fn ($p) => [
            'name' => basename($p), 'type' => 'folder', 'size' => null, 'modified' => @filemtime($disk->path($p)) ?: null, 'tags' => $tags[basename($p)] ?? [],
        ]);
        $files = collect($disk->files($dir))->map(fn ($p) => [
            'name' => basename($p), 'type' => 'file', 'size' => $disk->size($p), 'modified' => $disk->lastModified($p), 'tags' => $tags[basename($p)] ?? [],
        ]);

        return [
            'items' => $folders->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)->values()
                ->concat($files->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)->values()),
            'trash' => TrashItem::where('user_id', $request->user()->id)->count(),
        ];
    }

    public function upload(Request $request)
    {
        $request->validate([
            'files' => ['required', 'array', 'max:20'],
            'files.*' => ['file', 'max:51200'], // 50 MB
        ], ['files.*.max' => 'Ogni file può essere al massimo di 50 MB.']);

        $dir = $this->path($request, $request->input('path'));
        $saved = [];
        foreach ($request->file('files') as $file) {
            $name = $this->unique($dir, $this->name($file->getClientOriginalName()));
            $this->disk()->putFileAs($dir, $file, $name);
            $saved[] = $name;
        }

        return ['saved' => $saved];
    }

    public function mkdir(Request $request)
    {
        $request->validate(['name' => ['required', 'string']]);
        $target = $this->path($request, $request->input('path')).'/'.$this->name($request->name);
        if ($this->disk()->exists($target)) {
            throw ValidationException::withMessages(['name' => 'Esiste già un elemento con questo nome.']);
        }
        $this->disk()->makeDirectory($target);

        return ['ok' => true];
    }

    public function rename(Request $request)
    {
        $request->validate(['path' => ['required', 'string'], 'name' => ['required', 'string']]);
        $fromRel = $this->rel($request->path);
        abort_if($fromRel === '', 422);
        $from = $this->path($request, $fromRel);
        $toRel = ltrim(dirname('/'.$fromRel).'/'.$this->name($request->name), '/');
        $to = $this->path($request, $toRel);
        if ($this->disk()->exists($to)) {
            throw ValidationException::withMessages(['name' => 'Esiste già un elemento con questo nome.']);
        }
        $this->disk()->move($from, $to);
        $this->repath($request, $fromRel, $toRel);

        return ['ok' => true];
    }

    /** Sposta uno o più elementi in un'altra cartella (trascinamento). */
    public function move(Request $request)
    {
        $request->validate(['paths' => ['required', 'array', 'max:500'], 'paths.*' => ['string'], 'to' => ['nullable', 'string']]);
        $toRel = $this->rel($request->input('to'));
        $toDir = $this->path($request, $toRel);
        abort_unless($this->disk()->directoryExists($toDir), 404);
        $moved = [];
        foreach ($request->paths as $p) {
            $fromRel = $this->rel($p);
            if ($fromRel === '' || dirname('/'.$fromRel) === '/'.$toRel || $fromRel === $toRel) {
                continue;  // già lì
            }
            if (str_starts_with($toRel.'/', $fromRel.'/')) {
                throw ValidationException::withMessages(['to' => 'Non puoi spostare una cartella dentro sé stessa.']);
            }
            $from = $this->path($request, $fromRel);
            if (! $this->disk()->exists($from)) {
                continue;
            }
            $name = $this->unique($toDir, basename($fromRel));
            $this->disk()->move($from, "$toDir/$name");
            $this->repath($request, $fromRel, ltrim("$toRel/$name", '/'));
            $moved[] = $name;
        }

        return ['moved' => $moved];
    }

    public function duplicate(Request $request)
    {
        $request->validate(['path' => ['required', 'string']]);
        $rel = $this->rel($request->path);
        $src = $this->path($request, $rel);
        abort_unless($rel !== '' && $this->disk()->exists($src), 404);
        $dir = dirname($src);
        $info = pathinfo(basename($rel));
        $isDir = $this->disk()->directoryExists($src);
        $copy = $this->unique($dir, $isDir || empty($info['extension']) ? $info['filename'].' copia' : $info['filename'].' copia.'.$info['extension']);
        if ($isDir) {
            $this->copyDir($this->disk()->path($src), $this->disk()->path("$dir/$copy"));
        } else {
            $this->disk()->copy($src, "$dir/$copy");
        }

        return ['name' => $copy];
    }

    private function copyDir(string $from, string $to): void
    {
        @mkdir($to, 0775, true);
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($from, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::SELF_FIRST) as $item) {
            if ($item->isLink()) {
                continue;
            }
            $dest = $to.'/'.substr($item->getPathname(), strlen($from) + 1);
            $item->isDir() ? @mkdir($dest, 0775, true) : copy($item->getPathname(), $dest);
        }
    }

    public function download(Request $request)
    {
        $file = $this->path($request, $request->query('path'));
        abort_unless($this->disk()->fileExists($file), 404);

        return $request->boolean('inline')
            ? $this->disk()->response($file, null, ['Content-Security-Policy' => "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"])
            : $this->disk()->download($file);
    }

    /** Testo di un file: l'inizio per Quick Look, oppure tutto (fino a 5 MB) per TextEdit con «full=1». */
    public function text(Request $request)
    {
        $file = $this->path($request, $request->query('path'));
        abort_unless($this->disk()->fileExists($file), 404);
        $limit = $request->boolean('full') ? 5_000_000 : 200_000;
        abort_if($request->boolean('full') && $this->disk()->size($file) > $limit, 422, 'Il file è troppo grande per TextEdit (massimo 5 MB).');
        $fh = fopen($this->disk()->path($file), 'rb');
        $data = (string) fread($fh, $limit);
        fclose($fh);
        if (! mb_check_encoding($data, 'UTF-8')) {
            $data = mb_convert_encoding($data, 'UTF-8', 'Windows-1252');
        }

        return response($data, 200, ['Content-Type' => 'text/plain; charset=UTF-8', 'X-Truncated' => $this->disk()->size($file) > $limit ? '1' : '0']);
    }

    /** Salva un file di testo (TextEdit): lo crea oppure lo sovrascrive. */
    public function save(Request $request)
    {
        $request->validate(['path' => ['required', 'string'], 'content' => ['present', 'nullable', 'string', 'max:5000000']]);
        $rel = $this->rel($request->path);
        abort_if($rel === '', 422);
        $this->name(basename($rel));
        $this->disk()->makeDirectory($request->user()->filesRoot().'/Scrivania');  // la scrivania esiste sempre
        $dir = $this->path($request, ltrim(dirname('/'.$rel), '/'));
        abort_unless($this->disk()->directoryExists($dir), 404, 'La cartella non esiste più.');
        abort_if($this->disk()->directoryExists($this->path($request, $rel)), 422, 'Esiste già una cartella con questo nome.');
        $this->disk()->put($this->path($request, $rel), (string) $request->input('content'));

        return ['path' => $rel, 'size' => $this->disk()->size($this->path($request, $rel)), 'modified' => $this->disk()->lastModified($this->path($request, $rel))];
    }

    // ---------------------------------------------------------------- Cestino

    /** «Elimina»: sposta nel Cestino. */
    public function destroy(Request $request)
    {
        $request->validate(['path' => ['required_without:paths', 'string'], 'paths' => ['array', 'max:500'], 'paths.*' => ['string']]);
        $paths = $request->input('paths', [$request->input('path')]);
        $root = $request->user()->filesRoot();
        foreach ($paths as $p) {
            $rel = $this->rel($p);
            $src = $this->path($request, $rel);
            if ($rel === '' || ! $this->disk()->exists($src)) {
                continue;
            }
            $isDir = $this->disk()->directoryExists($src);
            $stored = (string) Str::uuid();
            $this->disk()->makeDirectory("$root/".self::TRASH."/$stored");
            $this->disk()->move($src, "$root/".self::TRASH."/$stored/".basename($rel));
            TrashItem::create([
                'user_id' => $request->user()->id, 'original_path' => $rel, 'stored' => $stored, 'name' => basename($rel),
                'type' => $isDir ? 'folder' : 'file', 'size' => $isDir ? null : $this->disk()->size("$root/".self::TRASH."/$stored/".basename($rel)),
            ]);
            $this->repath($request, $rel, null);
        }
        $this->purgeTrash($request);

        return ['trash' => TrashItem::where('user_id', $request->user()->id)->count()];
    }

    public function trash(Request $request)
    {
        $this->purgeTrash($request);

        return TrashItem::where('user_id', $request->user()->id)->latest()->get()->map(fn ($t) => [
            'id' => $t->id, 'name' => $t->name, 'type' => $t->type, 'size' => $t->size, 'from' => $t->original_path,
            'deleted' => $t->created_at->timestamp, 'expires' => $t->created_at->addDays(self::TRASH_DAYS)->timestamp,
        ]);
    }

    public function restore(Request $request)
    {
        $request->validate(['ids' => ['required', 'array'], 'ids.*' => ['integer']]);
        $root = $request->user()->filesRoot();
        $restored = [];
        foreach (TrashItem::where('user_id', $request->user()->id)->whereIn('id', $request->ids)->get() as $item) {
            $dirRel = ltrim(dirname('/'.$item->original_path), '/');
            $dir = $this->path($request, $dirRel);
            $this->disk()->makeDirectory($dir);  // se la cartella d'origine non c'è più, la ricrea
            $name = $this->unique($dir, $item->name);
            $this->disk()->move("$root/".self::TRASH."/{$item->stored}/{$item->name}", "$dir/$name");
            $this->disk()->deleteDirectory("$root/".self::TRASH."/{$item->stored}");
            $item->delete();
            $restored[] = ltrim("$dirRel/$name", '/');
        }

        return ['restored' => $restored];
    }

    /** Elimina definitivamente: alcuni elementi (ids) o tutto il Cestino. */
    public function emptyTrash(Request $request)
    {
        $request->validate(['ids' => ['array'], 'ids.*' => ['integer']]);
        $root = $request->user()->filesRoot();
        $q = TrashItem::where('user_id', $request->user()->id);
        if ($request->filled('ids')) {
            $q->whereIn('id', $request->ids);
        }
        foreach ($q->get() as $item) {
            $this->disk()->deleteDirectory("$root/".self::TRASH."/{$item->stored}");
            $item->delete();
        }

        return ['trash' => TrashItem::where('user_id', $request->user()->id)->count()];
    }

    // ---------------------------------------------------------------- Tag

    public function setTag(Request $request)
    {
        $data = $request->validate(['path' => ['required', 'string'], 'color' => ['required', 'in:'.implode(',', FileTag::COLORS)], 'on' => ['required', 'boolean']]);
        $rel = $this->rel($data['path']);
        abort_unless($rel !== '' && $this->disk()->exists($this->path($request, $rel)), 404);
        $q = FileTag::where('user_id', $request->user()->id)->where('path_hash', sha1($rel))->where('color', $data['color']);
        if ($data['on']) {
            $q->exists() || FileTag::create(['user_id' => $request->user()->id, 'path' => $rel, 'color' => $data['color']]);
        } else {
            $q->delete();
        }

        return ['ok' => true];
    }

    public function tagged(Request $request)
    {
        $color = $request->validate(['color' => ['required', 'in:'.implode(',', FileTag::COLORS)]])['color'];

        return FileTag::where('user_id', $request->user()->id)->where('color', $color)->orderBy('path')->get()
            ->filter(fn ($t) => $this->disk()->exists($this->path($request, $t->path)))
            ->map(fn ($t) => [
                'path' => $t->path, 'name' => basename($t->path),
                'type' => $this->disk()->directoryExists($this->path($request, $t->path)) ? 'folder' : 'file',
            ])->values();
    }

    // ---------------------------------------------------------------- ZIP

    public function zip(Request $request)
    {
        $request->validate(['paths' => ['required', 'array', 'max:500'], 'paths.*' => ['string'], 'dir' => ['nullable', 'string']]);
        $dirRel = $this->rel($request->input('dir'));
        $dir = $this->path($request, $dirRel);
        $rels = array_map(fn ($p) => $this->rel($p), $request->paths);
        $name = count($rels) === 1 ? pathinfo(basename($rels[0]), PATHINFO_FILENAME).'.zip' : 'Archivio.zip';
        $name = $this->unique($dir, $name);

        $tmp = tempnam(sys_get_temp_dir(), 'marxzip');
        $zip = new ZipArchive;
        $zip->open($tmp, ZipArchive::OVERWRITE);
        foreach ($rels as $rel) {
            $abs = $this->disk()->path($this->path($request, $rel));
            if (is_dir($abs)) {
                $zip->addEmptyDir(basename($rel));
                foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($abs, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::SELF_FIRST) as $item) {
                    if ($item->isLink()) {
                        continue;
                    }
                    $inZip = basename($rel).'/'.substr($item->getPathname(), strlen($abs) + 1);
                    $item->isDir() ? $zip->addEmptyDir($inZip) : $zip->addFile($item->getPathname(), $inZip);
                }
            } elseif (is_file($abs)) {
                $zip->addFile($abs, basename($rel));
            }
        }
        $zip->close();
        $this->disk()->putFileAs($dir, new \Illuminate\Http\File($tmp), $name);
        @unlink($tmp);

        return ['name' => $name];
    }

    public function unzip(Request $request)
    {
        $request->validate(['path' => ['required', 'string']]);
        $rel = $this->rel($request->path);
        $src = $this->disk()->path($this->path($request, $rel));
        $zip = new ZipArchive;
        if (! is_file($src) || $zip->open($src, ZipArchive::RDONLY) !== true) {
            throw ValidationException::withMessages(['path' => 'Questo file non è un archivio ZIP valido.']);
        }
        if ($zip->numFiles > self::UNZIP_MAX_ENTRIES) {
            throw ValidationException::withMessages(['path' => 'L\'archivio contiene troppi file.']);
        }

        // Controllo preventivo: niente percorsi che escono dalla cartella, niente collegamenti, dimensione ragionevole
        $total = 0;
        $entries = [];
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $st = $zip->statIndex($i);
            $name = str_replace('\\', '/', $st['name']);
            $zip->getExternalAttributesIndex($i, $os, $attr);
            $isLink = $os === ZipArchive::OPSYS_UNIX && (($attr >> 16) & 0170000) === 0120000;
            $parts = array_filter(explode('/', $name), fn ($s) => $s !== '' && $s !== '.');
            if ($isLink || str_starts_with($name, '/') || preg_match('/^[a-zA-Z]:/', $name) || in_array('..', $parts, true) || str_contains($name, "\0")) {
                throw ValidationException::withMessages(['path' => 'L\'archivio contiene percorsi non sicuri: non è stato estratto.']);
            }
            if (str_starts_with($name, '__MACOSX/')) {
                continue;
            }
            $total += $st['size'];
            $entries[] = [$i, implode('/', $parts), str_ends_with($name, '/')];
        }
        if ($total > self::UNZIP_MAX_BYTES) {
            throw ValidationException::withMessages(['path' => 'L\'archivio estratto supererebbe i 2 GB.']);
        }

        $dirRel = ltrim(dirname('/'.$rel), '/');
        $folder = $this->unique($this->path($request, $dirRel), pathinfo(basename($rel), PATHINFO_FILENAME) ?: 'Archivio');
        $base = $this->disk()->path($this->path($request, ltrim("$dirRel/$folder", '/')));
        @mkdir($base, 0775, true);
        foreach ($entries as [$i, $name, $isDir]) {
            if ($name === '') {
                continue;
            }
            $dest = $base.'/'.$name;
            if ($isDir) {
                @mkdir($dest, 0775, true);

                continue;
            }
            @mkdir(dirname($dest), 0775, true);
            $in = $zip->getStream($zip->getNameIndex($i));
            $out = fopen($dest, 'wb');
            stream_copy_to_stream($in, $out);
            fclose($in);
            fclose($out);
        }
        $zip->close();

        return ['folder' => $folder];
    }
}
