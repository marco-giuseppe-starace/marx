<?php

namespace App\Http\Controllers;

use App\Models\Reminder;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

/** Avvisi in scadenza (promemoria ed eventi) per il Centro notifiche. */
class AlertController extends Controller
{
    public function index(Request $request)
    {
        $q = $request->validate(['from' => ['required', 'date'], 'to' => ['required', 'date']]);
        $from = CarbonImmutable::parse($q['from']);
        $to = CarbonImmutable::parse($q['to']);
        $uid = $request->user()->id;

        $alerts = Reminder::where('user_id', $uid)->whereNull('done_at')->where('has_time', true)->whereBetween('due_at', [$from, $to])->get()
            ->map(fn ($r) => ['key' => "r{$r->id}@".$r->due_at->timestamp, 'app' => 'Promemoria', 'text' => $r->title, 'at' => $r->due_at->toIso8601String()])->all();

        // Eventi con avviso: l'avviso cade alert_minutes prima dell'inizio
        foreach (CalendarController::occurrences($uid, $from, $to->addDays(28)) as $o) {
            if ($o['alert_minutes'] === null) {
                continue;
            }
            $at = CarbonImmutable::parse($o['start'])->subMinutes($o['alert_minutes']);
            if ($at >= $from && $at <= $to) {
                $when = $o['alert_minutes'] === 0 ? 'adesso' : 'tra '.($o['alert_minutes'] < 60 ? $o['alert_minutes'].' min' : intdiv($o['alert_minutes'], 60).' h');
                $alerts[] = ['key' => "e{$o['id']}@".CarbonImmutable::parse($o['start'])->timestamp, 'app' => 'Calendario', 'text' => "{$o['title']} — {$when}", 'at' => $at->toIso8601String()];
            }
        }

        return $alerts;
    }
}
