<?php

namespace App\Http\Controllers;

use App\Models\Reminder;
use App\Models\ReminderList;
use Illuminate\Http\Request;

/** Promemoria: liste e voci dell'utente. */
class ReminderController extends Controller
{
    private const COLORS = 'red,orange,yellow,green,blue,purple,pink,brown,gray';

    public function index(Request $request)
    {
        $uid = $request->user()->id;
        if (! ReminderList::where('user_id', $uid)->exists()) {
            ReminderList::forceCreate(['user_id' => $uid, 'name' => 'Promemoria', 'color' => 'blue']);
        }

        return [
            'lists' => ReminderList::where('user_id', $uid)->orderBy('position')->orderBy('id')->get(['id', 'name', 'color', 'position']),
            // Le voci completate da più di 30 giorni non servono all'interfaccia
            'items' => Reminder::where('user_id', $uid)->where(fn ($q) => $q->whereNull('done_at')->orWhere('done_at', '>', now()->subDays(30)))
                ->orderBy('position')->orderBy('id')->get(),
        ];
    }

    private function listOf(Request $request, $id): ReminderList
    {
        return ReminderList::where('user_id', $request->user()->id)->findOrFail($id);
    }

    public function storeList(Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:100'], 'color' => ['in:'.self::COLORS]]);

        return ReminderList::forceCreate(['user_id' => $request->user()->id, 'position' => ReminderList::where('user_id', $request->user()->id)->max('position') + 1] + $data);
    }

    public function updateList(Request $request, $id)
    {
        $list = $this->listOf($request, $id);
        $list->update($request->validate(['name' => ['sometimes', 'required', 'string', 'max:100'], 'color' => ['sometimes', 'in:'.self::COLORS]]));

        return $list;
    }

    public function destroyList(Request $request, $id)
    {
        abort_if(ReminderList::where('user_id', $request->user()->id)->count() <= 1, 422, 'Deve restare almeno una lista.');
        $this->listOf($request, $id)->delete();

        return response()->noContent();
    }

    private function rules(bool $create): array
    {
        $r = $create ? 'required' : 'sometimes';

        return [
            'reminder_list_id' => [$r, 'integer'], 'title' => [$r, 'string', 'max:500'], 'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'due_at' => ['sometimes', 'nullable', 'date'], 'has_time' => ['sometimes', 'boolean'], 'priority' => ['sometimes', 'integer', 'between:0,3'],
            'flagged' => ['sometimes', 'boolean'], 'done' => ['sometimes', 'boolean'], 'position' => ['sometimes', 'integer'],
        ];
    }

    private function fill(Reminder $item, array $data, Request $request): Reminder
    {
        if (isset($data['reminder_list_id'])) {
            $this->listOf($request, $data['reminder_list_id']);
        }
        if (array_key_exists('done', $data)) {
            $item->done_at = $data['done'] ? ($item->done_at ?? now()) : null;
            unset($data['done']);
        }
        $item->fill($data);

        return $item;
    }

    public function store(Request $request)
    {
        $item = new Reminder;
        $item->user_id = $request->user()->id;
        $this->fill($item, $request->validate($this->rules(true)), $request)->save();

        return $item->refresh();
    }

    public function update(Request $request, $id)
    {
        $item = Reminder::where('user_id', $request->user()->id)->findOrFail($id);
        $this->fill($item, $request->validate($this->rules(false)), $request)->save();

        return $item->refresh();
    }

    public function destroy(Request $request, $id)
    {
        Reminder::where('user_id', $request->user()->id)->findOrFail($id)->delete();

        return response()->noContent();
    }
}
