<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Db;

/**
 * Talks to digihrms's REST API so an assigned Brand OS task shows up as a task in HRMS for
 * that person. HRMS pushes status changes back in through POST /webhooks/hrms-task-status
 * (see WebhookController), authenticated by config('hrms.webhook_secret') instead of a user token.
 *
 * Every call here is defensive: until 'hrms.api_url'/'hrms.api_key' are filled in, or whenever
 * HRMS is unreachable, methods quietly do nothing. Brand OS must keep working with HRMS absent.
 */
class Hrms
{
    private static function configured(): bool
    {
        return (string) config('hrms.api_url', '') !== '' && (string) config('hrms.api_key', '') !== '';
    }

    private static function call(string $method, string $endpoint, array $query = [], array $body = []): ?array
    {
        if (!self::configured()) return null;
        $url = rtrim((string) config('hrms.api_url'), '/') . '?' . http_build_query(array_merge(['endpoint' => $endpoint], $query));
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Api-Key: ' . config('hrms.api_key')],
            CURLOPT_POSTFIELDS => $method === 'GET' ? null : json_encode($body),
        ]);
        $raw = curl_exec($ch);
        $failed = curl_errno($ch) !== 0;
        curl_close($ch);
        if ($failed || $raw === false) return null;
        $data = json_decode($raw, true);
        return is_array($data) && !empty($data['success']) ? $data : null;
    }

    /** The HRMS project a brand's tasks land in. Created once (linked via digiops_brand_id) and remembered. */
    private static function ensureProject(int $brandId, string $brandName): ?int
    {
        $existing = Db::value('SELECT hrms_project_id FROM brands WHERE id = ?', [$brandId]);
        if ($existing) return (int) $existing;
        $res = self::call('POST', 'projects', [], ['name' => $brandName, 'digiops_brand_id' => $brandId]);
        $id = $res['data']['id'] ?? null;
        if (!$id) return null;
        Db::update('brands', $brandId, ['hrms_project_id' => (int) $id]);
        return (int) $id;
    }

    /** Looks up the HRMS person by work email. Brand OS and HRMS have separate user tables with no shared id. */
    private static function findUserId(string $email): ?int
    {
        if ($email === '') return null;
        $res = self::call('GET', 'users_search', ['q' => $email]);
        foreach ($res['data'] ?? [] as $row) {
            if (strcasecmp((string) ($row['email'] ?? ''), $email) === 0) return (int) $row['hrms_user_id'];
        }
        return null;
    }

    /**
     * Pushes a deliverable into HRMS as a task: creates it the first time, updates it after.
     * Expects the full row from Projects::deliverable()/Projects::shape() (id, title, brief,
     * assignee_id, due_date, priority, brand_id, brand_name, hrms_task_id).
     */
    public static function syncTask(array $d): void
    {
        if (!self::configured() || empty($d['assignee_id'])) return;
        try {
            $email = (string) Db::value('SELECT email FROM users WHERE id = ?', [$d['assignee_id']]);
            $projectId = self::ensureProject((int) $d['brand_id'], (string) $d['brand_name']);
            if (!$projectId) return;
            $payload = [
                'title' => $d['title'],
                'description' => $d['brief'] ?? '',
                'priority' => strtoupper((string) ($d['priority'] ?? 'medium')),
                'due_date' => $d['due_date'] ?: null,
                'assigned_to' => self::findUserId($email),
                'project_id' => $projectId,
                'brandos_deliverable_id' => (int) $d['id'],
            ];
            if (!empty($d['hrms_task_id'])) {
                self::call('PUT', 'tasks', ['id' => (int) $d['hrms_task_id']], $payload);
            } else {
                $res = self::call('POST', 'tasks', [], $payload);
                $id = $res['data']['id'] ?? null;
                if ($id) Db::update('deliverables', (int) $d['id'], ['hrms_task_id' => (int) $id]);
            }
        } catch (\Throwable $e) {
            // HRMS being slow, down, or misconfigured must never break a Brand OS request.
        }
    }
}
