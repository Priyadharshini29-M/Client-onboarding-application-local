<?php
declare(strict_types=1);

namespace App\Core;

/** AES-256-GCM for credential fields. Stored as "enc:v1:" . base64(iv . tag . ciphertext). */
class Crypto
{
    private const PREFIX = 'enc:v1:';

    private static function key(): string
    {
        return hash('sha256', (string) config('app_key'), true);
    }

    public static function encrypt(string $plain): string
    {
        if ($plain === '') return '';
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        return self::PREFIX . base64_encode($iv . $tag . $cipher);
    }

    public static function decrypt(?string $stored): ?string
    {
        if ($stored === null || $stored === '') return $stored;
        if (strpos($stored, self::PREFIX) !== 0) return $stored;
        $raw = base64_decode(substr($stored, strlen(self::PREFIX)), true);
        if ($raw === false || strlen($raw) < 29) return null;
        $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
        return $plain === false ? null : $plain;
    }
}
