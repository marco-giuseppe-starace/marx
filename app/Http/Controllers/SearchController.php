<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Ricerca di Spotlight nelle note e nei file dell'utente. */
class SearchController extends Controller
{
    public function search(Request $request)
    {
        $q = trim($request->validate(['q' => ['required', 'string', 'max:100']])['q']);
        $user = $request->user();
        $needle = mb_strtolower($q);

        $notes = $user->notes()
            ->where('body', 'like', '%'.addcslashes($q, '%_\\').'%')
            ->latest('updated_at')->limit(8)->get(['id', 'body', 'updated_at'])
            ->map(function ($n) use ($needle) {
                $body = (string) $n->body;
                $title = trim(Str::before($body, "\n")) ?: 'Nuova nota';
                $pos = mb_stripos($body, $needle);
                $snippet = $pos === false ? '' : trim(preg_replace('/\s+/', ' ', mb_substr($body, max(0, $pos - 30), 90)));

                return ['id' => $n->id, 'title' => mb_substr($title, 0, 80), 'snippet' => $snippet];
            });

        $root = $user->filesRoot();
        $disk = Storage::disk('local');
        $files = collect();
        if ($disk->directoryExists($root)) {
            $all = collect($disk->allDirectories($root))->map(fn ($p) => [$p, 'folder'])
                ->concat(collect($disk->allFiles($root))->map(fn ($p) => [$p, 'file']));
            $files = $all->filter(fn ($e) => str_contains(mb_strtolower(basename($e[0])), $needle) && ! str_contains($e[0], '/.trash'))
                ->take(15)
                ->map(fn ($e) => ['path' => Str::after($e[0], $root.'/'), 'name' => basename($e[0]), 'type' => $e[1]])
                ->values();
        }

        return ['notes' => $notes, 'files' => $files];
    }
}
