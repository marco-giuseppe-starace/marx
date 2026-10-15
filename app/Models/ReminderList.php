<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ReminderList extends Model
{
    protected $guarded = ['id', 'user_id'];

    public function reminders(): HasMany
    {
        return $this->hasMany(Reminder::class);
    }
}
