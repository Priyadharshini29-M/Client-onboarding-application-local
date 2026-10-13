<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Activity;
use App\Services\Brevo;
use App\Services\Forms;
use App\Services\Messenger;
use App\Services\Settings;

/** Settings → Integrations (Brevo), and "email this link to the client" actions. */
class IntegrationController
{
    private const FIELDS = [
        'brevo_sender_name' => 'max:80', 'brevo_sender_email' => 'email', 'brevo_sms_sender' => 'max:11',
        'brevo_whatsapp_number' => 'max:20', 'brevo_list_id' => 'int', 'default_country_code' => 'max:4',
        'brevo_emails' => 'bool', 'notify_emails' => 'bool', 'sync_clients' => 'bool',
    ];

    public static function show(Request $r): array
    {
        Auth::requireAdmin($r);
        return self::state();
    }

    public static function save(Request $r): array
    {
        Auth::requireAdmin($r);
        $data = Validator::validate($r->body, self::FIELDS + ['brevo_api_key' => 'max:200'], true);
        if (array_key_exists('brevo_api_key', $data)) {
            $key = trim((string) $data['brevo_api_key']);
            if ($key !== '') {
                [$ok, $res] = Brevo::account($key);
                if (!$ok) throw HttpException::validation(['brevo_api_key' => (string) $res]);
            }
            Settings::set('brevo_api_key', $key ?: null, true);
            unset($data['brevo_api_key']);
        }
        if (isset($data['brevo_sms_sender']) && $data['brevo_sms_sender'] !== null && !preg_match('/^[A-Za-z0-9]{3,11}$/', (string) $data['brevo_sms_sender'])) {
            throw HttpException::validation(['brevo_sms_sender' => 'Use 3 to 11 letters or numbers, no spaces.']);
        }
        foreach ($data as $k => $v) Settings::set($k, $v === null ? null : (string) $v);
        return self::state();
    }

    public static function disconnect(Request $r): array
    {
        Auth::requireAdmin($r);
        Settings::set('brevo_api_key', null, true);
        return self::state();
    }

    /** Sends a test email to the signed-in admin. */
    public static function testEmail(Request $r): array
    {
        Auth::requireAdmin($r);
        [$status, $error] = Messenger::email([$r->user['email']], 'Brand OS test email', "This is a test from Brand OS.\n\nIf you can read this, Brevo is set up correctly.", ['kind' => 'test']);
        if ($status !== 'sent') throw new HttpException(422, $error ?: 'The email was not sent.');
        return ['sent_to' => $r->user['email']];
    }

    public static function syncClients(Request $r): array
    {
        Auth::requireAdmin($r);
        if (!Brevo::connected()) throw new HttpException(422, 'Connect Brevo first.');
        $done = 0;
        $errors = [];
        foreach (Db::all('SELECT * FROM brands ORDER BY name') as $b) {
            [$ok, $res] = Brevo::syncClient($b);
            if ($ok) $done++; else $errors[] = "{$b['name']}: $res";
        }
        return ['synced' => $done, 'errors' => array_slice($errors, 0, 10)];
    }

    private static function state(): array
    {
        $connected = Brevo::connected();
        $account = null;
        $senders = [];
        $lists = [];
        if ($connected) {
            [$ok, $res] = Brevo::account();
            if ($ok) {
                $account = ['email' => $res['email'] ?? null, 'company' => $res['companyName'] ?? null,
                            'plans' => array_map(fn($p) => trim(($p['type'] ?? '') . ' ' . (isset($p['credits']) ? "({$p['credits']} {$p['creditsType']})" : '')), $res['plan'] ?? [])];
                $senders = Brevo::senders();
                $lists = Brevo::lists();
            } else {
                $account = ['error' => (string) $res];
            }
        }
        $key = Settings::get('brevo_api_key');
        return [
            'connected' => $connected,
            'key_hint' => $key ? substr($key, 0, 8) . '…' . substr($key, -4) : null,
            'account' => $account, 'senders' => $senders, 'lists' => $lists,
            'settings' => [
                'brevo_sender_name' => Settings::get('brevo_sender_name', 'Brand OS'),
                'brevo_sender_email' => Settings::get('brevo_sender_email', ''),
                'brevo_sms_sender' => Settings::get('brevo_sms_sender', ''),
                'brevo_whatsapp_number' => Settings::get('brevo_whatsapp_number', ''),
                'brevo_list_id' => Settings::get('brevo_list_id', ''),
                'default_country_code' => Settings::get('default_country_code', '91'),
                'brevo_emails' => Settings::bool('brevo_emails', true),
                'notify_emails' => Settings::bool('notify_emails', true),
                'sync_clients' => Settings::bool('sync_clients', false),
            ],
            'stats' => Db::one("SELECT
                    COUNT(CASE WHEN status = 'sent' AND created_at >= NOW() - INTERVAL 30 DAY THEN 1 END) AS sent_30,
                    COUNT(CASE WHEN status = 'failed' AND created_at >= NOW() - INTERVAL 30 DAY THEN 1 END) AS failed_30,
                    COUNT(CASE WHEN status = 'not_sent' AND created_at >= NOW() - INTERVAL 30 DAY THEN 1 END) AS unsent_30
                FROM email_outbox"),
        ];
    }

    // ---------------------------------------------------------------- email links to a client

    public static function sendFormLink(Request $r): array
    {
        $client = self::client((int) $r->param('id'));
        if (empty($client['email'])) throw HttpException::validation(['email' => "Add {$client['name']}'s email address first."]);
        $sub = Db::one("SELECT * FROM form_submissions WHERE brand_id = ? AND kind = 'intake'", [$client['id']]);
        if (!$sub) throw HttpException::notFound('Intake form');
        if ($sub['status'] === 'submitted') throw new HttpException(409, 'They have already submitted the form.');
        $link = rtrim((string) config('app_url'), '/') . '/fill/' . $sub['token'];
        $name = $client['contact_name'] ?: 'there';
        [$status, $error] = Messenger::email([$client['email']], "Your onboarding form for {$client['name']}",
            "Hi $name,\n\nPlease fill in your onboarding form here. It saves as you go, so you can come back to it:\n$link\n\nThanks!",
            ['kind' => 'form_link', 'brand_id' => (int) $client['id']]);
        if ($sub['status'] === 'not_sent') Db::exec("UPDATE form_submissions SET status = 'sent' WHERE id = ?", [$sub['id']]);
        Activity::log((int) $client['id'], $r->user['id'], 'form.emailed', $status === 'sent' ? "Emailed the form link to {$client['email']}" : 'Tried to email the form link');
        return ['status' => $status, 'error' => $error, 'to' => $client['email']];
    }

    public static function sendDocumentsLink(Request $r): array
    {
        $client = self::client((int) $r->param('id'));
        if (empty($client['email'])) throw HttpException::validation(['email' => "Add {$client['name']}'s email address first."]);
        $pending = Db::all("SELECT name FROM client_documents WHERE brand_id = ? AND status = 'pending' ORDER BY id", [$client['id']]);
        $link = rtrim((string) config('app_url'), '/') . '/documents/' . $client['docs_token'];
        $list = $pending ? "\n\nWe still need:\n" . implode("\n", array_map(fn($d) => '• ' . $d['name'], $pending)) : '';
        $name = $client['contact_name'] ?: 'there';
        [$status, $error] = Messenger::email([$client['email']], "Documents we need from {$client['name']}",
            "Hi $name,\n\nPlease upload your documents here:\n$link$list\n\nThanks!", ['kind' => 'documents_link', 'brand_id' => (int) $client['id']]);
        Activity::log((int) $client['id'], $r->user['id'], 'documents.emailed', $status === 'sent' ? "Emailed the document upload link to {$client['email']}" : 'Tried to email the document link');
        return ['status' => $status, 'error' => $error, 'to' => $client['email']];
    }

    private static function client(int $id): array
    {
        $c = Db::one('SELECT * FROM brands WHERE id = ?', [$id]);
        if (!$c) throw HttpException::notFound('Client');
        return $c;
    }
}
