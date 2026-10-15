<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Playlist extends Model
{
    protected $table = 'playlists';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['meta' => 'array', 'items' => 'array'];
    }
}
