<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\Request;

/**
 * One approvals inbox for everything that needs a yes: task versions and filled asset formats.
 * view = pending (waiting now), approved (last 30 days), mine (what I submitted).
 */
class ApprovalController
{
    private const TASK_SQL = "
        SELECT 'task' AS type, d.id, d.title, d.kind, p.brand_id AS client_id, b.name AS client_name, s.name AS context,
               s.approver_role, t.name AS team_name, t.icon AS team_icon,
               v.id AS version_id, v.version_no, v.status, v.created_at AS submitted_at, cu.name AS submitted_by, v.created_by AS submitted_by_id, TIMESTAMPDIFF(HOUR, v.created_at, NOW()) AS waited,
               v.decided_at, du.name AS decided_by, v.decision_note AS note, v.note AS change_note,
               (SELECT COUNT(*) FROM deliverables x WHERE x.stage_id = s.id AND x.status = 'approved') AS done,
               (SELECT COUNT(*) FROM deliverables x WHERE x.stage_id = s.id) AS total
        FROM deliverable_versions v
        JOIN deliverables d ON d.id = v.deliverable_id
        JOIN project_stages s ON s.id = d.stage_id
        JOIN projects p ON p.id = d.project_id
        JOIN brands b ON b.id = p.brand_id
        LEFT JOIN teams t ON t.id = s.team_id
        LEFT JOIN users cu ON cu.id = v.created_by
        LEFT JOIN users du ON du.id = v.decided_by";

    // Client intake forms: the client submits them, so there is no version row.
    private const INTAKE_SQL = "
        SELECT 'task' AS type, d.id, d.title, d.kind, p.brand_id AS client_id, b.name AS client_name, s.name AS context,
               s.approver_role, t.name AS team_name, t.icon AS team_icon,
               CONCAT('i', d.id) AS version_id, 0 AS version_no, d.status, d.updated_at AS submitted_at, b.contact_name AS submitted_by,
               NULL AS submitted_by_id, TIMESTAMPDIFF(HOUR, d.updated_at, NOW()) AS waited,
               d.approved_at AS decided_at, ab.name AS decided_by, NULL AS note, NULL AS change_note,
               (SELECT COUNT(*) FROM deliverables x WHERE x.stage_id = s.id AND x.status = 'approved') AS done,
               (SELECT COUNT(*) FROM deliverables x WHERE x.stage_id = s.id) AS total
        FROM deliverables d
        JOIN project_stages s ON s.id = d.stage_id
        JOIN projects p ON p.id = d.project_id
        JOIN brands b ON b.id = p.brand_id
        LEFT JOIN teams t ON t.id = s.team_id
        LEFT JOIN users ab ON ab.id = d.approved_by
        WHERE d.kind = 'intake'";

    private const ASSET_SQL = "
        SELECT 'asset' AS type, e.id, e.title, f.kind, e.brand_id AS client_id, b.name AS client_name, f.name AS context,
               e.status, e.updated_at AS submitted_at, cu.name AS submitted_by, e.created_by AS submitted_by_id, TIMESTAMPDIFF(HOUR, e.updated_at, NOW()) AS waited,
               CASE WHEN e.status = 'waiting' THEN NULL ELSE e.updated_at END AS decided_at, ru.name AS decided_by, e.review_note AS note,
               e.answers, e.format_id
        FROM asset_entries e
        JOIN asset_formats f ON f.id = e.format_id
        JOIN brands b ON b.id = e.brand_id
        LEFT JOIN users cu ON cu.id = e.created_by
        LEFT JOIN users ru ON ru.id = e.reviewed_by";

    public static function index(Request $r): array
    {
        $view = in_array($r->query['view'] ?? '', ['pending', 'approved', 'mine'], true) ? $r->query['view'] : 'pending';
        return self::items($view, $r->user, (string) ($r->query['q'] ?? ''), ($r->query['only_mine'] ?? '') === '1');
    }

    private static function items(string $view, array $user, string $q = '', bool $onlyMine = false): array
    {
        $me = (int) $user['id'];

        if ($view === 'pending') {
            // The latest version of each task waiting in an open stage of an active project.
            $tasks = Db::all(self::TASK_SQL . " WHERE d.status = 'in_review' AND s.status = 'open' AND p.status = 'active'
                AND v.version_no = (SELECT MAX(v2.version_no) FROM deliverable_versions v2 WHERE v2.deliverable_id = d.id) ORDER BY v.created_at");
            $tasks = array_merge($tasks, Db::all(self::INTAKE_SQL . " AND d.status = 'in_review' AND s.status = 'open' AND p.status = 'active'"));
            $assets = Db::all(self::ASSET_SQL . " WHERE e.status = 'waiting' ORDER BY e.updated_at");
        } elseif ($view === 'approved') {
            $tasks = Db::all(self::TASK_SQL . " WHERE v.status = 'approved' AND v.decided_at >= NOW() - INTERVAL 30 DAY ORDER BY v.decided_at DESC LIMIT 200");
            $tasks = array_merge($tasks, Db::all(self::INTAKE_SQL . " AND d.status = 'approved' AND d.approved_at >= NOW() - INTERVAL 30 DAY"));
            $assets = Db::all(self::ASSET_SQL . " WHERE e.status = 'approved' AND e.updated_at >= NOW() - INTERVAL 30 DAY ORDER BY e.updated_at DESC LIMIT 200");
        } else {
            $tasks = Db::all(self::TASK_SQL . " WHERE v.created_by = ? ORDER BY v.created_at DESC LIMIT 200", [$me]);
            $assets = Db::all(self::ASSET_SQL . " WHERE e.created_by = ? ORDER BY e.updated_at DESC LIMIT 200", [$me]);
        }

        $items = array_merge(array_map(fn($t) => self::task($t, $user), $tasks), array_map(fn($a) => self::asset($a, $user), $assets));

        if (trim($q) !== '') {
            $q = mb_strtolower(trim($q));
            $items = array_values(array_filter($items, fn($i) =>
                str_contains(mb_strtolower($i['title'] . ' ' . $i['client_name'] . ' ' . ($i['submitted_by'] ?? '') . ' ' . $i['context']), $q)));
        }
        if ($onlyMine && $view === 'pending') {
            $items = array_values(array_filter($items, fn($i) => $i['can_approve']));
        }
        $key = $view === 'pending' ? 'submitted_at' : ($view === 'approved' ? 'decided_at' : 'submitted_at');
        usort($items, fn($a, $b) => $view === 'pending' ? strcmp((string) $a[$key], (string) $b[$key]) : strcmp((string) $b[$key], (string) $a[$key]));
        return $items;
    }

    /** Numbers for the progress cards at the top of the page. */
    public static function summary(Request $r): array
    {
        $pending = self::items('pending', $r->user);
        $forMe = array_filter($pending, fn($i) => $i['can_approve']);
        $stale = array_filter($pending, fn($i) => $i['waiting_hours'] >= 48);

        $week = "NOW() - INTERVAL 7 DAY";
        $approved = (int) Db::value("SELECT COUNT(*) FROM deliverable_versions WHERE status = 'approved' AND decided_at >= $week")
            + (int) Db::value("SELECT COUNT(*) FROM asset_entries WHERE status = 'approved' AND updated_at >= $week");
        $sentBack = (int) Db::value("SELECT COUNT(*) FROM deliverable_versions WHERE status = 'changes_requested' AND decided_at >= $week")
            + (int) Db::value("SELECT COUNT(*) FROM asset_entries WHERE status = 'needs_changes' AND updated_at >= $week");
        $avg = Db::value("SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, decided_at)) FROM deliverable_versions WHERE decided_at >= NOW() - INTERVAL 30 DAY");

        return [
            'waiting' => count($pending),
            'waiting_for_me' => count($forMe),
            'waiting_long' => count($stale),
            'approved_week' => $approved,
            'sent_back_week' => $sentBack,
            'avg_hours' => $avg === null ? null : round(((float) $avg) / 60, 1),
            'mine_waiting' => (int) Db::value("SELECT COUNT(*) FROM deliverable_versions v JOIN deliverables d ON d.id = v.deliverable_id WHERE v.created_by = ? AND v.status = 'in_review'", [$r->user['id']])
                + (int) Db::value("SELECT COUNT(*) FROM asset_entries WHERE created_by = ? AND status = 'waiting'", [$r->user['id']]),
        ];
    }

    private static function task(array $t, array $user): array
    {
        $status = ['in_review' => 'waiting', 'approved' => 'approved', 'changes_requested' => 'needs_changes'][$t['status']] ?? 'waiting';
        return [
            'type' => 'task', 'key' => "task-{$t['version_id']}", 'id' => (int) $t['id'], 'title' => $t['title'],
            'client_id' => (int) $t['client_id'], 'client_name' => $t['client_name'], 'context' => $t['context'],
            'label' => $t['kind'] === 'intake' ? 'Form' : 'V' . $t['version_no'],
            'team_name' => $t['team_name'], 'team_icon' => $t['team_icon'],
            'approver' => Auth::roleLabel($t['approver_role']), 'can_approve' => Auth::canApprove($user, $t['approver_role']),
            'status' => $status, 'submitted_at' => $t['submitted_at'], 'submitted_by' => $t['submitted_by'],
            'decided_at' => $t['decided_at'], 'decided_by' => $t['decided_by'], 'note' => $t['note'], 'change_note' => $t['change_note'],
            'waiting_hours' => $status === 'waiting' ? max(0, (int) $t['waited']) : null,
            'revision' => $t['kind'] === 'intake' ? null : ['no' => (int) $t['version_no']],
            'progress' => ['done' => (int) $t['done'], 'total' => (int) $t['total'], 'label' => 'tasks approved in this stage'],
        ];
    }

    private static function asset(array $a, array $user): array
    {
        $values = $a['answers'] ? (json_decode($a['answers'], true) ?? []) : [];
        $fields = Db::all('SELECT field_key, type FROM asset_format_fields WHERE format_id = ?', [$a['format_id']]);
        if ($a['kind'] === 'calendar') {
            $progress = ['done' => count($values), 'total' => count($values), 'label' => count($values) === 1 ? 'row' : 'rows'];
        } elseif ($a['kind'] === 'checklist') {
            $items = array_filter($fields, fn($f) => $f['type'] === 'checkbox');
            $progress = ['done' => count(array_filter($items, fn($f) => !empty($values[$f['field_key']]))), 'total' => count($items), 'label' => 'items done'];
        } else {
            $progress = ['done' => count(array_filter($fields, fn($f) => isset($values[$f['field_key']]) && $values[$f['field_key']] !== '' && $values[$f['field_key']] !== false)),
                         'total' => count($fields), 'label' => 'fields answered'];
        }
        return [
            'type' => 'asset', 'key' => "asset-{$a['id']}", 'id' => (int) $a['id'], 'format_id' => (int) $a['format_id'], 'title' => $a['title'],
            'client_id' => (int) $a['client_id'], 'client_name' => $a['client_name'], 'context' => $a['context'],
            'label' => ucfirst($a['kind']), 'kind' => $a['kind'], 'team_name' => null, 'team_icon' => null,
            'approver' => 'Admin or department head', 'can_approve' => $user['role'] !== 'member',
            'status' => $a['status'], 'submitted_at' => $a['submitted_at'], 'submitted_by' => $a['submitted_by'],
            'decided_at' => $a['decided_at'], 'decided_by' => $a['decided_by'], 'note' => $a['note'], 'change_note' => null,
            'waiting_hours' => $a['status'] === 'waiting' ? max(0, (int) $a['waited']) : null,
            'revision' => null, 'progress' => $progress,
        ];
    }
}
