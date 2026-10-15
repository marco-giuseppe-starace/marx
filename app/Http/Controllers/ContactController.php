<?php

namespace App\Http\Controllers;

use App\Models\Contact;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/** Contatti, con importazione ed esportazione vCard (iPhone, Android, Outlook). */
class ContactController extends Controller
{
    public function index(Request $request)
    {
        return Contact::where('user_id', $request->user()->id)->orderBy('last_name')->orderBy('first_name')->orderBy('company')->get();
    }

    private function rules(): array
    {
        return [
            'first_name' => ['nullable', 'string', 'max:100'], 'last_name' => ['nullable', 'string', 'max:100'], 'company' => ['nullable', 'string', 'max:150'],
            'job_title' => ['nullable', 'string', 'max:150'], 'birthday' => ['nullable', 'date'], 'website' => ['nullable', 'string', 'max:300'],
            'notes' => ['nullable', 'string', 'max:5000'], 'favorite' => ['boolean'],
            'emails' => ['nullable', 'array', 'max:10'], 'emails.*.label' => ['nullable', 'string', 'max:30'], 'emails.*.value' => ['required', 'string', 'max:200'],
            'phones' => ['nullable', 'array', 'max:10'], 'phones.*.label' => ['nullable', 'string', 'max:30'], 'phones.*.value' => ['required', 'string', 'max:50'],
            'addresses' => ['nullable', 'array', 'max:5'], 'addresses.*.label' => ['nullable', 'string', 'max:30'], 'addresses.*.value' => ['required', 'string', 'max:500'],
        ];
    }

    private function mine(Request $request, $id): Contact
    {
        return Contact::where('user_id', $request->user()->id)->findOrFail($id);
    }

    public function store(Request $request)
    {
        return Contact::forceCreate(['user_id' => $request->user()->id] + $request->validate($this->rules()));
    }

    public function update(Request $request, $id)
    {
        $c = $this->mine($request, $id);
        $c->update($request->validate(array_map(fn ($r) => array_merge(['sometimes'], $r), $this->rules())));

        return $c;
    }

    public function destroy(Request $request, $id)
    {
        $c = $this->mine($request, $id);
        if ($c->photo) {
            Storage::disk('local')->delete('contacts/'.$c->photo);
        }
        $c->delete();

        return response()->noContent();
    }

    public function uploadPhoto(Request $request, $id)
    {
        $c = $this->mine($request, $id);
        $request->validate(['photo' => ['required', 'image', 'max:5120']], ['photo.max' => 'La foto può essere al massimo di 5 MB.']);
        if ($c->photo) {
            Storage::disk('local')->delete('contacts/'.$c->photo);
        }
        $name = $request->user()->id.'-'.$c->id.'-'.time().'.'.$request->file('photo')->extension();
        $request->file('photo')->storeAs('contacts', $name, 'local');
        $c->update(['photo' => $name]);

        return $c;
    }

    public function photo(Request $request, $id)
    {
        $c = $this->mine($request, $id);
        abort_unless($c->photo && Storage::disk('local')->exists('contacts/'.$c->photo), 404);

        return Storage::disk('local')->response('contacts/'.$c->photo, null, ['Cache-Control' => 'private, max-age=86400']);
    }

    // ---------------------------------------------------------------- vCard

    public function import(Request $request)
    {
        $request->validate(['file' => ['required', 'file', 'max:10240']]);
        $text = file_get_contents($request->file('file')->getRealPath());
        // Righe «piegate»: una riga che inizia con spazio continua la precedente
        $text = preg_replace("/\r?\n[ \t]/", '', str_replace("\r\n", "\n", $text));
        $count = 0;
        foreach (preg_split('/BEGIN:VCARD/i', $text) as $card) {
            if (! stripos($card, 'END:VCARD')) {
                continue;
            }
            $data = ['emails' => [], 'phones' => [], 'addresses' => []];
            foreach (explode("\n", $card) as $line) {
                if (! str_contains($line, ':')) {
                    continue;
                }
                [$head, $value] = explode(':', $line, 2);
                $parts = explode(';', $head);
                $key = strtoupper(preg_replace('/^item\d+\./i', '', $parts[0]));
                $params = strtoupper(implode(';', array_slice($parts, 1)));
                if (str_contains($params, 'QUOTED-PRINTABLE')) {
                    $value = quoted_printable_decode($value);
                }
                $value = str_replace(['\\n', '\\,', '\;'], ["\n", ',', ';'], trim($value));
                $label = str_contains($params, 'WORK') ? 'lavoro' : (str_contains($params, 'HOME') ? 'casa' : (str_contains($params, 'CELL') ? 'cellulare' : null));
                switch ($key) {
                    case 'N':
                        $n = explode(';', $value);
                        $data['last_name'] = $n[0] ?? null;
                        $data['first_name'] = $n[1] ?? null;
                        break;
                    case 'FN':
                        $data['fn'] = $value;
                        break;
                    case 'ORG':
                        $data['company'] = trim(explode(';', $value)[0]);
                        break;
                    case 'TITLE':
                        $data['job_title'] = $value;
                        break;
                    case 'EMAIL':
                        $data['emails'][] = ['label' => $label, 'value' => $value];
                        break;
                    case 'TEL':
                        $data['phones'][] = ['label' => $label, 'value' => $value];
                        break;
                    case 'ADR':
                        $data['addresses'][] = ['label' => $label, 'value' => trim(implode(', ', array_filter(array_map('trim', explode(';', $value)))))];
                        break;
                    case 'BDAY':
                        $ts = strtotime(preg_replace('/^--/', '1900-', $value));
                        $data['birthday'] = $ts ? date('Y-m-d', $ts) : null;
                        break;
                    case 'URL':
                        $data['website'] = $value;
                        break;
                    case 'NOTE':
                        $data['notes'] = $value;
                        break;
                }
            }
            if (empty($data['first_name']) && empty($data['last_name']) && ! empty($data['fn'])) {
                $bits = explode(' ', $data['fn'], 2);
                $data['first_name'] = $bits[0];
                $data['last_name'] = $bits[1] ?? null;
            }
            unset($data['fn']);
            if (empty($data['first_name']) && empty($data['last_name']) && empty($data['company']) && ! $data['emails'] && ! $data['phones']) {
                continue;
            }
            foreach (['first_name' => 100, 'last_name' => 100, 'company' => 150, 'job_title' => 150, 'website' => 300] as $f => $max) {
                if (isset($data[$f])) {
                    $data[$f] = mb_substr($data[$f], 0, $max);
                }
            }
            Contact::forceCreate(['user_id' => $request->user()->id] + $data);
            if (++$count >= 5000) {
                break;
            }
        }

        return ['imported' => $count];
    }

    public function export(Request $request)
    {
        $ids = array_filter(explode(',', (string) $request->query('ids')));
        $q = Contact::where('user_id', $request->user()->id);
        if ($ids) {
            $q->whereIn('id', $ids);
        }
        $esc = fn ($v) => str_replace(["\\", "\n", ',', ';'], ['\\\\', '\\n', '\\,', '\;'], (string) $v);
        $out = '';
        foreach ($q->get() as $c) {
            $fn = trim($c->first_name.' '.$c->last_name) ?: ($c->company ?: 'Senza nome');
            $out .= "BEGIN:VCARD\r\nVERSION:3.0\r\nN:{$esc($c->last_name)};{$esc($c->first_name)};;;\r\nFN:{$esc($fn)}\r\n";
            $out .= $c->company ? "ORG:{$esc($c->company)}\r\n" : '';
            $out .= $c->job_title ? "TITLE:{$esc($c->job_title)}\r\n" : '';
            $type = fn ($l) => ['lavoro' => 'WORK', 'casa' => 'HOME', 'cellulare' => 'CELL'][$l] ?? 'OTHER';
            foreach ($c->emails ?? [] as $e) {
                $out .= 'EMAIL;TYPE='.$type($e['label'] ?? '').":{$esc($e['value'])}\r\n";
            }
            foreach ($c->phones ?? [] as $p) {
                $out .= 'TEL;TYPE='.$type($p['label'] ?? '').":{$esc($p['value'])}\r\n";
            }
            foreach ($c->addresses ?? [] as $a) {
                $out .= 'ADR;TYPE='.$type($a['label'] ?? '').":;;{$esc($a['value'])};;;;\r\n";
            }
            $out .= $c->birthday ? 'BDAY:'.$c->birthday->format('Y-m-d')."\r\n" : '';
            $out .= $c->website ? "URL:{$esc($c->website)}\r\n" : '';
            $out .= $c->notes ? "NOTE:{$esc($c->notes)}\r\n" : '';
            $out .= "END:VCARD\r\n";
        }

        return response($out, 200, ['Content-Type' => 'text/vcard; charset=utf-8', 'Content-Disposition' => 'attachment; filename="contatti.vcf"']);
    }
}
