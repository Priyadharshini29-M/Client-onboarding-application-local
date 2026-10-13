<?php
declare(strict_types=1);

namespace App\Core;

/** Small file-based counters for slowing down abuse: wrong passwords, repeated uploads on public links. */
class RateLimit
{
    /** Counts one attempt and throws 429 once there have been $max within $seconds. */
    public static function hit(string $key, int $max, int $seconds, string $message): void
    {
        $hits = self::recent($key, $seconds);
        if (count($hits) >= $max) throw new HttpException(429, $message);
        $hits[] = time();
        self::write($key, $hits);
    }

    /** True when $max attempts already happened within $seconds (does not count a new one). */
    public static function blocked(string $key, int $max, int $seconds): bool
    {
        return count(self::recent($key, $seconds)) >= $max;
    }

    public static function add(string $key, int $seconds): void
    {
        $hits = self::recent($key, $seconds);
        $hits[] = time();
        self::write($key, $hits);
    }

    public static function clear(string $key): void
    {
        @unlink(self::file($key));
    }

    /** The visitor's IP. Behind a local proxy or tunnel (ngrok), the forwarded address is the real one. */
    public static function ip(): string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        if (in_array($ip, ['127.0.0.1', '::1'], true) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $ip = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        }
        return $ip;
    }

    private static function recent(string $key, int $seconds): array
    {
        $file = self::file($key);
        $hits = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
        $since = time() - $seconds;
        return array_values(array_filter($hits, fn($t) => $t > $since));
    }

    private static function write(string $key, array $hits): void
    {
        file_put_contents(self::file($key), json_encode(array_slice($hits, -200)), LOCK_EX);
    }

    private static function file(string $key): string
    {
        $dir = __DIR__ . '/../../storage/ratelimit';
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        return $dir . '/' . hash('sha256', $key) . '.json';
    }
}
