<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FileTag extends Model
{
    protected $guarded = ['id'];

    public const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

    protected static function booted(): void
    {
        static::saving(fn (FileTag $t) => $t->path_hash = sha1($t->path));
    }
}
