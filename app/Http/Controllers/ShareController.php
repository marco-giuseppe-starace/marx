<?php

namespace App\Http\Controllers;

use App\Models\Share;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use ZipArchive;

/**
 * Condivisione dei file: link pubblici (con scadenza e password facoltative) e condivisione
 * in sola lettura con altri utenti di MarX.
 */
class ShareController extends Controller
{
    private function disk()
    {
        return Storage::disk('local');
    }

    /** Percorso sul disco dell'elemento condiviso, oppure null se non esiste più. */
    private function abs(Share $share): ?string
    {
        $p = $share->owner->filesRoot().'/'.$share->path;

        return $this->disk()->exists($p) ? $p : null;
    }

    private function rel(Request $request, string $path): string
    {
        $path = trim(str_replace('\\', '/', $path), '/');
        if ($path === '' || str_contains('/'.$path.'/', '/../') || str_starts_with($path, '.trash')) {
            throw ValidationException::withMessages(['path' => 'Percorso non valido.']);
        }
        abort_unless($this->disk()->exists($request->user()->filesRoot().'/'.$path), 404);

        return $path;
    }

    private function type(Request $request, string $rel): string
    {
        return $this->disk()->directoryExists($request->user()->filesRoot().'/'.$rel) ? 'folder' : 'file';
    }

    private function present(Share $s): array
    {
        return [
            'id' => $s->id, 'path' => $s->path, 'name' => basename($s->path), 'type' => $s->type,
            'url' => $s->token ? url('/s/'.$s->token) : null, 'protected' => (bool) $s->password,
            'expires' => $s->expires_at?->timestamp, 'expired' => $s->expired(), 'downloads' => $s->downloads,
            'with' => $s->target?->only('name', 'email'), 'created' => $s->created_at->timestamp,
        ];
    }

    public function createLink(Request $request)
    {
        $data = $request->validate([
            'path' => ['required', 'string'], 'days' => ['required', 'in:0,1,7,30'], 'password' => ['nullable', 'string', 'min:4', 'max:100'],
        ], ['password.min' => 'La password deve avere almeno 4 caratteri.']);
        $rel = $this->rel($request, $data['path']);
        $share = Share::create([
            'user_id' => $request->user()->id, 'path' => $rel, 'type' => $this->type($request, $rel), 'token' => Str::random(40),
            'password' => $data['password'] ? Hash::make($data['password']) : null,
            'expires_at' => (int) $data['days'] ? now()->addDays((int) $data['days']) : null,
        ]);

        return $this->present($share);
    }

    public function shareWithUser(Request $request)
    {
        $data = $request->validate(['path' => ['required', 'string'], 'email' => ['required', 'email']]);
        $rel = $this->rel($request, $data['path']);
        $target = User::where('email', $data['email'])->first();
        if (! $target) {
            throw ValidationException::withMessages(['email' => 'Non c\'è nessun utente MarX con questa email.']);
        }
        if ($target->is($request->user())) {
            throw ValidationException::withMessages(['email' => 'Non puoi condividere con te stesso.']);
        }
        $share = Share::firstOrCreate(
            ['user_id' => $request->user()->id, 'path' => $rel, 'target_user_id' => $target->id],
            ['type' => $this->type($request, $rel)]
        );

        return $this->present($share->load('target'));
    }

    public function mine(Request $request)
    {
        return Share::with('target')->where('user_id', $request->user()->id)->latest()->get()->map(fn ($s) => $this->present($s));
    }

    public function revoke(Request $request, Share $share)
    {
        abort_unless($share->user_id === $request->user()->id, 404);
        $share->delete();

        return response()->noContent();
    }

    public function withMe(Request $request)
    {
        return Share::with('owner')->where('target_user_id', $request->user()->id)->latest()->get()
            ->filter(fn ($s) => $this->abs($s))
            ->map(fn ($s) => ['id' => $s->id, 'name' => basename($s->path), 'type' => $s->type, 'from' => $s->owner->name,
                'size' => $s->type === 'file' ? $this->disk()->size($this->abs($s)) : null, 'created' => $s->created_at->timestamp])->values();
    }

    public function downloadShared(Request $request, Share $share)
    {
        abort_unless($share->target_user_id === $request->user()->id && ($abs = $this->abs($share)), 404);

        return $this->send($share, $abs, $request->boolean('inline'));
    }

    // ---------------------------------------------------------------- pagina pubblica /s/{token}

    public function publicShow(Request $request, string $token)
    {
        $share = Share::with('owner')->where('token', $token)->first();
        $state = ! $share || ! $this->abs($share) ? 'missing' : ($share->expired() ? 'expired' : 'ok');
        $unlocked = $share && (! $share->password || $request->session()->get("share.$share->id"));

        return response()->view('share', [
            'share' => $share, 'state' => $state, 'unlocked' => $unlocked,
            'size' => $state === 'ok' && $share->type === 'file' ? $this->disk()->size($this->abs($share)) : null,
        ], $state === 'ok' ? 200 : 404)->header('X-Robots-Tag', 'noindex');
    }

    public function publicUnlock(Request $request, string $token)
    {
        $share = Share::where('token', $token)->firstOrFail();
        if ($share->password && ! Hash::check((string) $request->input('password'), $share->password)) {
            return back()->withErrors(['password' => 'Password errata.']);
        }
        $request->session()->put("share.$share->id", true);

        return redirect('/s/'.$token);
    }

    public function publicDownload(Request $request, string $token)
    {
        $share = Share::with('owner')->where('token', $token)->firstOrFail();
        abort_if($share->expired() || ! ($abs = $this->abs($share)), 404);
        abort_if($share->password && ! $request->session()->get("share.$share->id"), 403);
        $share->increment('downloads');

        return $this->send($share, $abs, false);
    }

    /** Invia il file; una cartella viene compressa al volo in uno ZIP. */
    private function send(Share $share, string $abs, bool $inline)
    {
        if ($share->type === 'file') {
            return $inline ? $this->disk()->response($abs) : $this->disk()->download($abs);
        }
        $dir = $this->disk()->path($abs);
        $tmp = tempnam(sys_get_temp_dir(), 'marxshare');
        $zip = new ZipArchive;
        $zip->open($tmp, ZipArchive::OVERWRITE);
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::SELF_FIRST) as $item) {
            if ($item->isLink()) {
                continue;
            }
            $inZip = basename($dir).'/'.substr($item->getPathname(), strlen($dir) + 1);
            $item->isDir() ? $zip->addEmptyDir($inZip) : $zip->addFile($item->getPathname(), $inZip);
        }
        $zip->close();

        return response()->download($tmp, basename($dir).'.zip')->deleteFileAfterSend();
    }
}
