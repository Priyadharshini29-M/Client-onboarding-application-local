<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Forms;

class TemplateController
{
    public static function index(Request $r): array
    {
        return Db::all(
            'SELECT t.id, t.name, t.category, t.description, t.updated_at,
                    (SELECT COUNT(*) FROM template_sections s WHERE s.template_id = t.id) AS section_count,
                    (SELECT COUNT(*) FROM template_fields f JOIN template_sections s ON s.id = f.section_id WHERE s.template_id = t.id) AS field_count,
                    (SELECT COUNT(*) FROM brands b WHERE b.template_id = t.id) AS brand_count
             FROM templates t ORDER BY t.name'
        );
    }

    public static function show(Request $r): array
    {
        return Forms::template($r->param('id'));
    }

    public static function store(Request $r): array
    {
        Auth::requireAdmin($r);
        $data = Validator::validate($r->body, [
            'name' => 'required,max:160', 'category' => 'required,max:60', 'description' => 'max:255',
        ]);
        $data['category'] = self::slug($data['category']);
        $id = Db::insert('templates', $data);
        Db::insert('template_sections', ['template_id' => $id, 'title' => 'About the client', 'position' => 0]);
        return Forms::template($id);
    }

    public static function update(Request $r): array
    {
        Auth::requireAdmin($r);
        $id = $r->param('id');
        self::find($id);
        $data = Validator::validate($r->body, [
            'name' => 'required,max:160', 'category' => 'required,max:60', 'description' => 'max:255',
        ], true);
        if (isset($data['category'])) $data['category'] = self::slug($data['category']);
        Db::update('templates', $id, $data);
        return Forms::template($id);
    }

    public static function destroy(Request $r): void
    {
        Auth::requireAdmin($r);
        $id = $r->param('id');
        self::find($id);
        $inUse = (int) Db::value('SELECT COUNT(*) FROM form_submissions WHERE template_id = ?', [$id]);
        if ($inUse) {
            throw new HttpException(409, "This template has $inUse filled form(s). Keep it, or remove those brands first.");
        }
        Db::exec('DELETE FROM templates WHERE id = ?', [$id]);
    }

    public static function duplicate(Request $r): array
    {
        Auth::requireAdmin($r);
        $src = Forms::template($r->param('id'));
        return Db::transaction(function () use ($src) {
            $id = Db::insert('templates', [
                'name' => $src['name'] . ' (copy)', 'category' => $src['category'], 'description' => $src['description'],
            ]);
            foreach ($src['sections'] as $s) {
                $sid = Db::insert('template_sections', ['template_id' => $id, 'title' => $s['title'], 'position' => $s['position']]);
                foreach ($s['fields'] as $f) {
                    Db::insert('template_fields', [
                        'section_id' => $sid, 'label' => $f['label'], 'type' => $f['type'], 'placeholder' => $f['placeholder'],
                        'options' => $f['options'] ? json_encode($f['options']) : null, 'required' => $f['required'] ? 1 : 0,
                        'position' => $f['position'],
                    ]);
                }
            }
            return Forms::template($id);
        });
    }

    // Sections ------------------------------------------------------------------

    public static function addSection(Request $r): array
    {
        Auth::requireAdmin($r);
        $tid = $r->param('id');
        self::find($tid);
        $data = Validator::validate($r->body, ['title' => 'required,max:160']);
        $pos = (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM template_sections WHERE template_id = ?', [$tid]);
        Db::insert('template_sections', ['template_id' => $tid, 'title' => $data['title'], 'position' => $pos]);
        return Forms::template($tid);
    }

    public static function updateSection(Request $r): array
    {
        Auth::requireAdmin($r);
        $s = self::section($r->param('id'));
        $data = Validator::validate($r->body, ['title' => 'required,max:160']);
        Db::update('template_sections', (int) $s['id'], $data);
        return Forms::template((int) $s['template_id']);
    }

    public static function deleteSection(Request $r): array
    {
        Auth::requireAdmin($r);
        $s = self::section($r->param('id'));
        Db::exec('DELETE FROM template_sections WHERE id = ?', [$s['id']]);
        return Forms::template((int) $s['template_id']);
    }

    public static function moveSection(Request $r): array
    {
        Auth::requireAdmin($r);
        $s = self::section($r->param('id'));
        self::swap('template_sections', 'template_id', (int) $s['template_id'], (int) $s['id'], $r->input('direction') === 'up');
        return Forms::template((int) $s['template_id']);
    }

    // Fields --------------------------------------------------------------------

    public static function addField(Request $r): array
    {
        Auth::requireAdmin($r);
        $s = self::section($r->param('id'));
        $data = self::fieldData($r, false);
        $data['section_id'] = $s['id'];
        $data['position'] = (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM template_fields WHERE section_id = ?', [$s['id']]);
        Db::insert('template_fields', $data);
        return Forms::template((int) $s['template_id']);
    }

    public static function updateField(Request $r): array
    {
        Auth::requireAdmin($r);
        $f = self::field($r->param('id'));
        Db::update('template_fields', (int) $f['id'], self::fieldData($r, true));
        return Forms::template((int) $f['template_id']);
    }

    public static function deleteField(Request $r): array
    {
        Auth::requireAdmin($r);
        $f = self::field($r->param('id'));
        Db::exec('DELETE FROM template_fields WHERE id = ?', [$f['id']]);
        return Forms::template((int) $f['template_id']);
    }

    public static function moveField(Request $r): array
    {
        Auth::requireAdmin($r);
        $f = self::field($r->param('id'));
        self::swap('template_fields', 'section_id', (int) $f['section_id'], (int) $f['id'], $r->input('direction') === 'up');
        return Forms::template((int) $f['template_id']);
    }

    /** Saves a new question order for a part after a drag. Questions can also move in from another part. */
    public static function orderFields(Request $r): array
    {
        Auth::requireAdmin($r);
        $s = self::section($r->param('id'));
        $ids = array_values(array_filter(array_map('intval', (array) $r->input('ids', []))));
        Db::transaction(function () use ($s, $ids) {
            foreach ($ids as $pos => $fid) {
                $ok = Db::value(
                    'SELECT f.id FROM template_fields f JOIN template_sections x ON x.id = f.section_id WHERE f.id = ? AND x.template_id = ?',
                    [$fid, $s['template_id']]
                );
                if ($ok) Db::exec('UPDATE template_fields SET section_id = ?, position = ? WHERE id = ?', [$s['id'], $pos, $fid]);
            }
        });
        return Forms::template((int) $s['template_id']);
    }

    // Helpers -------------------------------------------------------------------

    private static function fieldData(Request $r, bool $partial): array
    {
        $data = Validator::validate($r->body, [
            'label' => 'required,max:255',
            'type' => 'required,in:' . implode('|', Forms::FIELD_TYPES),
            'placeholder' => 'max:255',
            'options' => 'array',
            'required' => 'bool',
        ], $partial);
        if (array_key_exists('options', $data)) {
            $opts = array_values(array_filter(array_map(fn($o) => trim((string) $o), (array) $data['options']), 'strlen'));
            $data['options'] = $opts ? json_encode($opts) : null;
        }
        if (($data['type'] ?? null) === 'select' && empty($data['options']) && !$partial) {
            throw HttpException::validation(['options' => 'Add at least one option for a dropdown.']);
        }
        return $data;
    }

    /** Swap positions with the neighbour above or below. Positions are normalised first. */
    private static function swap(string $table, string $parentCol, int $parentId, int $id, bool $up): void
    {
        Db::transaction(function () use ($table, $parentCol, $parentId, $id, $up) {
            $ids = array_map('intval', array_column(
                Db::all("SELECT id FROM $table WHERE $parentCol = ? ORDER BY position, id", [$parentId]), 'id'
            ));
            $i = array_search($id, $ids, true);
            $j = $up ? $i - 1 : $i + 1;
            if ($i === false || $j < 0 || $j >= count($ids)) return;
            [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
            foreach ($ids as $pos => $rowId) Db::exec("UPDATE $table SET position = ? WHERE id = ?", [$pos, $rowId]);
        });
    }

    private static function slug(string $s): string
    {
        return trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($s)), '_') ?: 'general';
    }

    private static function find(int $id): array
    {
        $t = Db::one('SELECT * FROM templates WHERE id = ?', [$id]);
        if (!$t) throw HttpException::notFound('Template');
        return $t;
    }

    private static function section(int $id): array
    {
        $s = Db::one('SELECT * FROM template_sections WHERE id = ?', [$id]);
        if (!$s) throw HttpException::notFound('Section');
        return $s;
    }

    private static function field(int $id): array
    {
        $f = Db::one(
            'SELECT f.*, s.template_id FROM template_fields f JOIN template_sections s ON s.id = f.section_id WHERE f.id = ?',
            [$id]
        );
        if (!$f) throw HttpException::notFound('Field');
        return $f;
    }
}
