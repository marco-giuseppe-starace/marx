<?php

use App\Http\Controllers\AppStoreController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\FileController;
use App\Http\Controllers\NoteController;
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
