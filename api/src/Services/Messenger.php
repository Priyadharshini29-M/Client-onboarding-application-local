<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Db;

/**
 * Every email, SMS and WhatsApp message the app sends goes through here.
 * Emails use Brevo when it is connected (else PHP mail() when turned on in config.php);
 * SMS and WhatsApp need Brevo. Everything is logged in email_outbox, sent or not.
 */
class Messenger
{
    /**
     * @param string[] $to
     * @param array{kind?:string, brand_id?:int|null, run_id?:int|null, cc?:string[]} $meta
     * @return array{0:string,1:?string} [status, error]
     */
    public static function email(array $to, string $subject, string $body, array $meta = []): array
    {
        $to = array_values(array_unique(array_filter(array_map('trim', $to), fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL))));
        $cc = array_values(array_filter(array_map('trim', $meta['cc'] ?? []), fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));
        if (!$to) return ['failed', 'No valid email address'];

        $provider = null;
        $providerId = null;
        if (Brevo::connected() && Settings::bool('brevo_emails', true)) {
            $provider = 'brevo';
            [$ok, $data] = Brevo::email($to, $subject, $body, $cc);
            [$status, $error] = $ok ? ['sent', null] : ['failed', (string) $data];
            if ($ok) $providerId = $data['messageId'] ?? null;
        } elseif (config('mail.enabled', false)) {
            $provider = 'php';
            $headers = 'From: ' . config('mail.from', 'no-reply@example.com') . "\r\nContent-Type: text/plain; charset=utf-8";
            if ($cc) $headers .= "\r\nCc: " . implode(', ', $cc);
            $ok = @mail(implode(', ', $to), '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
            [$status, $error] = $ok ? ['sent', null] : ['failed', 'mail() failed; check SMTP settings in php.ini'];
        } else {
            [$status, $error] = ['not_sent', 'No email service is connected'];
        }
        self::log('email', $meta, implode(', ', $to), $subject, $body, $status, $error, $provider, $providerId, $cc);
        return [$status, $error];
    }

    /** @return array{0:string,1:?string} */
    public static function sms(array $numbers, string $text, array $meta = []): array
    {
        return self::phones('sms', $numbers, $text, $meta, fn($n) => Brevo::sms($n, $text));
    }

    /** @return array{0:string,1:?string} */
    public static function whatsapp(array $numbers, string $text, ?int $templateId, array $meta = []): array
    {
        return self::phones('whatsapp', $numbers, $text, $meta, fn($n) => Brevo::whatsapp($n, $text, $templateId));
    }

    /** Digits only, with the country code (default from settings, 91 for India). */
    public static function phone(?string $raw): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) $raw);
        if ($digits === '') return null;
        $digits = ltrim($digits, '0');
        if (strlen($digits) === 10) $digits = Settings::get('default_country_code', '91') . $digits;
        return strlen($digits) >= 11 && strlen($digits) <= 15 ? $digits : null;
    }

    private static function phones(string $channel, array $numbers, string $text, array $meta, callable $send): array
    {
        $numbers = array_values(array_unique(array_filter(array_map([self::class, 'phone'], $numbers))));
        if (!$numbers) return ['failed', 'No valid phone number'];
        if (!Brevo::connected()) {
            self::log($channel, $meta, implode(', ', $numbers), '', $text, 'not_sent', 'Brevo is not connected', null, null);
            return ['not_sent', 'Brevo is not connected'];
        }
        $errors = [];
        foreach ($numbers as $n) {
            [$ok, $data] = $send($n);
            if (!$ok) $errors[] = (string) $data;
            self::log($channel, $meta, $n, '', $text, $ok ? 'sent' : 'failed', $ok ? null : (string) $data, 'brevo', $ok ? (string) ($data['messageId'] ?? $data['reference'] ?? '') : null);
        }
        return $errors ? ['failed', $errors[0]] : ['sent', null];
    }

    private static function log(string $channel, array $meta, string $to, string $subject, string $body, string $status, ?string $error, ?string $provider, $providerId, array $cc = []): void
    {
        // Invite and password-reset links let anyone set that person's password, so they are never kept in the log.
        $body = preg_replace('#/join/[0-9a-f]{16,}#i', '/join/[private link hidden]', $body);
        Db::insert('email_outbox', [
            'channel' => $channel, 'kind' => $meta['kind'] ?? 'app', 'run_id' => $meta['run_id'] ?? null, 'brand_id' => $meta['brand_id'] ?? null,
            'to_email' => mb_substr($to, 0, 500), 'cc' => $cc ? mb_substr(implode(', ', $cc), 0, 500) : null,
            'subject' => mb_substr($subject, 0, 255), 'body' => $body, 'status' => $status,
            'error' => $error ? mb_substr($error, 0, 500) : null, 'provider' => $provider, 'provider_id' => $providerId ? mb_substr((string) $providerId, 0, 120) : null,
        ]);
    }
}
