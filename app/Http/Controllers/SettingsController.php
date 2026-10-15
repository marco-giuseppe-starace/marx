<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Preferenze dell'utente (aspetto, sfondo, Dock, blocco schermo…), salvate nell'account
 * così da ritrovarle su ogni dispositivo. Lo sfondo personalizzato è un file privato.
 */
class SettingsController extends Controller
{
    /** Chiavi ammesse e relative regole: tutto il resto viene ignorato. */
    private const RULES = [
        'theme' => ['in:auto,light,dark'],
        'accent' => ['in:blue,purple,pink,red,orange,yellow,green,graphite'],
        'textSize' => ['in:small,medium,large'],
        'reduceTransparency' => ['boolean'],
        'reduceMotion' => ['boolean'],
        'wallpaper' => ['in:1,2,3,4,5,6,custom,color'],
        'wallpaperColor' => ['regex:/^#[0-9a-fA-F]{6}$/'],
        'wallpaperFit' => ['in:cover,contain,center,tile'],
        'dockSize' => ['integer', 'between:36,80'],
        'dockMagnify' => ['boolean'],
        'dockMagnifyScale' => ['numeric', 'between:1.1,2'],
        'dockAutohide' => ['boolean'],
        'desktopIcons' => ['boolean'],
        'restoreWindows' => ['boolean'],
        'clockSeconds' => ['boolean'],
        'clockDate' => ['boolean'],
        'autoLockMinutes' => ['in:0,5,10,15,30,60'],
        'cursorStyle' => ['in:mac,system'],
        'cursorSize' => ['numeric', 'between:1,3'],
        'cursorFill' => ['regex:/^#[0-9a-fA-F]{6}$/'],
        'cursorOutline' => ['regex:/^#[0-9a-fA-F]{6}$/'],
        'shakeToLocate' => ['boolean'],
        'titlebarDoubleClick' => ['in:maximize,minimize,none'],
        'stageManager' => ['boolean'],
        'desktopStacks' => ['boolean'],
        'deskAlign' => ['boolean'],
        'deskSort' => ['in:none,name,kind,date'],
        'deskPositions' => ['array', 'max:500'],
        'deskPositions.*' => ['array', 'size:2'],
        'deskPositions.*.*' => ['integer', 'between:-200,20000'],
        'tiling' => ['boolean'],
        'hotTL' => ['in:none,mission,desktop,launchpad,spotlight,notifications,screensaver,lock'],
        'hotTR' => ['in:none,mission,desktop,launchpad,spotlight,notifications,screensaver,lock'],
        'hotBL' => ['in:none,mission,desktop,launchpad,spotlight,notifications,screensaver,lock'],
        'hotBR' => ['in:none,mission,desktop,launchpad,spotlight,notifications,screensaver,lock'],
        'dndUntil' => ['integer', 'min:0'],
        'sounds' => ['boolean'],
        'soundVolume' => ['numeric', 'between:0,1'],
        'notifySound' => ['in:vetro,gocce,campanello,nessuno'],
        'startupSound' => ['boolean'],
        'screensaverMinutes' => ['in:0,1,2,5,10,20,30'],
        'screensaverStyle' => ['in:orologio,aurora,bolle'],
        'shortcuts' => ['array', 'max:40'],
        'shortcuts.*' => ['nullable', 'string', 'max:40'],
        'webxSearch' => ['in:bing,wikipedia'],
        'webxBookmarks' => ['array', 'max:200'],
        'webxBookmarks.*.title' => ['required', 'string', 'max:200'],
        'webxBookmarks.*.url' => ['required', 'string', 'max:2000', 'regex:/^https?:\/\//i'],
    ];

    private function wallpaperPath(Request $request): ?string
    {
        foreach (Storage::disk('local')->files('wallpapers') as $file) {
            if (str_starts_with(basename($file), $request->user()->id.'.')) {
                return $file;
            }
        }

        return null;
    }

    public function update(Request $request)
    {
        $rules = collect(self::RULES)->mapWithKeys(fn ($r, $k) => [$k => array_merge(['sometimes'], $r)])->all();
        $data = $request->validate($rules);

        $user = $request->user();
        $user->settings = array_merge($user->settings ?? [], $data);
        $user->save();

        return $user->settings;
    }

    public function uploadWallpaper(Request $request)
    {
        $request->validate(
            ['image' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,gif', 'max:15360']],
            ['image.mimes' => 'Usa un\'immagine JPG, PNG, WebP o GIF.', 'image.max' => 'L\'immagine può essere al massimo di 15 MB.']
        );

        if ($old = $this->wallpaperPath($request)) {
            Storage::disk('local')->delete($old);
        }
        $file = $request->file('image');
        $file->storeAs('wallpapers', $request->user()->id.'.'.$file->extension(), 'local');

        $user = $request->user();
        $user->settings = array_merge($user->settings ?? [], ['wallpaper' => 'custom', 'wallpaperVersion' => time()]);
        $user->save();

        return $user->settings;
    }

    public function wallpaper(Request $request)
    {
        $path = $this->wallpaperPath($request);
        abort_unless($path, 404);

        return Storage::disk('local')->response($path, null, ['Cache-Control' => 'private, max-age=31536000']);
    }

    public function deleteWallpaper(Request $request)
    {
        if ($path = $this->wallpaperPath($request)) {
            Storage::disk('local')->delete($path);
        }
        $user = $request->user();
        $settings = $user->settings ?? [];
        if (($settings['wallpaper'] ?? null) === 'custom') {
            $settings['wallpaper'] = '1';
        }
        unset($settings['wallpaperVersion']);
        $user->settings = $settings;
        $user->save();

        return $user->settings;
    }
}
