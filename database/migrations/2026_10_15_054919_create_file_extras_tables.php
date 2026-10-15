<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Cestino: elementi spostati in users/{id}/.trash/{stored}/{name}
        Schema::create('trash_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('original_path', 1024);
            $table->string('stored', 64);
            $table->string('name');
            $table->string('type', 10);
            $table->unsignedBigInteger('size')->nullable();
            $table->timestamps();
        });

        // Tag colorati (il percorso è indicizzato tramite hash: i percorsi possono essere lunghi)
        Schema::create('file_tags', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('path', 1024);
            $table->char('path_hash', 40);
            $table->string('color', 10);
            $table->timestamps();
            $table->unique(['user_id', 'path_hash', 'color']);
        });

        // Condivisioni: link pubblici (token) oppure con un altro utente (target_user_id)
        Schema::create('shares', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('path', 1024);
            $table->string('type', 10);
            $table->char('token', 40)->nullable()->unique();
            $table->string('password')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->foreignId('target_user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->unsignedInteger('downloads')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shares');
        Schema::dropIfExists('file_tags');
        Schema::dropIfExists('trash_items');
    }
};
