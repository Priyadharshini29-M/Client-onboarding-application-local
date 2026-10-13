<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Activity;
use App\Services\Hrms;
use App\Services\Projects;
use App\Services\Workflows;

class DeliverableController
{
    /** Work lists: everything not yet approved in open stages, filterable by team, person and client. */
    public static function index(Request $r): array
    {
        $where = ["s.status = 'open'", "d.status <> 'approved'"];
        $params = [];
        $q = $r->query;
        if (($q['include_done'] ?? '') === '1') $where = ["s.status <> 'locked'"];
        if (!empty($q['team_id'])) { $where[] = 's.team_id = ?'; $params[] = (int) $q['team_id']; }
        if (!empty($q['client_id'])) { $where[] = 'p.brand_id = ?'; $params[] = (int) $q['client_id']; }
        if (($q['mine'] ?? '') === '1') { $where[] = 'd.assignee_id = ?'; $params[] = $r->user['id']; }
        if (!empty($q['q'])) { $where[] = '(d.title LIKE ? OR b.name LIKE ?)'; $params[] = "%{$q['q']}%"; $params[] = "%{$q['q']}%"; }
        $where[] = "p.status <> 'on_hold'";
        $rows = Db::all(Projects::DELIVERABLE_SQL . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY d.due_date IS NULL, d.due_date, d.id LIMIT 500', $params);
        return array_map([Projects::class, 'shape'], $rows);
    }

    /** Review queue: work waiting for a decision, plus a record of recent decisions. */
    public static function reviews(Request $r): array
    {
        $decided = ($r->query['view'] ?? '') === 'decided';
        if ($decided) {
            return Db::all(
                "SELECT v.id AS version_id, v.version_no, v.status, v.decided_at, v.decision_note, u.name AS decided_by_name,
                        d.id, d.title, d.kind, s.name AS stage_name, b.name AS brand_name, p.brand_id
                 FROM deliverable_versions v JOIN deliverables d ON d.id = v.deliverable_id
                 JOIN project_stages s ON s.id = d.stage_id JOIN projects p ON p.id = d.project_id JOIN brands b ON b.id = p.brand_id
                 LEFT JOIN users u ON u.id = v.decided_by
                 WHERE v.status <> 'in_review' ORDER BY v.decided_at DESC LIMIT 100"
            );
        }
        $rows = Db::all(Projects::DELIVERABLE_SQL . " WHERE d.status = 'in_review' AND s.status = 'open' AND p.status = 'active' ORDER BY d.updated_at");
        $out = [];
        foreach ($rows as $row) {
            $row = Projects::shape($row);
            $row['can_review'] = Auth::canApprove($r->user, $row['approver_role']);
            if (($r->query['mine'] ?? '') === '1' && !$row['can_review']) continue;
            $out[] = $row;
        }
        return $out;
    }

    public static function show(Request $r): array
    {
        $d = Projects::deliverable($r->param('id'));
        $versions = Db::all(
            'SELECT v.*, c.name AS created_by_name, x.name AS decided_by_name FROM deliverable_versions v
             LEFT JOIN users c ON c.id = v.created_by LEFT JOIN users x ON x.id = v.decided_by
             WHERE v.deliverable_id = ? ORDER BY v.version_no DESC',
            [$d['id']]
        );
        $comments = $versions ? Db::all(
            'SELECT c.id, c.version_id, c.body, c.created_at, u.name AS user_name FROM comments c
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.version_id IN (' . implode(',', array_map(fn($v) => (int) $v['id'], $versions)) . ') ORDER BY c.id',
        ) : [];
        foreach ($versions as &$v) {
            unset($v['file_path']);
            $v['comments'] = array_values(array_filter($comments, fn($c) => (int) $c['version_id'] === (int) $v['id']));
        }
        $d['versions'] = $versions;
        $d['can_review'] = Auth::canApprove($r->user, $d['approver_role']);
        if ($d['kind'] === 'intake') {
            $d['intake_status'] = Db::value("SELECT fs.status FROM form_submissions fs WHERE fs.brand_id = ? AND fs.kind = 'intake'", [$d['brand_id']]);
        }
        return $d;
    }

    public static function update(Request $r): array
    {
        $d = Projects::deliverable($r->param('id'));
        $data = Validator::validate($r->body, [
            'title' => 'required,max:200', 'brief' => 'max:5000', 'assignee_id' => 'int', 'due_date' => 'date',
            'status' => 'in:not_started|in_progress', 'priority' => 'in:low|medium|high|urgent', 'tags' => 'array',
        ], true);
        if (array_key_exists('tags', $data)) {
            $tags = array_values(array_unique(array_filter(array_map(fn($t) => mb_substr(strtolower(trim((string) $t)), 0, 40), (array) $data['tags']))));
            $data['tags'] = json_encode($tags);
        }
        if (isset($data['status']) && !in_array($d['status'], ['not_started', 'in_progress'], true)) unset($data['status']);
        if (isset($data['status']) && $d['stage_status'] === 'locked') throw new HttpException(409, 'This stage has not opened yet.');
        Db::update('deliverables', (int) $d['id'], $data);
        if (!empty($data['assignee_id']) && (int) $data['assignee_id'] !== (int) ($d['assignee_id'] ?? 0)) {
            self::notifyAssignee($d, (int) $data['assignee_id'], $data['title'] ?? $d['title']);
        }
        Hrms::syncTask(array_merge($d, $data));
        return self::show($r);
    }

    /** Tells someone a task landed on their desk when an admin assigns or reassigns it by hand. */
    private static function notifyAssignee(array $d, int $userId, string $title): void
    {
        $user = Db::one('SELECT id, name, email FROM users WHERE id = ? AND is_active = 1', [$userId]);
        if (!$user) return;
        $due = $d['due_date'] ? ' · due ' . date('j M', strtotime($d['due_date'])) : '';
        Workflows::notifyUsers(
            [$user],
            'New task assigned: ' . $title,
            $d['brand_name'] . $due,
            '/teams' . (!empty($d['team_id']) ? "/{$d['team_id']}" : ''),
            (int) $d['brand_id'],
            true,
            'task_assigned'
        );
    }

    /** Mark as blocked: who is needed, what kind of help, and what exactly. */
    public static function block(Request $r): array
    {
        $d = Projects::deliverable($r->param('id'));
        if ($d['status'] === 'approved') throw new HttpException(409, 'Approved work cannot be blocked.');
        $data = Validator::validate($r->body, [
            'who' => 'max:60', 'type' => 'required,in:text|document|link|action', 'reason' => 'required,max:2000',
        ]);
        Db::update('deliverables', (int) $d['id'], [
            'blocked' => 1, 'block_who' => $data['who'] ?? null, 'block_type' => $data['type'], 'block_reason' => $data['reason'],
            'block_response' => null, 'blocked_by' => $r->user['id'], 'blocked_at' => date('Y-m-d H:i:s'),
        ]);
        Activity::log((int) $d['brand_id'], $r->user['id'], 'deliverable.blocked', "Flagged {$d['title']} as blocked: {$data['reason']}");
        return self::show($r);
    }

    public static function unblock(Request $r): array
    {
        $d = Projects::deliverable($r->param('id'));
        $data = Validator::validate($r->body, ['response' => 'max:2000']);
        Db::update('deliverables', (int) $d['id'], ['blocked' => 0, 'block_response' => $data['response'] ?? null]);
        Activity::log((int) $d['brand_id'], $r->user['id'], 'deliverable.unblocked', "Unblocked {$d['title']}" . (!empty($data['response']) ? ": {$data['response']}" : ''));
        return self::show($r);
    }

    public static function destroy(Request $r): void
    {
        Auth::requireAdmin($r);
        $d = Projects::deliverable($r->param('id'));
        if ($d['version_count'] > 0) throw new HttpException(409, 'This task has submitted work, so it cannot be deleted.');
        if ($d['kind'] === 'intake') throw new HttpException(409, 'The intake form task cannot be removed.');
        Db::exec('DELETE FROM deliverables WHERE id = ?', [$d['id']]);
    }

    public static function submitVersion(Request $r): array
    {
        $d = Projects::deliverable($r->param('id'));
        Projects::submitVersion(
            $d, $r->user,
            trim((string) $r->input('note', '')) ?: null,
            trim((string) $r->input('link_url', '')) ?: null,
            !empty($_FILES['file']) && $_FILES['file']['error'] !== UPLOAD_ERR_NO_FILE ? $_FILES['file'] : null
        );
        return self::show($r);
    }

    public static function decide(Request $r): array
    {
        $data = Validator::validate($r->body, ['decision' => 'required,in:approved|changes_requested', 'note' => 'max:4000']);
        Projects::decide(Projects::deliverable($r->param('id')), $r->user, $data['decision'], $data['note'] ?? null);
        return self::show($r);
    }

    public static function comment(Request $r): array
    {
        $version = Db::one('SELECT v.*, d.id AS did, p.brand_id FROM deliverable_versions v JOIN deliverables d ON d.id = v.deliverable_id JOIN projects p ON p.id = d.project_id WHERE v.id = ?', [$r->param('id')]);
        if (!$version) throw HttpException::notFound('Version');
        $data = Validator::validate($r->body, ['body' => 'required,max:4000']);
        Db::insert('comments', ['version_id' => $version['id'], 'user_id' => $r->user['id'], 'body' => $data['body']]);
        $r->params['id'] = $version['did'];
        return self::show($r);
    }

    public static function file(Request $r): void
    {
        $v = Db::one('SELECT file_name, file_path FROM deliverable_versions WHERE id = ?', [$r->param('id')]);
        $base = realpath(__DIR__ . '/../../storage/uploads');
        $path = $v && $v['file_path'] ? realpath($base . '/' . $v['file_path']) : false;
        if (!$path || strpos($path, $base) !== 0 || !is_file($path)) throw HttpException::notFound('File');
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $v['file_name']) . '"');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }
}
