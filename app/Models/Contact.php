<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Contact extends Model
{
    protected $guarded = ['id', 'user_id'];

    protected function casts(): array
    {
        return ['emails' => 'array', 'phones' => 'array', 'addresses' => 'array', 'birthday' => 'date:Y-m-d', 'favorite' => 'boolean'];
    }
}
