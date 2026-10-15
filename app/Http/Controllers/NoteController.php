<?php

namespace App\Http\Controllers;

use App\Models\Note;
use Illuminate\Http\Request;

class NoteController extends Controller
{
    public function index(Request $request)
    {
        return $request->user()->notes()->latest('updated_at')->get(['id', 'body', 'updated_at']);
    }

    public function store(Request $request)
    {
        $data = $request->validate(['body' => ['nullable', 'string', 'max:1000000']]);

        return $request->user()->notes()->create(['body' => $data['body'] ?? '']);
    }

    public function update(Request $request, Note $note)
    {
        abort_unless($note->user_id === $request->user()->id, 404);
        $note->update($request->validate(['body' => ['nullable', 'string', 'max:1000000']]));

        return $note->only('id', 'body', 'updated_at');
    }

    public function destroy(Request $request, Note $note)
    {
        abort_unless($note->user_id === $request->user()->id, 404);
        $note->delete();

        return response()->noContent();
    }
}
