<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Activity;

/**
 * Asset formats (Shoot Requirements, Content Calendar, SEO checklist...) and the entries the team fills in per client.
 * Admins build formats; everyone can fill them; admins and department heads approve entries.
 */
class AssetFormatController
{
    private const KINDS = 'form|checklist|calendar';
    private const TYPES = 'text|textarea|number|date|select|link|checkbox';

    private const ENTRY_SQL = "
        SELECT e.id, e.format_id, f.name AS format_name, f.kind, e.brand_id, b.name AS brand_name, e.title, e.answers AS `values`,
               e.status, e.review_note, e.created_at, e.updated_at, cu.name AS created_by_name, ru.name AS reviewed_by_name
        FROM asset_entries e
        JOIN asset_formats f ON f.id = e.format_id
        JOIN brands b ON b.id = e.brand_id
        LEFT JOIN users cu ON cu.id = e.created_by
        LEFT JOIN users ru ON ru.id = e.reviewed_by";

    // ---------------------------------------------------------------- formats

    public static function index(Request $r): array
    {
        return Db::all(
            'SELECT f.id, f.name, f.slug, f.kind, f.description, f.is_active,
                    (SELECT COUNT(*) FROM asset_format_fields x WHERE x.format_id = f.id) AS field_count,
                    (SELECT COUNT(*) FROM asset_entries e WHERE e.format_id = f.id) AS entry_count,
                    (SELECT COUNT(*) FROM asset_entries e WHERE e.format_id = f.id AND e.status = \'waiting\') AS waiting_count
             FROM asset_formats f ORDER BY f.position, f.name'
        );
    }

    public static function show(Request $r): array
    {
        return self::format((int) $r->param('id'));
    }

    public static function store(Request $r): array
    {
        Auth::requireAdmin($r);
        $data = Validator::validate($r->body, ['name' => 'required,max:120', 'kind' => 'required,in:' . self::KINDS, 'description' => 'max:255']);
        $slug = self::uniqueSlug($data['name']);
        $id = Db::insert('asset_formats', $data + ['slug' => $slug, 'position' => (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM asset_formats')]);
        return self::format($id);
    }

    public static function update(Request $r): array
    {
        Auth::requireAdmin($r);
        $id = (int) $r->param('id');
        self::format($id);
        $data = Validator::validate($r->body, ['name' => 'required,max:120', 'kind' => 'in:' . self::KINDS, 'description' => 'max:255', 'is_active' => 'bool'], true);
        if ($data) Db::update('asset_formats', $id, $data);
        return self::format($id);
    }

    public static function destroy(Request $r): void
    {
        Auth::requireAdmin($r);
        $id = (int) $r->param('id');
        $f = self::format($id);
        if ($f['entry_count'] > 0) throw new HttpException(409, "This format has been filled {$f['entry_count']} times. Turn it off instead of deleting it.");
        Db::exec('DELETE FROM asset_formats WHERE id = ?', [$id]);
    }

    // ---------------------------------------------------------------- fields

    public static function addField(Request $r): array
    {
        Auth::requireAdmin($r);
        $formatId = (int) $r->param('id');
        self::format($formatId);
        $data = self::fieldData($r->body, false);
        $data['field_key'] = self::uniqueKey($formatId, $data['field_key'] ?? $data['label']);
        Db::insert('asset_format_fields', $data + [
            'format_id' => $formatId,
            'position' => (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM asset_format_fields WHERE format_id = ?', [$formatId]),
        ]);
        return self::format($formatId);
    }

    public static function updateField(Request $r): array
    {
        Auth::requireAdmin($r);
        $field = Db::one('SELECT * FROM asset_format_fields WHERE id = ?', [$r->param('id')]);
        if (!$field) throw HttpException::notFound('Field');
        $data = self::fieldData($r->body, true);
        if (isset($data['field_key'])) $data['field_key'] = self::uniqueKey((int) $field['format_id'], $data['field_key'], (int) $field['id']);
        if ($data) Db::update('asset_format_fields', (int) $field['id'], $data);
        return self::format((int) $field['format_id']);
    }

    public static function deleteField(Request $r): array
    {
        Auth::requireAdmin($r);
        $field = Db::one('SELECT * FROM asset_format_fields WHERE id = ?', [$r->param('id')]);
        if (!$field) throw HttpException::notFound('Field');
        Db::exec('DELETE FROM asset_format_fields WHERE id = ?', [$field['id']]);
        return self::format((int) $field['format_id']);
    }

    /** Body: {ids: [fieldId, ...]} in the new order. */
    public static function orderFields(Request $r): array
    {
        Auth::requireAdmin($r);
        $formatId = (int) $r->param('id');
        $ids = $r->body['ids'] ?? [];
        if (!is_array($ids)) throw HttpException::validation(['ids' => 'Send the field ids in order.']);
        foreach (array_values($ids) as $pos => $fid) {
            Db::exec('UPDATE asset_format_fields SET position = ? WHERE id = ? AND format_id = ?', [$pos, (int) $fid, $formatId]);
        }
        return self::format($formatId);
    }

    // ---------------------------------------------------------------- entries

    public static function entries(Request $r): array
    {
        $where = [];
        $params = [];
        if (!empty($r->query['format_id'])) { $where[] = 'e.format_id = ?'; $params[] = (int) $r->query['format_id']; }
        if (!empty($r->query['client_id'])) { $where[] = 'e.brand_id = ?'; $params[] = (int) $r->query['client_id']; }
        if (!empty($r->query['status'])) { $where[] = 'e.status = ?'; $params[] = (string) $r->query['status']; }
        $rows = Db::all(self::ENTRY_SQL . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY e.updated_at DESC LIMIT 500', $params);
        return array_map([self::class, 'shapeEntry'], $rows);
    }

    public static function showEntry(Request $r): array
    {
        return self::entry((int) $r->param('id'));
    }

    public static function storeEntry(Request $r): array
    {
        $format = self::format((int) $r->param('id'));
        if (!$format['is_active']) throw new HttpException(409, 'This format is turned off.');
        $data = Validator::validate($r->body, ['client_id' => 'required,int', 'title' => 'max:200']);
        $client = Db::one('SELECT id, name FROM brands WHERE id = ?', [$data['client_id']]);
        if (!$client) throw HttpException::validation(['client_id' => 'Choose a client.']);
        $values = self::cleanValues($format, $r->body['values'] ?? null);

        $id = Db::insert('asset_entries', [
            'format_id' => $format['id'],
            'brand_id' => $client['id'],
            'title' => $data['title'] ?: "{$format['name']} · {$client['name']}",
            'answers' => json_encode($values, JSON_UNESCAPED_UNICODE),
            'created_by' => $r->user['id'],
        ]);
        Activity::log((int) $client['id'], $r->user['id'], 'asset_entry.added', "Filled in {$format['name']}");
        return self::entry($id);
    }

    public static function updateEntry(Request $r): array
    {
        $e = self::entry((int) $r->param('id'));
        $format = self::format((int) $e['format_id']);
        $data = Validator::validate($r->body, ['title' => 'max:200'], true);
        $row = [];
        if (!empty($data['title'])) $row['title'] = $data['title'];
        if (array_key_exists('values', $r->body)) {
            $row['answers'] = json_encode(self::cleanValues($format, $r->body['values']), JSON_UNESCAPED_UNICODE);
            // Editing work that was sent back puts it in front of the approver again.
            if ($e['status'] !== 'waiting') { $row['status'] = 'waiting'; $row['review_note'] = null; }
        }
        if ($row) Db::update('asset_entries', (int) $e['id'], $row);
        return self::entry((int) $e['id']);
    }

    /** Body: {status: approved|needs_changes, note}. Admins and department heads only. */
    public static function reviewEntry(Request $r): array
    {
        if ($r->user['role'] === 'member') throw HttpException::forbidden('Only admins and department heads can approve.');
        $e = self::entry((int) $r->param('id'));
        $data = Validator::validate($r->body, ['status' => 'required,in:approved|needs_changes', 'note' => 'max:500']);
        if ($data['status'] === 'needs_changes' && empty($data['note'])) throw HttpException::validation(['note' => 'Say what needs to change.']);
        Db::update('asset_entries', (int) $e['id'], ['status' => $data['status'], 'review_note' => $data['note'] ?? null, 'reviewed_by' => $r->user['id']]);
        Activity::log((int) $e['brand_id'], $r->user['id'], 'asset_entry.' . $data['status'],
            ($data['status'] === 'approved' ? 'Approved ' : 'Sent back ') . $e['title'] . (!empty($data['note']) ? ": {$data['note']}" : ''));
        return self::entry((int) $e['id']);
    }

    public static function deleteEntry(Request $r): void
    {
        $e = self::entry((int) $r->param('id'));
        if ($e['status'] === 'approved' && !Auth::isAdmin($r->user)) throw HttpException::forbidden('Only admins can delete approved work.');
        Db::exec('DELETE FROM asset_entries WHERE id = ?', [$e['id']]);
        Activity::log((int) $e['brand_id'], $r->user['id'], 'asset_entry.removed', "Deleted {$e['title']}");
    }

    // ---------------------------------------------------------------- helpers

    private static function format(int $id): array
    {
        $f = Db::one(
            'SELECT f.*, (SELECT COUNT(*) FROM asset_entries e WHERE e.format_id = f.id) AS entry_count FROM asset_formats f WHERE f.id = ?',
            [$id]
        );
        if (!$f) throw HttpException::notFound('Format');
        $f['is_active'] = (bool) $f['is_active'];
        $f['entry_count'] = (int) $f['entry_count'];
        $f['fields'] = array_map(function ($x) {
            $x['options'] = $x['options'] ? (json_decode($x['options'], true) ?: []) : [];
            $x['required'] = (bool) $x['required'];
            return $x;
        }, Db::all('SELECT id, label, field_key, type, options, placeholder, required, position FROM asset_format_fields WHERE format_id = ? ORDER BY position, id', [$id]));
        return $f;
    }

    private static function entry(int $id): array
    {
        $e = Db::one(self::ENTRY_SQL . ' WHERE e.id = ?', [$id]);
        if (!$e) throw HttpException::notFound('Entry');
        return self::shapeEntry($e);
    }

    public static function shapeEntry(array $e): array
    {
        $e['values'] = $e['values'] ? (json_decode($e['values'], true) ?? []) : [];
        return $e;
    }

    private static function fieldData(array $body, bool $partial): array
    {
        $data = Validator::validate($body, [
            'label' => 'required,max:160',
            'field_key' => 'max:80',
            'type' => ($partial ? '' : 'required,') . 'in:' . self::TYPES,
            'placeholder' => 'max:200',
            'required' => 'bool',
            'options' => 'array',
        ], $partial);
        if (array_key_exists('options', $data)) {
            $opts = array_values(array_unique(array_filter(array_map(fn($o) => trim((string) $o), $data['options'] ?? []), 'strlen')));
            $data['options'] = $opts ? json_encode($opts, JSON_UNESCAPED_UNICODE) : null;
        }
        if (($data['type'] ?? null) === 'select' && empty($data['options']) && !$partial) {
            throw HttpException::validation(['options' => 'Add at least one choice.']);
        }
        if (array_key_exists('field_key', $data) && $data['field_key'] === null) unset($data['field_key']);
        return $data;
    }

    /** Keep only known keys, check required answers and links. Calendars are a list of rows. */
    private static function cleanValues(array $format, $values): array
    {
        $fields = $format['fields'];
        $one = function ($in, string $where = '') use ($fields): array {
            $in = is_array($in) ? $in : [];
            $out = [];
            $errors = [];
            foreach ($fields as $f) {
                $v = $in[$f['field_key']] ?? null;
                if (is_string($v)) $v = trim($v);
                if ($f['type'] === 'checkbox') { $out[$f['field_key']] = (bool) $v; continue; }
                if ($v === null || $v === '') {
                    if ($f['required']) $errors[$f['field_key']] = $where . "{$f['label']} is required.";
                    continue;
                }
                if ($f['type'] === 'link' && !preg_match('#^https?://#i', (string) $v)) $errors[$f['field_key']] = $where . "{$f['label']}: links start with http:// or https://";
                if ($f['type'] === 'number' && !is_numeric($v)) $errors[$f['field_key']] = $where . "{$f['label']} must be a number.";
                if ($f['type'] === 'select' && !in_array($v, $f['options'], true)) $errors[$f['field_key']] = $where . "Choose one of the options for {$f['label']}.";
                $out[$f['field_key']] = is_string($v) ? mb_substr($v, 0, 5000) : $v;
            }
            if ($errors) throw HttpException::validation($errors);
            return $out;
        };

        if ($format['kind'] !== 'calendar') return $one($values);
        $rows = is_array($values) ? array_values($values) : [];
        if (!$rows) throw HttpException::validation(['values' => 'Add at least one row.']);
        if (count($rows) > 200) throw HttpException::validation(['values' => 'Keep it under 200 rows.']);
        return array_map(fn($row, $i) => $one($row, 'Row ' . ($i + 1) . ': '), $rows, array_keys($rows));
    }

    private static function uniqueSlug(string $name): string
    {
        $base = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($name)), '_') ?: 'format';
        $slug = $base;
        for ($n = 2; Db::value('SELECT id FROM asset_formats WHERE slug = ?', [$slug]); $n++) $slug = "{$base}_$n";
        return $slug;
    }

    private static function uniqueKey(int $formatId, string $text, int $exceptId = 0): string
    {
        $base = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($text)), '_') ?: 'field';
        $base = substr($base, 0, 70);
        $key = $base;
        for ($n = 2; Db::value('SELECT id FROM asset_format_fields WHERE format_id = ? AND field_key = ? AND id <> ?', [$formatId, $key, $exceptId]); $n++) $key = "{$base}_$n";
        return $key;
    }
}
