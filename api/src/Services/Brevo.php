<?php
declare(strict_types=1);

namespace App\Services;

/**
 * Brevo (brevo.com) API: transactional email, SMS, WhatsApp and contacts.
 * The API key and senders are set in Settings → Integrations.
 */
class Brevo
{
    private const BASE = 'https://api.brevo.com/v3';

    public static function key(): ?string
    {
        return Settings::get('brevo_api_key');
    }

    public static function connected(): bool
    {
        return (bool) self::key();
    }

    /** Returns [ok, data|error message, http code]. */
    public static function request(string $method, string $path, ?array $body = null, ?string $key = null): array
    {
        $key = $key ?? self::key();
        if (!$key) return [false, 'Brevo is not connected. Add the API key in Settings → Integrations.', 0];
        $ch = curl_init(self::BASE . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_HTTPHEADER => ['api-key: ' . $key, 'accept: application/json', 'content-type: application/json'],
        ]);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false) return [false, "Could not reach Brevo ($err)", 0];
        $data = $raw === '' ? [] : json_decode($raw, true);
        if ($code >= 200 && $code < 300) return [true, is_array($data) ? $data : [], $code];
        $message = is_array($data) ? ($data['message'] ?? $data['code'] ?? '') : '';
        $hint = match ($code) {
            401 => 'The API key was rejected. Check it in Settings → Integrations.',
            402 => 'Your Brevo plan has no credits for this.',
            403 => 'Brevo does not allow this for your account.',
            default => '',
        };
        return [false, trim("Brevo said $code" . ($message ? ": $message" : '') . ($hint ? ". $hint" : '')), $code];
    }

    public static function account(?string $key = null): array
    {
        return self::request('GET', '/account', null, $key);
    }

    /** @param string[] $to */
    public static function email(array $to, string $subject, string $text, array $cc = []): array
    {
        $senderEmail = Settings::get('brevo_sender_email');
        if (!$senderEmail) return [false, 'Choose a sender email in Settings → Integrations.', 0];
        $payload = [
            'sender' => ['name' => Settings::get('brevo_sender_name', 'Brand OS'), 'email' => $senderEmail],
            'to' => array_map(fn($e) => ['email' => $e], $to),
            'subject' => $subject,
            'textContent' => $text,
            'htmlContent' => self::html($text),
        ];
        if ($cc) $payload['cc'] = array_map(fn($e) => ['email' => $e], $cc);
        return self::request('POST', '/smtp/email', $payload);
    }

    public static function sms(string $number, string $text): array
    {
        $sender = Settings::get('brevo_sms_sender');
        if (!$sender) return [false, 'Add an SMS sender name in Settings → Integrations.', 0];
        return self::request('POST', '/transactionalSMS/sms', [
            'sender' => mb_substr($sender, 0, 11), 'recipient' => $number, 'content' => $text, 'type' => 'transactional',
        ]);
    }

    /** Text works inside a 24-hour conversation; otherwise use an approved template id. */
    public static function whatsapp(string $number, string $text, ?int $templateId = null): array
    {
        $from = Settings::get('brevo_whatsapp_number');
        if (!$from) return [false, 'Add your WhatsApp sender number in Settings → Integrations.', 0];
        $payload = ['senderNumber' => $from, 'contactNumbers' => [$number]];
        if ($templateId) $payload['templateId'] = $templateId; else $payload['text'] = $text;
        return self::request('POST', '/whatsapp/sendMessage', $payload);
    }

    /** Adds or updates a client's contact person in the chosen Brevo list. */
    public static function syncClient(array $brand): array
    {
        if (empty($brand['email'])) return [false, 'This client has no email address', 0];
        $name = trim((string) ($brand['contact_name'] ?? ''));
        [$first, $last] = array_pad(explode(' ', $name, 2), 2, '');
        $body = ['email' => $brand['email'], 'updateEnabled' => true, 'attributes' => array_filter(['FIRSTNAME' => $first, 'LASTNAME' => $last])];
        $list = (int) Settings::get('brevo_list_id', '0');
        if ($list) $body['listIds'] = [$list];
        return self::request('POST', '/contacts', $body);
    }

    public static function lists(): array
    {
        [$ok, $data] = self::request('GET', '/contacts/lists?limit=50&offset=0');
        return $ok ? array_map(fn($l) => ['id' => (int) $l['id'], 'name' => $l['name']], $data['lists'] ?? []) : [];
    }

    public static function senders(): array
    {
        [$ok, $data] = self::request('GET', '/senders');
        return $ok ? array_map(fn($s) => ['name' => $s['name'], 'email' => $s['email'], 'active' => (bool) ($s['active'] ?? true)], $data['senders'] ?? []) : [];
    }

    private static function html(string $text): string
    {
        $safe = nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8'));
        $safe = preg_replace('#(https?://[^\s<]+)#', '<a href="$1">$1</a>', $safe);
        return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1c1c1c">' . $safe . '</div>';
    }
}
