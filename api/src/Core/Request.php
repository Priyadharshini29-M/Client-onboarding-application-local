<?php
declare(strict_types=1);

namespace App\Core;

class Request
{
    public string $method = 'GET';
    public string $path = '/';
    public array $query = [];
    public array $body = [];
    public array $params = [];
    public ?array $user = null;

    public static function capture(): self
    {
        $r = new self();
        $r->method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        // Allow the API to live under a sub-folder, e.g. /digiops/api/public.
        $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
        if ($base !== '' && strpos($uri, $base) === 0) $uri = substr($uri, strlen($base));
        $uri = preg_replace('#^/api(?=/|$)#', '', $uri);
        $r->path = '/' . trim((string) $uri, '/');
        $r->query = $_GET;
        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
        if (stripos($contentType, 'application/json') !== false) {
            $decoded = json_decode(file_get_contents('php://input') ?: '', true);
            $r->body = is_array($decoded) ? $decoded : [];
        } else {
            $r->body = $_POST;
        }
        return $r;
    }

    public function input(string $key, $default = null)
    {
        return $this->body[$key] ?? $default;
    }

    public function param(string $key): int
    {
        return (int) ($this->params[$key] ?? 0);
    }

    public function bearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/Bearer\s+(\S+)/i', $header, $m)) return $m[1];
        return null;
    }
}
