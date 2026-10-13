<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Crypto;
use App\Core\Db;
use App\Core\HttpException;

/** Templates rendered as fillable forms: the client intake and forms attached to tasks. */
class Forms
{
    public const FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'url', 'date', 'number', 'select', 'file', 'secret'];
    private const UPLOAD_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'zip', 'txt'];

    public static function newToken(): string
    {
        return bin2hex(random_bytes(20));
    }

    public static function createSubmission(int $templateId, int $brandId): int
    {
        return Db::insert('form_submissions', [
            'template_id' => $templateId,
            'brand_id' => $brandId,
            'kind' => 'intake',
            'token' => self::newToken(),
            'status' => 'not_sent',
        ]);
    }

    public static function link(string $token): string
    {
        return rtrim((string) config('app_url'), '/') . '/fill/' . $token;
    }

    public static function template(int $templateId): array
    {
        $tpl = Db::one('SELECT id, name, category, description FROM templates WHERE id = ?', [$templateId]);
        if (!$tpl) throw HttpException::notFound('Template');
        $sections = Db::all('SELECT id, title, position FROM template_sections WHERE template_id = ? ORDER BY position, id', [$templateId]);
        $fields = Db::all(
            'SELECT f.id, f.section_id, f.label, f.type, f.placeholder, f.options, f.required, f.position
             FROM template_fields f JOIN template_sections s ON s.id = f.section_id
             WHERE s.template_id = ? ORDER BY f.position, f.id',
            [$templateId]
        );
        $bySection = [];
        foreach ($fields as $f) {
            $f['id'] = (int) $f['id'];
            $f['required'] = (bool) $f['required'];
            $f['options'] = $f['options'] ? (json_decode($f['options'], true) ?: []) : [];
            $bySection[(int) $f['section_id']][] = $f;
        }
        foreach ($sections as &$s) {
            $s['id'] = (int) $s['id'];
            $s['fields'] = $bySection[$s['id']] ?? [];
        }
        $tpl['id'] = (int) $tpl['id'];
        $tpl['sections'] = $sections;
        return $tpl;
    }

    public static function submissionByToken(string $token): array
    {
        $sub = Db::one('SELECT * FROM form_submissions WHERE token = ?', [$token]);
        if (!$sub) throw HttpException::notFound('Form');
        return $sub;
    }

    public static function submissionById(int $id): array
    {
        $sub = Db::one('SELECT * FROM form_submissions WHERE id = ?', [$id]);
        if (!$sub) throw HttpException::notFound('Form');
        return $sub;
    }

    /**
     * @param bool $internal Staff see decrypted secrets. The public form only learns whether a secret is set.
     */
    public static function payload(array $sub, bool $internal): array
    {
        $template = self::template((int) $sub['template_id']);
        $rows = Db::all('SELECT field_id, value FROM form_values WHERE submission_id = ?', [$sub['id']]);
        $types = [];
        foreach ($template['sections'] as $s) foreach ($s['fields'] as $f) $types[$f['id']] = $f['type'];

        $values = [];
        $secretsSet = [];
        foreach ($rows as $r) {
            $fid = (int) $r['field_id'];
            $type = $types[$fid] ?? 'text';
            if ($type === 'secret') {
                $secretsSet[$fid] = $r['value'] !== null && $r['value'] !== '';
                if ($internal) $values[$fid] = Crypto::decrypt($r['value']);
                continue;
            }
            if ($type === 'file') {
                $values[$fid] = $r['value'] ? json_decode($r['value'], true) : null;
                if (!$internal && is_array($values[$fid])) unset($values[$fid]['path']);
                continue;
            }
            $values[$fid] = $r['value'];
        }
        $brand = Db::one('SELECT id, name FROM brands WHERE id = ?', [$sub['brand_id']]);

        $filled = 0;
        $total = 0;
        foreach ($template['sections'] as $s) {
            foreach ($s['fields'] as $f) {
                $total++;
                $v = $values[$f['id']] ?? null;
                if (($f['type'] === 'secret' && !empty($secretsSet[$f['id']])) || ($v !== null && $v !== '')) $filled++;
            }
        }

        return [
            'submission' => [
                'id' => (int) $sub['id'],
                'kind' => $sub['kind'],
                'status' => $sub['status'],
                'submitted_at' => $sub['submitted_at'],
                'updated_at' => $sub['updated_at'],
                'link' => self::link($sub['token']),
                'filled' => $filled,
                'total' => $total,
            ],
            'brand' => $brand,
            'template' => $template,
            'values' => (object) $values,
            'secrets_set' => (object) $secretsSet,
        ];
    }

    /** Saves a partial set of values. An empty secret leaves the stored secret unchanged. */
    public static function saveValues(array $sub, array $values): void
    {
        $template = self::template((int) $sub['template_id']);
        $fields = [];
        foreach ($template['sections'] as $s) foreach ($s['fields'] as $f) $fields[$f['id']] = $f;

        $errors = [];
        Db::transaction(function () use ($sub, $values, $fields, &$errors) {
            foreach ($values as $fieldId => $value) {
                $fid = (int) $fieldId;
                if (!isset($fields[$fid])) continue;
                $field = $fields[$fid];
                if ($field['type'] === 'file') continue; // files go through upload()
                if (is_array($value) || is_object($value)) continue;
                $value = $value === null ? '' : trim((string) $value);

                if ($value !== '') {
                    if ($field['type'] === 'email' && !filter_var($value, FILTER_VALIDATE_EMAIL)) { $errors[$fid] = 'Enter a valid email address.'; continue; }
                    if ($field['type'] === 'url' && !preg_match('#^https?://#i', $value)) { $errors[$fid] = 'Start the link with http:// or https://'; continue; }
                    if ($field['type'] === 'select' && $field['options'] && !in_array($value, $field['options'], true)) { $errors[$fid] = 'Choose one of the options.'; continue; }
                    if (mb_strlen($value) > 20000) { $errors[$fid] = 'This answer is too long.'; continue; }
                }
                if ($field['type'] === 'secret') {
                    if ($value === '') continue;
                    $value = Crypto::encrypt($value);
                }
                Db::exec(
                    'INSERT INTO form_values (submission_id, field_id, value) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE value = VALUES(value)',
                    [$sub['id'], $fid, $value]
                );
            }
            if ($sub['status'] === 'sent' || $sub['status'] === 'not_sent') {
                Db::exec("UPDATE form_submissions SET status = 'in_progress' WHERE id = ? AND status <> 'submitted'", [$sub['id']]);
            } else {
                Db::exec('UPDATE form_submissions SET updated_at = NOW() WHERE id = ?', [$sub['id']]);
            }
        });
        if ($errors) throw HttpException::validation($errors);
    }

    public static function missingRequired(array $sub): array
    {
        $payload = self::payload($sub, true);
        $missing = [];
        foreach ($payload['template']['sections'] as $s) {
            foreach ($s['fields'] as $f) {
                if (!$f['required']) continue;
                $v = $payload['values']->{$f['id']} ?? null;
                if ($v === null || $v === '') $missing[$f['id']] = 'This field is required.';
            }
        }
        return $missing;
    }

    public static function submit(array $sub): void
    {
        $missing = self::missingRequired($sub);
        if ($missing) throw new HttpException(422, 'Please fill in the required fields before submitting.', $missing);
        Db::exec("UPDATE form_submissions SET status = 'submitted', submitted_at = NOW() WHERE id = ?", [$sub['id']]);
    }

    public static function upload(array $sub, int $fieldId, ?array $file): array
    {
        $field = Db::one(
            "SELECT f.id FROM template_fields f JOIN template_sections s ON s.id = f.section_id
             WHERE f.id = ? AND s.template_id = ? AND f.type = 'file'",
            [$fieldId, $sub['template_id']]
        );
        if (!$field) throw HttpException::notFound('Upload field');
        if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new HttpException(422, 'The file did not upload. Please try again.');
        }
        $maxBytes = (int) config('upload_max_mb', 15) * 1024 * 1024;
        if ($file['size'] > $maxBytes) {
            throw new HttpException(422, 'That file is larger than ' . config('upload_max_mb', 15) . ' MB.');
        }
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, self::UPLOAD_EXT, true)) {
            throw new HttpException(422, 'That file type is not allowed. Use PDF, image, Word, Excel, CSV or ZIP.');
        }
        $dir = __DIR__ . '/../../storage/uploads/' . (int) $sub['id'];
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $stored = bin2hex(random_bytes(12)) . '.' . $ext;
        if (!move_uploaded_file($file['tmp_name'], "$dir/$stored")) {
            throw new HttpException(500, 'The file could not be saved on the server.');
        }
        $meta = [
            'name' => mb_substr(basename($file['name']), 0, 200),
            'size' => (int) $file['size'],
            'path' => (int) $sub['id'] . '/' . $stored,
            'uploaded_at' => date('c'),
        ];
        $old = Db::value('SELECT value FROM form_values WHERE submission_id = ? AND field_id = ?', [$sub['id'], $fieldId]);
        Db::exec(
            'INSERT INTO form_values (submission_id, field_id, value) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value)',
            [$sub['id'], $fieldId, json_encode($meta)]
        );
        if ($old && ($oldMeta = json_decode($old, true)) && !empty($oldMeta['path'])) {
            @unlink(__DIR__ . '/../../storage/uploads/' . $oldMeta['path']);
        }
        if (in_array($sub['status'], ['sent', 'not_sent'], true)) {
            Db::exec("UPDATE form_submissions SET status = 'in_progress' WHERE id = ?", [$sub['id']]);
        }
        unset($meta['path']);
        return $meta;
    }

    public static function streamFile(array $sub, int $fieldId): void
    {
        $raw = Db::value('SELECT value FROM form_values WHERE submission_id = ? AND field_id = ?', [$sub['id'], $fieldId]);
        $meta = $raw ? json_decode($raw, true) : null;
        $base = realpath(__DIR__ . '/../../storage/uploads');
        $path = $meta ? realpath($base . '/' . $meta['path']) : false;
        if (!$path || strpos($path, $base) !== 0 || !is_file($path)) throw HttpException::notFound('File');
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $meta['name']) . '"');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }
}
