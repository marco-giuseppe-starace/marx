<?php

namespace App\Http\Controllers;

use App\Services\Agent;
use Illuminate\Http\Request;
use RuntimeException;

class AppStoreController extends Controller
{
    /** Converte gli errori dell'agente in risposte JSON leggibili. */
    private function agent(string $cmd, array $args = [], int $timeout = 60)
    {
        try {
            return response()->json(Agent::call($cmd, $args, $timeout));
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    private function appId(string $app): string
    {
        abort_unless(preg_match('/^[a-z0-9][a-z0-9-]{1,30}$/', $app), 404);

        return $app;
    }

    public function catalog()
    {
        return $this->agent('catalog');
    }

    public function installed()
    {
        return $this->agent('installed');
    }

    public function install(Request $request, string $app)
    {
        $params = $request->validate(['params' => ['array'], 'params.*' => ['nullable', 'string', 'max:200']])['params'] ?? [];

        return $this->agent('install', ['app' => $this->appId($app), 'params' => $params]);
    }

    public function uninstall(Request $request, string $app)
    {
        return $this->agent('uninstall', ['app' => $this->appId($app), 'keep_data' => $request->boolean('keep_data')]);
    }

    public function action(string $app, string $action)
    {
        abort_unless(in_array($action, ['start', 'stop', 'restart', 'update'], true), 404);

        return $this->agent($action, ['app' => $this->appId($app)], 200);
    }

    public function logs(string $app)
    {
        return $this->agent('logs', ['app' => $this->appId($app), 'lines' => 300]);
    }

    public function job(string $id)
    {
        abort_unless(preg_match('/^[a-f0-9]{12}$/', $id), 404);

        return $this->agent('job', ['id' => $id]);
    }

    public function describe(string $app)
    {
        return $this->agent('describe', ['app' => $this->appId($app)]);
    }

    public function refresh()
    {
        return $this->agent('store_refresh', [], 300);
    }

    public function stats()
    {
        return $this->agent('stats', [], 30);
    }
}
