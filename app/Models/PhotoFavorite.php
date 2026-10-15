<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PhotoFavorite extends Model
{
    protected $table = 'photo_favorites';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['meta' => 'array', 'items' => 'array'];
    }
}
