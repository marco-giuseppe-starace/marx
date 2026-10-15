<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Promemoria: liste colorate con le loro voci
        Schema::create('reminder_lists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->string('color', 10)->default('blue');
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });
        Schema::create('reminders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('reminder_list_id')->constrained()->cascadeOnDelete();
            $table->string('title', 500);
            $table->text('notes')->nullable();
            $table->dateTime('due_at')->nullable();
            $table->boolean('has_time')->default(false);
            $table->unsignedTinyInteger('priority')->default(0);
            $table->boolean('flagged')->default(false);
            $table->dateTime('done_at')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
            $table->index(['user_id', 'due_at']);
        });

        // Calendario: più calendari colorati, eventi anche ripetuti
        Schema::create('calendars', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->string('color', 10)->default('blue');
            $table->boolean('visible')->default(true);
            $table->timestamps();
        });
        Schema::create('events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('calendar_id')->constrained()->cascadeOnDelete();
            $table->string('title', 300);
            $table->string('location', 300)->nullable();
            $table->text('notes')->nullable();
            $table->dateTime('starts_at');
            $table->dateTime('ends_at');
            $table->boolean('all_day')->default(false);
            $table->string('repeat', 10)->default('none');  // none, daily, weekly, monthly, yearly
            $table->date('repeat_until')->nullable();
            $table->integer('alert_minutes')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'starts_at']);
        });

        // Contatti
        Schema::create('contacts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('first_name', 100)->nullable();
            $table->string('last_name', 100)->nullable();
            $table->string('company', 150)->nullable();
            $table->string('job_title', 150)->nullable();
            $table->json('emails')->nullable();
            $table->json('phones')->nullable();
            $table->json('addresses')->nullable();
            $table->date('birthday')->nullable();
            $table->string('website', 300)->nullable();
            $table->text('notes')->nullable();
            $table->string('photo', 100)->nullable();
            $table->boolean('favorite')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contacts');
        Schema::dropIfExists('events');
        Schema::dropIfExists('calendars');
        Schema::dropIfExists('reminders');
        Schema::dropIfExists('reminder_lists');
    }
};
