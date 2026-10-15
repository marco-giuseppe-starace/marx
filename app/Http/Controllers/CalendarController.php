<?php

namespace App\Http\Controllers;

use App\Models\Calendar;
use App\Models\Event;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

/** Calendario: calendari colorati ed eventi (anche ripetuti), espansi nell'intervallo richiesto. */
class CalendarController extends Controller
{
    private const COLORS = 'red,orange,yellow,green,blue,purple,pink,brown,gray';

    private const REPEATS = 'none,daily,weekly,monthly,yearly';

    public function calendars(Request $request)
    {
        $uid = $request->user()->id;
        if (! Calendar::where('user_id', $uid)->exists()) {
            Calendar::forceCreate(['user_id' => $uid, 'name' => 'Personale', 'color' => 'blue']);
            Calendar::forceCreate(['user_id' => $uid, 'name' => 'Lavoro', 'color' => 'red']);
        }

        return Calendar::where('user_id', $uid)->orderBy('id')->get(['id', 'name', 'color', 'visible']);
    }

    private function cal(Request $request, $id): Calendar
    {
        return Calendar::where('user_id', $request->user()->id)->findOrFail($id);
    }

    public function storeCalendar(Request $request)
    {
        return Calendar::forceCreate(['user_id' => $request->user()->id] + $request->validate(['name' => ['required', 'string', 'max:100'], 'color' => ['in:'.self::COLORS]]));
    }

    public function updateCalendar(Request $request, $id)
    {
        $c = $this->cal($request, $id);
        $c->update($request->validate(['name' => ['sometimes', 'required', 'string', 'max:100'], 'color' => ['sometimes', 'in:'.self::COLORS], 'visible' => ['sometimes', 'boolean']]));

        return $c;
    }

    public function destroyCalendar(Request $request, $id)
    {
        abort_if(Calendar::where('user_id', $request->user()->id)->count() <= 1, 422, 'Deve restare almeno un calendario.');
        $this->cal($request, $id)->delete();

        return response()->noContent();
    }

    /** Occorrenze degli eventi che cadono nell'intervallo [from, to]. */
    public function events(Request $request)
    {
        $q = $request->validate(['from' => ['required', 'date'], 'to' => ['required', 'date', 'after:from']]);

        return self::occurrences($request->user()->id, CarbonImmutable::parse($q['from']), CarbonImmutable::parse($q['to']));
    }

    public static function occurrences(int $uid, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $out = [];
        $events = Event::where('user_id', $uid)->where('starts_at', '<=', $to)
            ->where(fn ($w) => $w->where('repeat', '!=', 'none')->orWhere('ends_at', '>=', $from))->get();
        foreach ($events as $e) {
            $start = CarbonImmutable::parse($e->starts_at);
            $dur = $start->diffInSeconds(CarbonImmutable::parse($e->ends_at));
            $until = $e->repeat_until ? CarbonImmutable::parse($e->repeat_until)->endOfDay() : null;
            $s = $start;
            // Ripetizioni a passo fisso: si parte dall'occorrenza subito prima dell'intervallo
            if (in_array($e->repeat, ['daily', 'weekly'], true) && $start < $from) {
                $step = $e->repeat === 'daily' ? 86400 : 604800;
                $skip = max(0, intdiv($start->diffInSeconds($from) - $dur, $step) - 1);
                $s = $start->addSeconds($skip * $step);
            }
            for ($i = 0; $i < 2000; $i++) {
                if ($s > $to || ($until && $s > $until)) {
                    break;
                }
                $end = $s->addSeconds($dur);
                if ($end >= $from) {
                    $out[] = ['id' => $e->id, 'calendar_id' => $e->calendar_id, 'title' => $e->title, 'location' => $e->location, 'notes' => $e->notes,
                        'start' => $s->toIso8601String(), 'end' => $end->toIso8601String(), 'all_day' => $e->all_day, 'repeat' => $e->repeat,
                        'repeat_until' => $e->repeat_until?->format('Y-m-d'), 'alert_minutes' => $e->alert_minutes, 'series_start' => $start->toIso8601String()];
                }
                if ($e->repeat === 'none') {
                    break;
                }
                $s = match ($e->repeat) {
                    'daily' => $s->addDay(), 'weekly' => $s->addWeek(),
                    'monthly' => $start->addMonthsNoOverflow($i + 1), 'yearly' => $start->addYearsNoOverflow($i + 1),
                };
            }
        }
        usort($out, fn ($a, $b) => strcmp($a['start'], $b['start']));

        return $out;
    }

    private function rules(bool $create): array
    {
        $r = $create ? 'required' : 'sometimes';

        return [
            'calendar_id' => [$r, 'integer'], 'title' => [$r, 'string', 'max:300'], 'location' => ['sometimes', 'nullable', 'string', 'max:300'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'], 'starts_at' => [$r, 'date'], 'ends_at' => [$r, 'date', 'after_or_equal:starts_at'],
            'all_day' => ['sometimes', 'boolean'], 'repeat' => ['sometimes', 'in:'.self::REPEATS], 'repeat_until' => ['sometimes', 'nullable', 'date'],
            'alert_minutes' => ['sometimes', 'nullable', 'integer', 'between:0,40320'],
        ];
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules(true));
        $this->cal($request, $data['calendar_id']);

        return Event::forceCreate(['user_id' => $request->user()->id] + $data);
    }

    public function update(Request $request, $id)
    {
        $e = Event::where('user_id', $request->user()->id)->findOrFail($id);
        $data = $request->validate($this->rules(false));
        if (isset($data['calendar_id'])) {
            $this->cal($request, $data['calendar_id']);
        }
        $e->update($data);

        return $e;
    }

    public function destroy(Request $request, $id)
    {
        Event::where('user_id', $request->user()->id)->findOrFail($id)->delete();

        return response()->noContent();
    }
}
