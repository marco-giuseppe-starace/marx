<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PhotoAlbum extends Model
{
    protected $table = 'photo_albums';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['meta' => 'array', 'items' => 'array'];
    }
}
