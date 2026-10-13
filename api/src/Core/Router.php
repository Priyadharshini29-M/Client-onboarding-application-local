<?php
declare(strict_types=1);

namespace App\Core;

class Router
{
    /** @var array<int, array{method:string, regex:string, keys:array, handler:callable, auth:bool}> */
    private array $routes = [];

    public function get(string $path, callable $handler, bool $auth = true): void { $this->add('GET', $path, $handler, $auth); }
    public function post(string $path, callable $handler, bool $auth = true): void { $this->add('POST', $path, $handler, $auth); }
    public function put(string $path, callable $handler, bool $auth = true): void { $this->add('PUT', $path, $handler, $auth); }
    public function patch(string $path, callable $handler, bool $auth = true): void { $this->add('PATCH', $path, $handler, $auth); }
    public function delete(string $path, callable $handler, bool $auth = true): void { $this->add('DELETE', $path, $handler, $auth); }

    private function add(string $method, string $path, callable $handler, bool $auth): void
    {
        preg_match_all('#\{(\w+)\}#', $path, $m);
        $regex = '#^' . preg_replace('#\{\w+\}#', '([^/]+)', $path) . '$#';
        $this->routes[] = ['method' => $method, 'regex' => $regex, 'keys' => $m[1], 'handler' => $handler, 'auth' => $auth];
    }

    public function dispatch(Request $request): void
    {
        $this->cors();
        if ($request->method === 'OPTIONS') { Response::noContent(); return; }

        $pathMatched = false;
        foreach ($this->routes as $route) {
            if (!preg_match($route['regex'], $request->path, $m)) continue;
            $pathMatched = true;
            if ($route['method'] !== $request->method) continue;
            array_shift($m);
            $request->params = $route['keys'] ? array_combine($route['keys'], $m) : [];
            if ($route['auth']) $request->user = Auth::requireUser($request);
            $result = ($route['handler'])($request);
            if ($result === null) Response::noContent();
            else Response::json($result);
            return;
        }
        throw $pathMatched
            ? new HttpException(405, 'Method not allowed.')
            : new HttpException(404, 'Endpoint not found.');
    }

    private function cors(): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin && in_array($origin, (array) config('cors_origins', []), true)) {
            header("Access-Control-Allow-Origin: $origin");
            header('Vary: Origin');
            header('Access-Control-Allow-Headers: Authorization, Content-Type');
            header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        }
    }
}
