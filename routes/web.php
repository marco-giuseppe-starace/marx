<?php

use App\Http\Controllers\AlertController;
use App\Http\Controllers\AppStoreController;
use App\Http\Controllers\CalendarController;
use App\Http\Controllers\ContactController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\FileController;
use App\Http\Controllers\GeoController;
use App\Http\Controllers\MediaController;
use App\Http\Controllers\NoteController;
use App\Http\Controllers\ReminderController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\SettingsController;
use App\Http\Controllers\ShareController;
use App\Http\Controllers\UpdateController;
use App\Http\Controllers\UserAdminController;
use App\Http\Controllers\WebxController;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'show'])->name('login');
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');
});

// Link di condivisione pubblici: non richiedono l'accesso
Route::middleware('throttle:60,1')->group(function () {
    Route::get('/s/{token}', [ShareController::class, 'publicShow'])->where('token', '[A-Za-z0-9]{40}');
    Route::post('/s/{token}', [ShareController::class, 'publicUnlock'])->where('token', '[A-Za-z0-9]{40}')->middleware('throttle:10,1');
    Route::get('/s/{token}/download', [ShareController::class, 'publicDownload'])->where('token', '[A-Za-z0-9]{40}');
});

Route::middleware('auth')->group(function () {
    Route::view('/', 'desktop')->name('desktop');
    Route::post('/logout', [AuthController::class, 'logout'])->name('logout');
    Route::post('/unlock', [AuthController::class, 'unlock'])->middleware('throttle:5,1');
    Route::put('/password', [AuthController::class, 'updatePassword']);
    Route::put('/profile', [AuthController::class, 'updateProfile']);
    Route::put('/settings', [SettingsController::class, 'update']);
    Route::get('/search', [SearchController::class, 'search'])->middleware('throttle:120,1');
    Route::get('/webx/check', [WebxController::class, 'check'])->middleware('throttle:120,1');
    Route::post('/settings/wallpaper', [SettingsController::class, 'uploadWallpaper']);
    Route::get('/settings/wallpaper', [SettingsController::class, 'wallpaper'])->name('wallpaper');
    Route::delete('/settings/wallpaper', [SettingsController::class, 'deleteWallpaper']);

    Route::get('/notes', [NoteController::class, 'index']);
    Route::post('/notes', [NoteController::class, 'store']);
    Route::put('/notes/{note}', [NoteController::class, 'update']);
    Route::delete('/notes/{note}', [NoteController::class, 'destroy']);

    Route::get('/files', [FileController::class, 'index']);
    Route::post('/files/upload', [FileController::class, 'upload']);
    Route::post('/files/folder', [FileController::class, 'mkdir']);
    Route::post('/files/rename', [FileController::class, 'rename']);
    Route::get('/files/download', [FileController::class, 'download']);
    Route::delete('/files', [FileController::class, 'destroy']);
    Route::post('/files/move', [FileController::class, 'move']);
    Route::post('/files/duplicate', [FileController::class, 'duplicate']);
    Route::get('/files/text', [FileController::class, 'text']);
    Route::post('/files/save', [FileController::class, 'save']);
    Route::post('/files/save-binary', [FileController::class, 'saveBinary']);
    Route::post('/settings/wallpaper-from', [SettingsController::class, 'wallpaperFromFile']);

    Route::get('/media/photos', [MediaController::class, 'photos']);
    Route::get('/media/thumb', [MediaController::class, 'thumb']);
    Route::get('/media/photo-info', [MediaController::class, 'photoInfo']);
    Route::post('/media/favorite', [MediaController::class, 'favorite']);
    Route::post('/media/albums', [MediaController::class, 'storeAlbum']);
    Route::put('/media/albums/{id}', [MediaController::class, 'updateAlbum'])->whereNumber('id');
    Route::delete('/media/albums/{id}', [MediaController::class, 'destroyAlbum'])->whereNumber('id');
    Route::get('/media/music', [MediaController::class, 'music']);
    Route::get('/media/cover', [MediaController::class, 'cover']);
    Route::post('/media/playlists', [MediaController::class, 'storePlaylist']);
    Route::put('/media/playlists/{id}', [MediaController::class, 'updatePlaylist'])->whereNumber('id');
    Route::delete('/media/playlists/{id}', [MediaController::class, 'destroyPlaylist'])->whereNumber('id');
    Route::middleware('throttle:geo')->group(function () {
        Route::get('/geo/weather', [GeoController::class, 'weather']);
        Route::get('/geo/cities', [GeoController::class, 'cities']);
        Route::get('/geo/search', [GeoController::class, 'search']);
        Route::get('/geo/reverse', [GeoController::class, 'reverse']);
        Route::post('/geo/route', [GeoController::class, 'route']);
    });
    Route::get('/geo/tile/{layer}/{z}/{x}/{y}', [GeoController::class, 'tile'])->whereNumber(['z', 'x', 'y'])->middleware('throttle:tiles');

    Route::get('/reminders', [ReminderController::class, 'index']);
    Route::post('/reminders', [ReminderController::class, 'store']);
    Route::put('/reminders/{id}', [ReminderController::class, 'update'])->whereNumber('id');
    Route::delete('/reminders/{id}', [ReminderController::class, 'destroy'])->whereNumber('id');
    Route::post('/reminder-lists', [ReminderController::class, 'storeList']);
    Route::put('/reminder-lists/{id}', [ReminderController::class, 'updateList'])->whereNumber('id');
    Route::delete('/reminder-lists/{id}', [ReminderController::class, 'destroyList'])->whereNumber('id');

    Route::get('/calendars', [CalendarController::class, 'calendars']);
    Route::post('/calendars', [CalendarController::class, 'storeCalendar']);
    Route::put('/calendars/{id}', [CalendarController::class, 'updateCalendar'])->whereNumber('id');
    Route::delete('/calendars/{id}', [CalendarController::class, 'destroyCalendar'])->whereNumber('id');
    Route::get('/events', [CalendarController::class, 'events']);
    Route::post('/events', [CalendarController::class, 'store']);
    Route::put('/events/{id}', [CalendarController::class, 'update'])->whereNumber('id');
    Route::delete('/events/{id}', [CalendarController::class, 'destroy'])->whereNumber('id');
    Route::get('/alerts', [AlertController::class, 'index']);

    Route::get('/contacts', [ContactController::class, 'index']);
    Route::post('/contacts', [ContactController::class, 'store']);
    Route::put('/contacts/{id}', [ContactController::class, 'update'])->whereNumber('id');
    Route::delete('/contacts/{id}', [ContactController::class, 'destroy'])->whereNumber('id');
    Route::post('/contacts/{id}/photo', [ContactController::class, 'uploadPhoto'])->whereNumber('id');
    Route::get('/contacts/{id}/photo', [ContactController::class, 'photo'])->whereNumber('id');
    Route::post('/contacts/import', [ContactController::class, 'import']);
    Route::get('/contacts/export', [ContactController::class, 'export']);
    Route::get('/files/trash', [FileController::class, 'trash']);
    Route::post('/files/trash/restore', [FileController::class, 'restore']);
    Route::delete('/files/trash', [FileController::class, 'emptyTrash']);
    Route::post('/files/tags', [FileController::class, 'setTag']);
    Route::get('/files/tagged', [FileController::class, 'tagged']);
    Route::post('/files/zip', [FileController::class, 'zip']);
    Route::post('/files/unzip', [FileController::class, 'unzip']);
    Route::post('/files/share', [ShareController::class, 'createLink']);
    Route::post('/files/share-user', [ShareController::class, 'shareWithUser']);
    Route::get('/files/shares', [ShareController::class, 'mine']);
    Route::delete('/files/shares/{share}', [ShareController::class, 'revoke']);
    Route::get('/files/shared-with-me', [ShareController::class, 'withMe']);
    Route::get('/files/shared/{share}/download', [ShareController::class, 'downloadShared']);

    // App Store: tutti gli utenti vedono le app installate, solo gli amministratori le gestiscono
    Route::get('/appstore/installed', [AppStoreController::class, 'installed']);
    Route::middleware('admin')->group(function () {
        Route::get('/appstore/catalog', [AppStoreController::class, 'catalog']);
        Route::post('/appstore/refresh', [AppStoreController::class, 'refresh']);
        Route::get('/appstore/{app}/describe', [AppStoreController::class, 'describe']);
        Route::post('/appstore/{app}/install', [AppStoreController::class, 'install']);
        Route::delete('/appstore/{app}', [AppStoreController::class, 'uninstall']);
        Route::post('/appstore/{app}/{action}', [AppStoreController::class, 'action']);
        Route::get('/appstore/{app}/logs', [AppStoreController::class, 'logs']);
        Route::get('/appstore/jobs/{id}', [AppStoreController::class, 'job']);
        Route::get('/system/stats', [AppStoreController::class, 'stats']);

        Route::get('/system/update', [UpdateController::class, 'check']);
        Route::post('/system/update', [UpdateController::class, 'apply']);

        Route::get('/admin/users', [UserAdminController::class, 'index']);
        Route::post('/admin/users', [UserAdminController::class, 'store']);
        Route::put('/admin/users/{user}', [UserAdminController::class, 'update']);
        Route::post('/admin/users/{user}/password', [UserAdminController::class, 'resetPassword']);
        Route::delete('/admin/users/{user}', [UserAdminController::class, 'destroy']);
    });
});
