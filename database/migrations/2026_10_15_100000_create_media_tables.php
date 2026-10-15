<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Dati letti dai file (EXIF delle foto, tag dei brani), ricalcolati solo se il file cambia
        Schema::create('media_meta', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('path', 1024);
            $table->char('path_hash', 40);
            $table->string('kind', 10);
            $table->unsignedBigInteger('mtime');
            $table->unsignedBigInteger('size');
            $table->json('meta')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'path_hash']);
        });
        Schema::create('photo_favorites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('path', 1024);
            $table->char('path_hash', 40);
            $table->timestamps();
            $table->unique(['user_id', 'path_hash']);
        });
        Schema::create('photo_albums', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->json('items')->nullable();
            $table->timestamps();
        });
        Schema::create('playlists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->json('items')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('playlists');
        Schema::dropIfExists('photo_albums');
        Schema::dropIfExists('photo_favorites');
        Schema::dropIfExists('media_meta');
    }
};
