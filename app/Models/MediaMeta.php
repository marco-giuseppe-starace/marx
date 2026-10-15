<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MediaMeta extends Model
{
    protected $table = 'media_meta';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['meta' => 'array', 'items' => 'array'];
    }
}
