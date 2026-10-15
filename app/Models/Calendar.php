<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Calendar extends Model
{
    protected $guarded = ['id', 'user_id'];

    protected function casts(): array
    {
        return ['visible' => 'boolean'];
    }
}
