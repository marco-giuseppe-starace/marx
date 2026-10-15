<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Reminder extends Model
{
    protected $guarded = ['id', 'user_id'];

    protected function casts(): array
    {
        return ['due_at' => 'datetime', 'done_at' => 'datetime', 'has_time' => 'boolean', 'flagged' => 'boolean'];
    }
}
