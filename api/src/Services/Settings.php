<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Crypto;
use App\Core\Db;

/** App-wide settings in the app_settings table. Secrets are stored encrypted. */
class Settings
{
    private static ?array $cache = null;

    public static function get(string $name, ?string $default = null): ?string
    {
        self::load();
        if (!array_key_exists($name, self::$cache)) return $default;
        [$value, $secret] = self::$cache[$name];
        if ($value === null || $value === '') return $default;
        return $secret ? Crypto::decrypt($value) : $value;
    }

    public static function bool(string $name, bool $default = false): bool
    {
        $v = self::get($name);
        return $v === null ? $default : $v === '1';
    }

    public static function set(string $name, ?string $value, bool $secret = false): void
    {
        $stored = $value === null || $value === '' ? null : ($secret ? Crypto::encrypt($value) : $value);
        Db::exec(
            'INSERT INTO app_settings (name, value, is_secret) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), is_secret = VALUES(is_secret)',
            [$name, $stored, $secret ? 1 : 0]
        );
        self::$cache = null;
    }

    private static function load(): void
    {
        if (self::$cache !== null) return;
        self::$cache = [];
        try {
            foreach (Db::all('SELECT name, value, is_secret FROM app_settings') as $r) self::$cache[$r['name']] = [$r['value'], (bool) $r['is_secret']];
        } catch (\Throwable $e) {
            // Table missing during setup: behave as if nothing is set.
        }
    }
}
