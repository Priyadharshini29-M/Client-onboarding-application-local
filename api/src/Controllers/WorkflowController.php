<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Workflows;

/** Workflows: build them (steps + triggers), run them for clients, and follow each run. */
class WorkflowController
{
    private static function requireManager(Request $r): void
    {
        if (!Auth::isAdmin($r->user) && $r->user['role'] !== 'project_manager') {
            throw HttpException::forbidden('Only admins and project managers can change workflows.');
        }
    }

    // ---------------------------------------------------------------- workflows

    public static function index(Request $r): array
    {
        return array_map(function ($w) {
            $w['is_live'] = (bool) $w['is_live'];
            $w['triggers'] = array_map([Workflows::class, 'describe'], Db::all('SELECT * FROM workflow_triggers WHERE workflow_id = ? AND is_active = 1', [$w['id']]));
            return $w;
        }, Db::all(
            "SELECT w.id, w.name, w.description, w.is_live, w.updated_at,
                    (SELECT COUNT(*) FROM workflow_steps s WHERE s.workflow_id = w.id) AS step_count,
                    (SELECT GROUP_CONCAT(s.type ORDER BY s.pos_y, s.pos_x SEPARATOR ',') FROM workflow_steps s WHERE s.workflow_id = w.id) AS step_types,
                    (SELECT COUNT(*) FROM workflow_runs x WHERE x.workflow_id = w.id AND x.status IN ('running','waiting')) AS active_runs,
                    (SELECT COUNT(*) FROM workflow_runs x WHERE x.workflow_id = w.id) AS total_runs,
                    (SELECT MAX(x.started_at) FROM workflow_runs x WHERE x.workflow_id = w.id) AS last_run_at
             FROM workflows w ORDER BY w.is_live DESC, w.name"
        ));
    }

    public static function show(Request $r): array
    {
        return self::workflow((int) $r->param('id'));
    }

    public static function store(Request $r): array
    {
        self::requireManager($r);
        $data = Validator::validate($r->body, ['name' => 'required,max:160', 'description' => 'max:255']);
        $id = Db::insert('workflows', $data + ['created_by' => $r->user['id']]);
        return self::workflow($id);
    }

    public static function update(Request $r): array
    {
        self::requireManager($r);
        $id = (int) $r->param('id');
        $wf = self::workflow($id);
        $data = Validator::validate($r->body, ['name' => 'required,max:160', 'description' => 'max:255', 'is_live' => 'bool'], true);
        if (!empty($data['is_live']) && !$wf['steps']) throw HttpException::validation(['is_live' => 'Add at least one step before turning it on.']);
        if ($data) Db::update('workflows', $id, $data);
        return self::workflow($id);
    }

    public static function destroy(Request $r): void
    {
        self::requireManager($r);
        $id = (int) $r->param('id');
        $runs = (int) Db::value('SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = ?', [$id]);
        if ($runs) throw new HttpException(409, "This workflow has run $runs times, so it is kept for the record. Turn it off instead.");
        Db::exec('DELETE FROM workflows WHERE id = ?', [$id]);
    }

    /**
     * Body: {nodes: [{id?, key, type, title, config, x, y}], edges: [{from: key|'start', to: key, branch}]}.
     * Saves the whole canvas. Returns the workflow and key_map {key: id} for new cards.
     */
    public static function saveGraph(Request $r): array
    {
        self::requireManager($r);
        $id = (int) $r->param('id');
        self::workflow($id);
        $nodes = $r->body['nodes'] ?? null;
        $edges = $r->body['edges'] ?? [];
        if (!is_array($nodes) || !is_array($edges)) throw HttpException::validation(['nodes' => 'Send the cards and arrows as lists.']);
        if (count($nodes) > 80) throw HttpException::validation(['nodes' => 'Keep it under 80 cards.']);

        $clean = [];
        foreach (array_values($nodes) as $i => $n) {
            $type = (string) ($n['type'] ?? '');
            if (!in_array($type, Workflows::STEP_TYPES, true)) throw HttpException::validation(['nodes' => 'Card ' . ($i + 1) . ' has an unknown type.']);
            $title = trim((string) ($n['title'] ?? ''));
            if ($title === '') throw HttpException::validation(['nodes' => 'Every card needs a name.']);
            $key = (string) ($n['key'] ?? $n['id'] ?? '');
            if ($key === '') throw HttpException::validation(['nodes' => 'Card ' . ($i + 1) . ' has no key.']);
            $clean[$key] = [
                'id' => (int) ($n['id'] ?? 0), 'type' => $type, 'title' => mb_substr($title, 0, 200),
                'config' => self::cleanConfig($type, (array) ($n['config'] ?? []), $title),
                'pos_x' => (int) round((float) ($n['x'] ?? 0)), 'pos_y' => (int) round((float) ($n['y'] ?? 0)),
            ];
        }

        $startX = (int) round((float) ($r->body['start']['x'] ?? 160));
        $startY = (int) round((float) ($r->body['start']['y'] ?? 0));
        $map = Db::transaction(function () use ($id, $clean, $edges, $startX, $startY) {
            $map = [];
            foreach ($clean as $key => $s) {
                $row = ['type' => $s['type'], 'title' => $s['title'], 'config' => json_encode($s['config'], JSON_UNESCAPED_UNICODE), 'pos_x' => $s['pos_x'], 'pos_y' => $s['pos_y']];
                if ($s['id'] && Db::value('SELECT id FROM workflow_steps WHERE id = ? AND workflow_id = ?', [$s['id'], $id])) {
                    Db::update('workflow_steps', $s['id'], $row);
                    $map[$key] = $s['id'];
                } else {
                    $map[$key] = Db::insert('workflow_steps', $row + ['workflow_id' => $id, 'position' => 0]);
                }
            }
            $keep = $map ? array_values($map) : [0];
            Db::exec('DELETE FROM workflow_steps WHERE workflow_id = ? AND id NOT IN (' . implode(',', array_map('intval', $keep)) . ')', [$id]);

            Db::exec('DELETE FROM workflow_edges WHERE workflow_id = ?', [$id]);
            $seen = [];
            foreach ($edges as $e) {
                $from = (string) ($e['from'] ?? '');
                $to = (string) ($e['to'] ?? '');
                $branch = (string) ($e['branch'] ?? 'next');
                if (!in_array($branch, ['next', 'yes', 'no'], true)) $branch = 'next';
                if (!isset($map[$to]) || ($from !== 'start' && !isset($map[$from])) || $from === $to) continue;
                $fromId = $from === 'start' ? null : $map[$from];
                if ($fromId && $clean[$from]['type'] !== 'condition') $branch = 'next';
                if ($fromId && $clean[$from]['type'] === 'condition' && $branch === 'next') $branch = 'yes';
                $sig = ($fromId ?? 's') . '-' . $map[$to] . '-' . $branch;
                if (isset($seen[$sig])) continue;
                $seen[$sig] = true;
                Db::insert('workflow_edges', ['workflow_id' => $id, 'from_step_id' => $fromId, 'to_step_id' => $map[$to], 'branch' => $branch]);
            }
            Db::exec('UPDATE workflows SET updated_at = NOW(), start_x = ?, start_y = ? WHERE id = ?', [$startX, $startY, $id]);
            return $map;
        });
        return self::workflow($id) + ['key_map' => (object) $map];
    }

    // ---------------------------------------------------------------- triggers

    public static function addTrigger(Request $r): array
    {
        self::requireManager($r);
        $id = (int) $r->param('id');
        self::workflow($id);
        // Start counting from now, so a new schedule waits for its next date instead of firing for one that has passed.
        Db::insert('workflow_triggers', self::triggerData($r->body) + ['workflow_id' => $id, 'last_fired_at' => date('Y-m-d H:i:s')]);
        return self::workflow($id);
    }

    public static function updateTrigger(Request $r): array
    {
        self::requireManager($r);
        $t = Db::one('SELECT * FROM workflow_triggers WHERE id = ?', [$r->param('id')]);
        if (!$t) throw HttpException::notFound('Trigger');
        Db::update('workflow_triggers', (int) $t['id'], self::triggerData($r->body + $t));
        return self::workflow((int) $t['workflow_id']);
    }

    public static function deleteTrigger(Request $r): array
    {
        self::requireManager($r);
        $t = Db::one('SELECT * FROM workflow_triggers WHERE id = ?', [$r->param('id')]);
        if (!$t) throw HttpException::notFound('Trigger');
        Db::exec('DELETE FROM workflow_triggers WHERE id = ?', [$t['id']]);
        return self::workflow((int) $t['workflow_id']);
    }

    // ---------------------------------------------------------------- runs

    /** Body: {client_ids: [..], period?}. Starts the workflow now for each client. */
    public static function runNow(Request $r): array
    {
        self::requireManager($r);
        $id = (int) $r->param('id');
        $wf = self::workflow($id);
        if (!$wf['steps']) throw HttpException::validation(['client_ids' => 'Add steps before running this workflow.']);
        $ids = array_values(array_unique(array_map('intval', (array) ($r->body['client_ids'] ?? []))));
        if (!$ids) throw HttpException::validation(['client_ids' => 'Choose at least one client.']);
        $period = trim((string) ($r->body['period'] ?? '')) ?: null;
        if ($period !== null && mb_strlen($period) > 20) throw HttpException::validation(['period' => 'Keep the period short, e.g. 2026-10.']);

        $started = [];
        $skipped = [];
        foreach ($ids as $cid) {
            $name = Db::value('SELECT name FROM brands WHERE id = ?', [$cid]);
            if (!$name) continue;
            $run = Workflows::start($id, $cid, (int) $r->user['id'], null, $period);
            Workflows::flush();
            if ($run) $started[] = $name; else $skipped[] = $name;
        }
        return ['started' => $started, 'skipped' => $skipped];
    }

    public static function runs(Request $r): array
    {
        $where = [];
        $params = [];
        if (!empty($r->query['workflow_id'])) { $where[] = 'r.workflow_id = ?'; $params[] = (int) $r->query['workflow_id']; }
        if (!empty($r->query['client_id'])) { $where[] = 'r.brand_id = ?'; $params[] = (int) $r->query['client_id']; }
        $status = $r->query['status'] ?? '';
        if ($status === 'active') $where[] = "r.status IN ('running','waiting')";
        elseif ($status === 'finished') $where[] = "r.status IN ('done','stopped','failed')";
        return array_map([self::class, 'shapeRun'], Db::all(
            'SELECT r.*, w.name AS workflow_name, b.name AS client_name, u.name AS started_by_name,
                    (SELECT COUNT(*) FROM workflow_steps s WHERE s.workflow_id = r.workflow_id) AS step_count,
                    (SELECT COUNT(*) FROM workflow_run_nodes n WHERE n.run_id = r.id AND n.status IN (\'done\',\'skipped\')) AS done_count,
                    (SELECT GROUP_CONCAT(s.title ORDER BY n.id SEPARATOR \' · \') FROM workflow_run_nodes n JOIN workflow_steps s ON s.id = n.step_id WHERE n.run_id = r.id AND n.status = \'active\') AS current_title,
                    (SELECT s.type FROM workflow_run_nodes n JOIN workflow_steps s ON s.id = n.step_id WHERE n.run_id = r.id AND n.status = \'active\' ORDER BY n.id LIMIT 1) AS current_type
             FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id JOIN brands b ON b.id = r.brand_id
             LEFT JOIN users u ON u.id = r.started_by'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY r.id DESC LIMIT 300',
            $params
        ));
    }

    public static function showRun(Request $r): array
    {
        $run = Db::one(
            'SELECT r.*, w.name AS workflow_name, b.name AS client_name, u.name AS started_by_name,
                    (SELECT COUNT(*) FROM workflow_steps s WHERE s.workflow_id = r.workflow_id) AS step_count,
                    (SELECT COUNT(*) FROM workflow_run_nodes n WHERE n.run_id = r.id AND n.status IN (\'done\',\'skipped\')) AS done_count,
                    NULL AS current_title, NULL AS current_type
             FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id JOIN brands b ON b.id = r.brand_id
             LEFT JOIN users u ON u.id = r.started_by WHERE r.id = ?',
            [$r->param('id')]
        );
        if (!$run) throw HttpException::notFound('Run');
        $run = self::shapeRun($run);
        $states = [];
        foreach (Db::all('SELECT step_id, status, waiting_for, wait_until FROM workflow_run_nodes WHERE run_id = ?', [$run['id']]) as $n) $states[(int) $n['step_id']] = $n;
        $run['steps'] = array_map(fn($s) => [
            'id' => (int) $s['id'], 'type' => $s['type'], 'title' => $s['title'], 'x' => (int) $s['pos_x'], 'y' => (int) $s['pos_y'],
            'state' => $states[(int) $s['id']]['status'] ?? 'not_reached', 'waiting_for' => $states[(int) $s['id']]['waiting_for'] ?? null, 'wait_until' => $states[(int) $s['id']]['wait_until'] ?? null,
        ], Workflows::steps((int) $run['workflow_id']));
        $run['edges'] = array_map(fn($e) => ['from' => $e['from_step_id'] === null ? 'start' : (string) $e['from_step_id'], 'to' => (string) $e['to_step_id'], 'branch' => $e['branch']],
            Db::all('SELECT * FROM workflow_edges WHERE workflow_id = ? ORDER BY id', [$run['workflow_id']]));
        $run['log'] = Db::all('SELECT id, step_title, type, status, message, created_at FROM workflow_run_logs WHERE run_id = ? ORDER BY id', [$run['id']]);
        $run['tasks'] = $run['project_id'] ? Db::all(
            'SELECT d.id, d.title, d.status, d.due_date, u.name AS assignee_name, t.name AS team_name, t.icon AS team_icon
             FROM deliverables d JOIN project_stages s ON s.id = d.stage_id LEFT JOIN users u ON u.id = d.assignee_id LEFT JOIN teams t ON t.id = s.team_id
             WHERE d.project_id = ? ORDER BY s.position',
            [$run['project_id']]
        ) : [];
        return $run;
    }

    public static function stopRun(Request $r): array
    {
        self::requireManager($r);
        Workflows::stop((int) $r->param('id'), (int) $r->user['id']);
        return self::showRun($r);
    }

    /** "Check now": fire due schedules and finished waits right away. */
    public static function tick(Request $r): array
    {
        self::requireManager($r);
        return Workflows::tick();
    }

    public static function meta(Request $r): array
    {
        return [
            'events' => array_map(fn($k, $v) => ['key' => $k, 'label' => $v], array_keys(Workflows::EVENTS), Workflows::EVENTS),
            'teams' => Db::all('SELECT id, name, icon FROM teams ORDER BY position, name'),
            'people' => Db::all('SELECT id, name, role, team_id FROM users WHERE is_active = 1 ORDER BY name'),
            'formats' => Db::all('SELECT id, name, kind FROM asset_formats WHERE is_active = 1 ORDER BY position, name'),
            'workflows' => Db::all('SELECT id, name FROM workflows ORDER BY name'),
            'clients' => Db::all('SELECT id, name, brand_type, status FROM brands ORDER BY name'),
            'mail_enabled' => (bool) config('mail.enabled', false) || \App\Services\Brevo::connected(),
            'brevo' => \App\Services\Brevo::connected(),
        ];
    }

    public static function outbox(Request $r): array
    {
        self::requireManager($r);
        return Db::all(
            'SELECT e.id, e.channel, e.kind, e.provider, e.to_email, e.cc, e.subject, e.body, e.status, e.error, e.created_at, b.name AS client_name, w.name AS workflow_name
             FROM email_outbox e LEFT JOIN brands b ON b.id = e.brand_id LEFT JOIN workflow_runs r ON r.id = e.run_id LEFT JOIN workflows w ON w.id = r.workflow_id
             ORDER BY e.id DESC LIMIT 200'
        );
    }

    // ---------------------------------------------------------------- notifications

    public static function notifications(Request $r): array
    {
        $uid = (int) $r->user['id'];
        return [
            'unread' => (int) Db::value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', [$uid]),
            'items' => Db::all('SELECT id, title, body, link, type, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', [$uid]),
        ];
    }

    /** With an `ids` list in the body, marks just those as read; otherwise marks everything unread. */
    public static function readNotifications(Request $r): array
    {
        $ids = array_values(array_filter(array_map('intval', (array) ($r->body['ids'] ?? []))));
        if ($ids) {
            $ph = implode(',', array_fill(0, count($ids), '?'));
            Db::exec("UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND id IN ($ph)", [$r->user['id'], ...$ids]);
        } else {
            Db::exec('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [$r->user['id']]);
        }
        return self::notifications($r);
    }

    // ---------------------------------------------------------------- helpers

    private static function workflow(int $id): array
    {
        $w = Db::one('SELECT * FROM workflows WHERE id = ?', [$id]);
        if (!$w) throw HttpException::notFound('Workflow');
        $w['is_live'] = (bool) $w['is_live'];
        $w['start'] = ['x' => (int) $w['start_x'], 'y' => (int) $w['start_y']];
        $w['steps'] = array_map(fn($s) => ['id' => (int) $s['id'], 'type' => $s['type'], 'title' => $s['title'], 'config' => (object) $s['config'], 'x' => (int) $s['pos_x'], 'y' => (int) $s['pos_y']], Workflows::steps($id));
        $w['edges'] = array_map(fn($e) => ['id' => (int) $e['id'], 'from' => $e['from_step_id'] === null ? 'start' : (string) $e['from_step_id'], 'to' => (string) $e['to_step_id'], 'branch' => $e['branch']],
            Db::all('SELECT * FROM workflow_edges WHERE workflow_id = ? ORDER BY id', [$id]));
        $w['triggers'] = array_map(function ($t) {
            $t['is_active'] = (bool) $t['is_active'];
            $t['summary'] = Workflows::describe($t);
            return $t;
        }, Db::all('SELECT * FROM workflow_triggers WHERE workflow_id = ? ORDER BY id', [$id]));
        $w['active_runs'] = (int) Db::value("SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = ? AND status IN ('running','waiting')", [$id]);
        return $w;
    }

    public static function shapeRun(array $r): array
    {
        foreach (['id', 'workflow_id', 'brand_id', 'done_count', 'step_count', 'project_id'] as $k) if (isset($r[$k])) $r[$k] = (int) $r[$k];
        return $r;
    }

    /** Only the settings each card type understands. */
    private static function cleanConfig(string $type, array $c, string $label): array
    {
        $str = fn($k, $max = 2000) => isset($c[$k]) ? mb_substr(trim((string) $c[$k]), 0, $max) : '';
        $int = fn($k) => isset($c[$k]) && $c[$k] !== '' && $c[$k] !== null ? (int) $c[$k] : null;
        $roles = ['super_admin', 'admin', 'creative_head', 'project_manager', 'tech_lead', 'member'];
        $onFail = ($c['on_fail'] ?? '') === 'stop' ? 'stop' : 'continue';
        $common = ['join' => ($c['join'] ?? '') === 'all' ? 'all' : 'any'];
        switch ($type) {
            case 'task':
                return $common + [
                    'team_id' => $int('team_id'), 'assignee' => in_array($c['assignee'] ?? 'client_lead', ['client_lead', 'least_busy', 'person', ''], true) ? ($c['assignee'] ?? 'client_lead') : 'client_lead',
                    'assignee_id' => $int('assignee_id'), 'due_days' => max(0, min(365, (int) ($c['due_days'] ?? 3))), 'description' => $str('description'),
                    'asset_format_id' => $int('asset_format_id'), 'priority' => in_array($c['priority'] ?? '', ['low', 'medium', 'high', 'urgent'], true) ? $c['priority'] : 'medium',
                ];
            case 'approval':
                return $common + ['approver_role' => in_array($c['approver_role'] ?? '', $roles, true) ? $c['approver_role'] : 'project_manager'];
            case 'notify':
                return $common + ['to' => in_array($c['to'] ?? '', ['team', 'role', 'client_lead', 'person'], true) ? $c['to'] : 'team',
                        'team_id' => $int('team_id'), 'role' => in_array($c['role'] ?? '', $roles, true) ? $c['role'] : null, 'user_id' => $int('user_id'),
                        'message' => $str('message', 1000), 'also_email' => !empty($c['also_email'])];
            case 'email':
                $to = in_array($c['to'] ?? '', ['team', 'role', 'client_lead', 'person', 'custom'], true) ? $c['to'] : 'team';
                if ($to === 'custom' && $str('emails') === '') throw HttpException::validation(['nodes' => "“{$label}”: add at least one email address."]);
                return $common + ['to' => $to, 'team_id' => $int('team_id'), 'role' => in_array($c['role'] ?? '', $roles, true) ? $c['role'] : null, 'user_id' => $int('user_id'),
                        'emails' => $str('emails', 500), 'cc' => $str('cc', 500), 'subject' => $str('subject', 255), 'body' => $str('body', 5000), 'on_fail' => $onFail];
            case 'sms':
            case 'whatsapp':
                $to = in_array($c['to'] ?? '', ['team', 'role', 'client_lead', 'person', 'custom'], true) ? $c['to'] : 'person';
                if ($to === 'custom' && $str('numbers') === '') throw HttpException::validation(['nodes' => "“{$label}”: add at least one phone number."]);
                return $common + ['to' => $to, 'numbers' => $str('numbers', 300), 'team_id' => $int('team_id'),
                        'role' => in_array($c['role'] ?? '', $roles, true) ? $c['role'] : null, 'user_id' => $int('user_id'), 'message' => $str('message', $type === 'sms' ? 640 : 2000),
                        'template_id' => $type === 'whatsapp' ? $int('template_id') : null, 'on_fail' => $onFail];
            case 'api':
                $url = $str('url', 500);
                if ($url !== '' && !preg_match('#^https?://#i', $url)) throw HttpException::validation(['nodes' => "“{$label}”: the URL must start with http:// or https://"]);
                return $common + ['method' => in_array(strtoupper((string) ($c['method'] ?? 'POST')), ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], true) ? strtoupper((string) $c['method']) : 'POST',
                        'url' => $url, 'headers' => $str('headers', 2000), 'body' => $str('body', 5000),
                        'retries' => max(0, min(3, (int) ($c['retries'] ?? 1))), 'on_fail' => $onFail];
            case 'wait':
                return $common + ['amount' => max(0, min(365, (int) ($c['amount'] ?? 1))), 'unit' => in_array($c['unit'] ?? '', ['minutes', 'hours', 'days', 'weeks'], true) ? $c['unit'] : 'days'];
            case 'condition':
                return $common + ['field' => in_array($c['field'] ?? '', ['client.type', 'client.status', 'client.industry', 'client.tags'], true) ? $c['field'] : 'client.type',
                        'op' => in_array($c['op'] ?? '', ['is', 'is_not', 'contains'], true) ? $c['op'] : 'is', 'value' => $str('value', 120)];
            case 'start_workflow':
                return $common + ['workflow_id' => $int('workflow_id')];
        }
        return $common;
    }

    private static function triggerData(array $b): array
    {
        $data = Validator::validate($b, [
            'name' => 'required,max:160', 'type' => 'required,in:schedule|event', 'frequency' => 'in:daily|weekly|monthly|once',
            'weekday' => 'int', 'month_day' => 'int', 'at_time' => 'max:5', 'run_at' => 'max:19', 'event' => 'max:60',
            'client_type' => 'in:ecommerce|lead_gen', 'client_status' => 'in:new|in_progress|on_hold|live|retainer', 'brand_id' => 'int',
            'active_from' => 'date', 'active_until' => 'date', 'is_active' => 'bool',
        ]);
        if ($data['type'] === 'schedule') {
            if (empty($data['frequency'])) throw HttpException::validation(['frequency' => 'Choose how often it runs.']);
            if (!empty($data['at_time']) && !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $data['at_time'])) throw HttpException::validation(['at_time' => 'Use a time like 09:00.']);
            if ($data['frequency'] === 'once' && empty($data['run_at'])) throw HttpException::validation(['run_at' => 'Choose the date and time.']);
            if ($data['frequency'] === 'once' && strtotime($data['run_at']) <= time()) throw HttpException::validation(['run_at' => 'Choose a time in the future.']);
            if ($data['frequency'] === 'monthly' && (($data['month_day'] ?? 1) < 1 || ($data['month_day'] ?? 1) > 28)) throw HttpException::validation(['month_day' => 'Pick a day from 1 to 28.']);
            $data['event'] = null;
            if (!empty($data['run_at'])) $data['run_at'] = date('Y-m-d H:i:s', strtotime($data['run_at']));
        } else {
            if (empty($data['event']) || !isset(Workflows::EVENTS[$data['event']])) throw HttpException::validation(['event' => 'Choose what starts it.']);
            $data['frequency'] = null;
        }
        return $data;
    }
}
