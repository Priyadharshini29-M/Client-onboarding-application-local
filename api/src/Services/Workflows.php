<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Auth;
use App\Core\Db;

/**
 * The workflow engine. A workflow is a graph of cards joined by arrows, drawn on the canvas.
 *
 * A run follows the arrows from Start for one client. Cards:
 *   task            creates a task on the Teams board; waits until it is done
 *   approval        placed right after a task: that task then needs this approval before the flow moves on
 *   notify          in-app notification (plus email when turned on) to a department, role, lead or person
 *   email / sms / whatsapp   sent through Brevo (Settings → Integrations)
 *   api             calls a URL, with retries
 *   wait            pauses for hours, days or weeks
 *   condition       follows the Yes or No arrow
 *   start_workflow  starts another workflow for the same client
 *
 * Several cards can be active at once (parallel paths). A card with more than one arrow coming in can wait
 * for all of them ("join"). Each card runs at most once per run, so loops cannot run forever.
 * Each run gets its own project (kind = workflow) so tasks reuse the board, approvals, versions and rework.
 */
class Workflows
{
    public const STEP_TYPES = ['task', 'approval', 'notify', 'email', 'sms', 'whatsapp', 'api', 'wait', 'condition', 'start_workflow'];
    public const EVENTS = [
        'client.added' => 'A client is added',
        'intake.submitted' => 'A client submits their intake form',
        'onboarding.completed' => 'Onboarding is completed',
        'client.retainer' => 'A client moves to retainer',
    ];

    /** Task cards whose task just finished; resumed after the approval is saved. */
    private static array $resume = [];
    private static int $depth = 0;

    // ---------------------------------------------------------------- starting and stopping

    /** Starts a run. Returns the run id, or null when it already ran for this client and period. */
    public static function start(int $workflowId, int $brandId, ?int $userId, ?int $triggerId = null, ?string $period = null): ?int
    {
        $wf = Db::one('SELECT * FROM workflows WHERE id = ?', [$workflowId]);
        $brand = Db::one('SELECT id, name FROM brands WHERE id = ?', [$brandId]);
        if (!$wf || !$brand) return null;
        if ($period && Db::value("SELECT id FROM workflow_runs WHERE workflow_id = ? AND brand_id = ? AND period = ? AND status <> 'stopped'", [$workflowId, $brandId, $period])) {
            return null;
        }
        if (++self::$depth > 10) { self::$depth--; return null; } // workflows that start each other endlessly
        try {
            $runId = Db::insert('workflow_runs', ['workflow_id' => $workflowId, 'brand_id' => $brandId, 'trigger_id' => $triggerId, 'period' => $period, 'started_by' => $userId, 'status' => 'running']);
            $projectId = Db::insert('projects', [
                'brand_id' => $brandId, 'name' => $wf['name'] . ($period ? " · $period" : ''), 'kind' => 'workflow',
                'run_id' => $runId, 'status' => 'active', 'current_stage' => 0, 'owner_id' => $userId,
            ]);
            Db::update('workflow_runs', $runId, ['project_id' => $projectId]);
            self::log($runId, null, 'start', 'info', 'Started' . ($triggerId ? ' by a trigger' : ($userId ? ' by hand' : '')) . ($period ? " for $period" : ''));
            Activity::log($brandId, $userId, 'workflow.started', "Started the {$wf['name']} workflow");

            $entries = Db::all('SELECT to_step_id FROM workflow_edges WHERE workflow_id = ? AND from_step_id IS NULL', [$workflowId]);
            if (!$entries) self::log($runId, null, 'start', 'skipped', 'Nothing is connected to Start');
            self::process($runId, array_map(fn($e) => (int) $e['to_step_id'], $entries));
            return $runId;
        } finally {
            self::$depth--;
        }
    }

    public static function stop(int $runId, ?int $userId): void
    {
        $run = self::run($runId);
        if (!$run || !in_array($run['status'], ['running', 'waiting'], true)) return;
        Db::update('workflow_runs', $runId, ['status' => 'stopped', 'finished_at' => date('Y-m-d H:i:s')]);
        Db::exec("UPDATE workflow_run_nodes SET status = 'skipped', finished_at = NOW() WHERE run_id = ? AND status IN ('active','pending')", [$runId]);
        if ($run['project_id']) Db::exec("UPDATE projects SET status = 'on_hold' WHERE id = ?", [$run['project_id']]);
        self::log($runId, null, 'stop', 'info', 'Stopped by hand');
        Activity::log((int) $run['brand_id'], $userId, 'workflow.stopped', "Stopped the {$run['workflow_name']} workflow");
    }

    // ---------------------------------------------------------------- moving along

    /** Walks the graph from the given cards until everything reachable is running or waiting. */
    private static function process(int $runId, array $queue): void
    {
        for ($guard = 0; $queue && $guard < 500; $guard++) {
            $run = self::run($runId);
            if (!$run || !in_array($run['status'], ['running', 'waiting'], true)) return;
            $stepId = array_shift($queue);
            $step = self::step($stepId);
            if (!$step) continue;

            $node = self::node($runId, $stepId);
            Db::exec('UPDATE workflow_run_nodes SET arrivals = arrivals + 1 WHERE id = ?', [$node['id']]);
            if ($node['status'] !== 'pending') continue; // each card runs once per run

            $incoming = (int) Db::value('SELECT COUNT(*) FROM workflow_edges WHERE to_step_id = ?', [$stepId]);
            if (($step['config']['join'] ?? 'any') === 'all' && $incoming > 1 && (int) $node['arrivals'] + 1 < $incoming) {
                self::log($runId, $step, $step['type'], 'info', 'Waiting for the other paths to arrive (' . ((int) $node['arrivals'] + 1) . " of $incoming)");
                continue;
            }

            Db::exec("UPDATE workflow_run_nodes SET status = 'active', started_at = NOW() WHERE id = ?", [$node['id']]);
            [$outcome, $branch] = self::execute($run, $step, (int) $node['id']);
            if ($outcome === 'wait') continue;
            if ($outcome === 'fail') { self::fail($run, "“{$step['title']}” failed"); return; }
            Db::exec('UPDATE workflow_run_nodes SET status = ?, finished_at = NOW() WHERE id = ?', [$outcome === 'skip' ? 'skipped' : 'done', $node['id']]);
            array_push($queue, ...self::targets($stepId, $branch));
        }
        self::settle($runId);
    }

    /** Called (inside the approval transaction) when a workflow task's stage closes. */
    public static function taskFinished(int $stageId): void
    {
        foreach (Db::all(
            "SELECT n.id FROM workflow_run_nodes n JOIN deliverables d ON d.id = n.deliverable_id
             WHERE d.stage_id = ? AND n.status = 'active' AND n.waiting_for = 'task'", [$stageId]
        ) as $n) self::$resume[] = (int) $n['id'];
    }

    /** Resumes runs queued by taskFinished(). Call after the approval has been saved. */
    public static function flush(): void
    {
        while ($nodeId = array_shift(self::$resume)) {
            $n = Db::one('SELECT * FROM workflow_run_nodes WHERE id = ?', [$nodeId]);
            if (!$n || $n['status'] !== 'active') continue;
            $run = self::run((int) $n['run_id']);
            if (!$run || !in_array($run['status'], ['running', 'waiting'], true)) continue;
            $step = self::step((int) $n['step_id']);
            $d = Db::one('SELECT d.approved_by, u.name AS approver FROM deliverables d LEFT JOIN users u ON u.id = d.approved_by WHERE d.id = ?', [$n['deliverable_id']]);
            Db::exec("UPDATE workflow_run_nodes SET status = 'done', waiting_for = NULL, finished_at = NOW() WHERE id = ?", [$nodeId]);
            self::log((int) $run['id'], $step, 'task', 'done', 'Task finished');

            // An Approval card right after the task is satisfied by the task's approval.
            $next = [];
            foreach (self::targets((int) $step['id'], 'next') as $t) {
                $ts = self::step($t);
                if ($ts && $ts['type'] === 'approval') {
                    $an = self::node((int) $run['id'], $t);
                    Db::exec("UPDATE workflow_run_nodes SET status = 'done', arrivals = arrivals + 1, started_at = NOW(), finished_at = NOW() WHERE id = ?", [$an['id']]);
                    self::log((int) $run['id'], $ts, 'approval', 'done', 'Approved' . (!empty($d['approver']) ? " by {$d['approver']}" : ''));
                    array_push($next, ...self::targets($t, 'next'));
                } else {
                    $next[] = $t;
                }
            }
            Db::update('workflow_runs', (int) $run['id'], ['status' => 'running']);
            self::process((int) $run['id'], $next);
        }
    }

    /** Marks the run done when nothing is active any more, otherwise "waiting". */
    private static function settle(int $runId): void
    {
        $run = self::run($runId);
        if (!$run || !in_array($run['status'], ['running', 'waiting'], true)) return;
        $active = (int) Db::value("SELECT COUNT(*) FROM workflow_run_nodes WHERE run_id = ? AND status = 'active'", [$runId]);
        if ($active > 0) { Db::update('workflow_runs', $runId, ['status' => 'waiting']); return; }
        $stuck = (int) Db::value("SELECT COUNT(*) FROM workflow_run_nodes WHERE run_id = ? AND status = 'pending' AND arrivals > 0", [$runId]);
        if ($stuck) self::log($runId, null, 'end', 'info', "$stuck card(s) waited for paths that never arrived");
        Db::update('workflow_runs', $runId, ['status' => 'done', 'finished_at' => date('Y-m-d H:i:s')]);
        if ($run['project_id']) Db::exec("UPDATE projects SET status = 'completed', completed_at = NOW() WHERE id = ?", [$run['project_id']]);
        self::log($runId, null, 'end', 'info', 'Finished');
        Activity::log((int) $run['brand_id'], null, 'workflow.done', "Finished the {$run['workflow_name']} workflow");
    }

    // ---------------------------------------------------------------- cards

    /** @return array{0:string,1:string} [done|skip|wait|fail, branch to follow] */
    private static function execute(array $run, array $step, int $nodeId): array
    {
        $c = $step['config'];
        $runId = (int) $run['id'];
        $brand = self::brand((int) $run['brand_id']);
        $meta = ['kind' => 'workflow', 'brand_id' => (int) $brand['id'], 'run_id' => $runId];

        try {
            switch ($step['type']) {
                case 'task':
                    $approver = self::approverAfter((int) $step['id']);
                    [$dId, $who] = self::createTask($run, $step, $brand, $approver);
                    Db::exec("UPDATE workflow_run_nodes SET waiting_for = 'task', deliverable_id = ? WHERE id = ?", [$dId, $nodeId]);
                    self::log($runId, $step, 'task', 'waiting', "Assigned to $who. Now waiting for it to be " . ($approver === 'auto' ? 'submitted' : 'approved by the ' . Auth::roleLabel($approver)));
                    return ['wait', 'next'];

                case 'approval':
                    self::log($runId, $step, 'approval', 'skipped', 'An Approval card only works right after a Task card, so it was skipped');
                    return ['skip', 'next'];

                case 'wait':
                    $amount = max(0, (int) ($c['amount'] ?? 1));
                    $unit = in_array($c['unit'] ?? 'days', ['minutes', 'hours', 'days', 'weeks'], true) ? $c['unit'] : 'days';
                    if ($amount === 0) { self::log($runId, $step, 'wait', 'skipped', 'No wait set'); return ['skip', 'next']; }
                    $until = date('Y-m-d H:i:s', strtotime("+$amount $unit"));
                    Db::exec("UPDATE workflow_run_nodes SET waiting_for = 'time', wait_until = ? WHERE id = ?", [$until, $nodeId]);
                    self::log($runId, $step, 'wait', 'waiting', "Waiting $amount $unit, until " . date('j M, g:i a', strtotime($until)));
                    return ['wait', 'next'];

                case 'notify':
                    $users = self::recipients($c, $brand);
                    $title = self::fill($step['title'], $run, $brand);
                    self::notifyUsers($users, $title, self::fill((string) ($c['message'] ?? ''), $run, $brand), "/clients/{$brand['id']}", (int) $brand['id'], !empty($c['also_email']));
                    self::log($runId, $step, 'notify', $users ? 'done' : 'skipped', $users ? 'Notified ' . implode(', ', array_column($users, 'name')) : 'Nobody to notify (' . self::who($c) . ' has no one yet)');
                    return [$users ? 'done' : 'skip', 'next'];

                case 'email':
                    $to = self::emails($c, $brand);
                    if (!$to) { self::log($runId, $step, 'email', 'skipped', 'No email address for ' . self::who($c)); return ['skip', 'next']; }
                    $subject = self::fill((string) (($c['subject'] ?? '') ?: $step['title']), $run, $brand);
                    [$status, $error] = Messenger::email($to, $subject, self::fill((string) ($c['body'] ?? ''), $run, $brand), $meta + ['cc' => array_map('trim', explode(',', (string) ($c['cc'] ?? '')))]);
                    self::log($runId, $step, 'email', $status === 'failed' ? 'failed' : ($status === 'sent' ? 'done' : 'skipped'),
                        ($status === 'sent' ? 'Emailed ' : ($status === 'failed' ? 'Could not email ' : 'Saved, not sent (no email service connected): ')) . implode(', ', $to) . " · “{$subject}”" . ($status === 'failed' && $error ? " ($error)" : ''));
                    return [$status === 'failed' && ($c['on_fail'] ?? 'continue') === 'stop' ? 'fail' : 'done', 'next'];

                case 'sms':
                case 'whatsapp':
                    $numbers = self::numbers($c, $brand);
                    if (!$numbers) { self::log($runId, $step, $step['type'], 'skipped', 'No phone number for ' . self::who($c) . '. Add phone numbers in Settings → People.'); return ['skip', 'next']; }
                    $text = self::fill((string) ($c['message'] ?? ''), $run, $brand);
                    [$status, $error] = $step['type'] === 'sms'
                        ? Messenger::sms($numbers, $text, $meta)
                        : Messenger::whatsapp($numbers, $text, !empty($c['template_id']) ? (int) $c['template_id'] : null, $meta);
                    $label = $step['type'] === 'sms' ? 'SMS' : 'WhatsApp';
                    self::log($runId, $step, $step['type'], $status === 'sent' ? 'done' : ($status === 'failed' ? 'failed' : 'skipped'),
                        ($status === 'sent' ? "Sent $label to " : "$label not sent to ") . implode(', ', $numbers) . ($error ? " ($error)" : ''));
                    return [$status === 'failed' && ($c['on_fail'] ?? 'continue') === 'stop' ? 'fail' : 'done', 'next'];

                case 'api':
                    [$ok, $message] = self::callApi($c, $run, $brand);
                    self::log($runId, $step, 'api', $ok ? 'done' : 'failed', $message);
                    return [!$ok && ($c['on_fail'] ?? 'continue') === 'stop' ? 'fail' : 'done', 'next'];

                case 'condition':
                    $yes = self::matches($c, $brand);
                    self::log($runId, $step, 'condition', 'done', 'Checked if ' . self::conditionText($c) . ': ' . ($yes ? 'yes, took the Yes path' : 'no, took the No path'));
                    return ['done', $yes ? 'yes' : 'no'];

                case 'start_workflow':
                    $target = (int) ($c['workflow_id'] ?? 0);
                    $name = Db::value('SELECT name FROM workflows WHERE id = ?', [$target]);
                    if (!$name || $target === (int) $run['workflow_id']) { self::log($runId, $step, 'start_workflow', 'skipped', 'No other workflow chosen'); return ['skip', 'next']; }
                    $child = self::start($target, (int) $brand['id'], null, null, $run['period'] ?: null);
                    self::log($runId, $step, 'start_workflow', $child ? 'done' : 'skipped', $child ? "Started “{$name}”" : "“{$name}” already ran for this period");
                    return ['done', 'next'];
            }
        } catch (\Throwable $e) {
            self::log($runId, $step, $step['type'], 'failed', 'Error: ' . mb_substr($e->getMessage(), 0, 300));
            return ['fail', 'next'];
        }
        return ['done', 'next'];
    }

    /** The approver role from an Approval card directly after this task, or 'auto' (done when submitted). */
    private static function approverAfter(int $stepId): string
    {
        foreach (self::targets($stepId, 'next') as $t) {
            $s = self::step($t);
            if ($s && $s['type'] === 'approval') return (string) ($s['config']['approver_role'] ?? 'project_manager');
        }
        return 'auto';
    }

    /** @return array{0:int,1:string} [task id, who got it and why] */
    private static function createTask(array $run, array $step, array $brand, string $approver): array
    {
        $c = $step['config'];
        $projectId = (int) $run['project_id'];
        $position = (int) Db::value('SELECT COALESCE(MAX(position), 0) + 1 FROM project_stages WHERE project_id = ?', [$projectId]);
        $due = date('Y-m-d', strtotime('+' . max(0, (int) ($c['due_days'] ?? 3)) . ' days'));
        $stageId = Db::insert('project_stages', [
            'project_id' => $projectId, 'position' => $position, 'name' => self::fill($step['title'], $run, $brand),
            'summary' => mb_substr((string) ($run['workflow_name'] ?? ''), 0, 255) ?: null,
            'team_id' => $c['team_id'] ?? null, 'approver_role' => $approver,
            'status' => 'open', 'opened_at' => date('Y-m-d H:i:s'), 'due_date' => $due,
        ]);
        Db::update('projects', $projectId, ['current_stage' => $position]);
        // Who does it: the client's lead in this department, a named person, or the least busy person in the department.
        // If the client has no lead for this department yet, it falls back to the least busy person so work never sits unassigned.
        $mode = $c['assignee'] ?? 'client_lead';
        $assignee = null;
        $why = '';
        $team = !empty($c['team_id']) ? (string) Db::value('SELECT name FROM teams WHERE id = ?', [$c['team_id']]) : '';
        if ($mode === 'person' && !empty($c['assignee_id'])) {
            $assignee = Db::value('SELECT id FROM users WHERE id = ? AND is_active = 1', [$c['assignee_id']]);
            $why = 'the person set on this card';
        }
        if (!$assignee && $mode === 'client_lead' && !empty($c['team_id'])) {
            $assignee = Db::value('SELECT ct.user_id FROM client_team ct JOIN users u ON u.id = ct.user_id AND u.is_active = 1 WHERE ct.brand_id = ? AND ct.team_id = ?', [$brand['id'], $c['team_id']]);
            $why = "{$brand['name']}'s $team lead";
        }
        if (!$assignee && $mode !== '' && !empty($c['team_id'])) {
            $assignee = self::leastBusy((int) $c['team_id']);
            $why = $mode === 'least_busy' ? "the least busy person in $team" : "the least busy person in $team, because {$brand['name']} has no $team lead yet";
        }
        $id = Db::insert('deliverables', [
            'project_id' => $projectId, 'stage_id' => $stageId, 'position' => 0, 'kind' => 'work',
            'title' => self::fill($step['title'], $run, $brand), 'brief' => self::fill((string) ($c['description'] ?? ''), $run, $brand) ?: null,
            'assignee_id' => $assignee ?: null, 'due_date' => $due, 'asset_format_id' => $c['asset_format_id'] ?? null,
            'priority' => $c['priority'] ?? 'medium',
        ]);
        $people = self::recipients(['to' => $assignee ? 'person' : 'team', 'user_id' => $assignee, 'team_id' => $c['team_id'] ?? null], $brand);
        self::notifyUsers($people, 'New task: ' . self::fill($step['title'], $run, $brand), "{$brand['name']} · due " . date('j M', strtotime($due)),
            '/teams' . (!empty($c['team_id']) ? "/{$c['team_id']}" : ''), (int) $brand['id'], true, 'task_assigned');
        if ($assignee) Hrms::syncTask(Projects::deliverable($id));
        $name = $assignee ? (string) Db::value('SELECT name FROM users WHERE id = ?', [$assignee]) : '';
        return [$id, $assignee ? "$name: $why" : ($team ? "nobody yet, so everyone in $team was told" : 'nobody yet')];
    }

    /** The active person in a department with the fewest open tasks. Team members before heads, then by name. */
    public static function leastBusy(int $teamId): ?int
    {
        $id = Db::value(
            "SELECT u.id FROM users u
             LEFT JOIN deliverables d ON d.assignee_id = u.id AND d.status <> 'approved'
             LEFT JOIN project_stages s ON s.id = d.stage_id AND s.status = 'open'
             WHERE u.team_id = ? AND u.is_active = 1
             GROUP BY u.id ORDER BY COUNT(s.id), u.role <> 'member', u.name LIMIT 1",
            [$teamId]
        );
        return $id ? (int) $id : null;
    }

    // ---------------------------------------------------------------- notifications (also used by approvals)

    /** In-app notification for each person, plus an email when "Email people about their work" is on. */
    public static function notifyUsers(array $users, string $title, string $body, string $link, ?int $brandId, bool $email = false, string $type = 'general'): void
    {
        foreach ($users as $u) {
            Db::insert('notifications', ['user_id' => $u['id'], 'brand_id' => $brandId, 'title' => mb_substr($title, 0, 200), 'body' => $body !== '' ? mb_substr($body, 0, 1000) : null, 'link' => $link, 'type' => $type]);
        }
        if ($email && Settings::bool('notify_emails', true)) {
            $to = array_values(array_filter(array_column($users, 'email')));
            if ($to) {
                $url = rtrim((string) config('app_url', ''), '/') . $link;
                Messenger::email($to, $title, trim($body . "\n\nOpen it: $url"), ['kind' => 'notification', 'brand_id' => $brandId]);
            }
        }
    }

    // ---------------------------------------------------------------- schedules and events

    /** Fires due schedules and resumes finished waits. Safe to call often. */
    public static function tick(): array
    {
        $fired = 0;
        $resumed = 0;
        foreach (Db::all("SELECT n.* FROM workflow_run_nodes n JOIN workflow_runs r ON r.id = n.run_id
                          WHERE n.status = 'active' AND n.waiting_for = 'time' AND n.wait_until <= NOW() AND r.status IN ('running','waiting')") as $n) {
            $step = self::step((int) $n['step_id']);
            Db::exec("UPDATE workflow_run_nodes SET status = 'done', waiting_for = NULL, finished_at = NOW() WHERE id = ?", [$n['id']]);
            self::log((int) $n['run_id'], $step, 'wait', 'done', 'Wait is over');
            Db::update('workflow_runs', (int) $n['run_id'], ['status' => 'running']);
            self::process((int) $n['run_id'], self::targets((int) $n['step_id'], 'next'));
            $resumed++;
        }
        $now = time();
        foreach (Db::all("SELECT t.* FROM workflow_triggers t JOIN workflows w ON w.id = t.workflow_id WHERE t.type = 'schedule' AND t.is_active = 1 AND w.is_live = 1") as $t) {
            $due = self::dueAt($t, $now);
            if ($due === null) continue;
            if ($t['last_fired_at'] && strtotime($t['last_fired_at']) >= $due) continue;
            Db::update('workflow_triggers', (int) $t['id'], ['last_fired_at' => date('Y-m-d H:i:s', $now)]);
            $fired += self::fireTrigger($t, null, self::periodFor($t, $due));
        }
        return ['fired' => $fired, 'resumed' => $resumed];
    }

    /** Runs tick() at most once a minute, on ordinary API requests. Works without a cron job. */
    public static function maybeTick(): void
    {
        $stamp = __DIR__ . '/../../storage/scheduler.last';
        $last = is_file($stamp) ? (int) @file_get_contents($stamp) : 0;
        if (time() - $last < 60) return;
        @file_put_contents($stamp, (string) time());
        try { self::tick(); } catch (\Throwable $e) { error_log('Workflow tick: ' . $e->getMessage()); }
    }

    /** Something happened to a client: start every live workflow listening for it. */
    public static function fire(string $event, int $brandId): void
    {
        try {
            $triggers = Db::all("SELECT t.* FROM workflow_triggers t JOIN workflows w ON w.id = t.workflow_id WHERE t.type = 'event' AND t.event = ? AND t.is_active = 1 AND w.is_live = 1", [$event]);
            foreach ($triggers as $t) self::fireTrigger($t, $brandId, null);
            self::flush();
        } catch (\Throwable $e) {
            error_log("Workflow event $event: " . $e->getMessage());
        }
    }

    public static function fireTrigger(array $t, ?int $brandId, ?string $period): int
    {
        $today = date('Y-m-d');
        if ($t['active_from'] && $today < $t['active_from']) return 0;
        if ($t['active_until'] && $today > $t['active_until']) return 0;
        $where = ['1 = 1'];
        $params = [];
        if ($brandId) { $where[] = 'id = ?'; $params[] = $brandId; }
        if ($t['brand_id']) { $where[] = 'id = ?'; $params[] = $t['brand_id']; }
        if ($t['client_type']) { $where[] = 'brand_type = ?'; $params[] = $t['client_type']; }
        if ($t['client_status']) { $where[] = 'status = ?'; $params[] = $t['client_status']; }
        $started = 0;
        foreach (Db::all('SELECT id FROM brands WHERE ' . implode(' AND ', $where), $params) as $b) {
            if (self::start((int) $t['workflow_id'], (int) $b['id'], null, (int) $t['id'], $period)) $started++;
        }
        return $started;
    }

    public static function dueAt(array $t, int $now): ?int
    {
        [$h, $m] = array_map('intval', explode(':', $t['at_time'] ?: '09:00') + [0, 0]);
        switch ($t['frequency']) {
            case 'once':
                $at = $t['run_at'] ? strtotime($t['run_at']) : null;
                return $at && $at <= $now ? $at : null;
            case 'daily':
                $at = mktime($h, $m, 0, (int) date('n', $now), (int) date('j', $now), (int) date('Y', $now));
                return $at <= $now ? $at : $at - 86400;
            case 'weekly':
                $wd = max(1, min(7, (int) ($t['weekday'] ?: 1)));
                $at = strtotime('today', $now) + $h * 3600 + $m * 60 - (((int) date('N', $now) - $wd + 7) % 7) * 86400;
                return $at <= $now ? $at : $at - 7 * 86400;
            case 'monthly':
                $day = max(1, min(28, (int) ($t['month_day'] ?: 1)));
                $at = mktime($h, $m, 0, (int) date('n', $now), $day, (int) date('Y', $now));
                return $at <= $now ? $at : mktime($h, $m, 0, (int) date('n', $now) - 1, $day, (int) date('Y', $now));
        }
        return null;
    }

    public static function describe(array $t): string
    {
        if ($t['type'] === 'event') return self::EVENTS[$t['event']] ?? (string) $t['event'];
        $at = $t['at_time'] ?: '09:00';
        $days = [1 => 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        return match ($t['frequency']) {
            'daily' => "Every day at $at",
            'weekly' => 'Every ' . ($days[(int) $t['weekday']] ?? 'Monday') . " at $at",
            'monthly' => 'Every month on day ' . ((int) $t['month_day'] ?: 1) . " at $at",
            'once' => 'Once, on ' . ($t['run_at'] ? date('j M Y, g:i a', strtotime($t['run_at'])) : '—'),
            default => '',
        };
    }

    private static function periodFor(array $t, int $due): string
    {
        return match ($t['frequency']) {
            'monthly' => date('Y-m', $due),
            'weekly' => date('o-\WW', $due),
            'daily' => date('Y-m-d', $due),
            default => date('Y-m-d H:i', $due),
        };
    }

    // ---------------------------------------------------------------- lookups

    public static function run(int $id): ?array
    {
        return Db::one('SELECT r.*, w.name AS workflow_name FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id WHERE r.id = ?', [$id]);
    }

    public static function step(int $id): ?array
    {
        $s = Db::one('SELECT * FROM workflow_steps WHERE id = ?', [$id]);
        if ($s) $s['config'] = $s['config'] ? (json_decode($s['config'], true) ?: []) : [];
        return $s;
    }

    public static function steps(int $workflowId): array
    {
        return array_map(function ($s) {
            $s['config'] = $s['config'] ? (json_decode($s['config'], true) ?: []) : [];
            return $s;
        }, Db::all('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY pos_y, pos_x, id', [$workflowId]));
    }

    /** @return int[] step ids the arrows lead to. */
    private static function targets(int $stepId, string $branch): array
    {
        return array_map(fn($r) => (int) $r['to_step_id'], Db::all('SELECT to_step_id FROM workflow_edges WHERE from_step_id = ? AND branch = ? ORDER BY id', [$stepId, $branch]));
    }

    private static function node(int $runId, int $stepId): array
    {
        Db::exec('INSERT IGNORE INTO workflow_run_nodes (run_id, step_id) VALUES (?, ?)', [$runId, $stepId]);
        return Db::one('SELECT * FROM workflow_run_nodes WHERE run_id = ? AND step_id = ?', [$runId, $stepId]);
    }

    private static function brand(int $id): array
    {
        return Db::one('SELECT b.*, o.name AS owner_name, o.email AS owner_email FROM brands b LEFT JOIN users o ON o.id = b.owner_id WHERE b.id = ?', [$id]) ?? ['id' => $id, 'name' => ''];
    }

    private static function fail(array $run, string $why): void
    {
        Db::update('workflow_runs', (int) $run['id'], ['status' => 'failed', 'finished_at' => date('Y-m-d H:i:s')]);
        Db::exec("UPDATE workflow_run_nodes SET status = 'skipped', finished_at = NOW() WHERE run_id = ? AND status = 'active'", [$run['id']]);
        if ($run['project_id']) Db::exec("UPDATE projects SET status = 'on_hold' WHERE id = ?", [$run['project_id']]);
        self::log((int) $run['id'], null, 'end', 'failed', "$why. The workflow stopped.");
    }

    public static function log(int $runId, ?array $step, string $type, string $status, string $message): void
    {
        Db::insert('workflow_run_logs', [
            'run_id' => $runId, 'step_id' => $step['id'] ?? null, 'step_title' => isset($step['title']) ? mb_substr($step['title'], 0, 200) : null,
            'type' => $type, 'status' => $status, 'message' => mb_substr($message, 0, 1000),
        ]);
    }

    public static function fill(string $text, array $run, array $brand): string
    {
        return strtr($text, [
            '{client}' => $brand['name'] ?? '',
            '{contact}' => $brand['contact_name'] ?? '',
            '{workflow}' => $run['workflow_name'] ?? '',
            '{period}' => $run['period'] ?? date('F Y'),
            '{date}' => date('j M Y'),
            '{link}' => rtrim((string) config('app_url', ''), '/') . '/clients/' . ($brand['id'] ?? ''),
        ]);
    }

    private static function who(array $c): string
    {
        return match ($c['to'] ?? 'team') {
            'client' => 'the client',
            'client_lead' => "the client's lead",
            'role' => Auth::roleLabel((string) ($c['role'] ?? '')),
            'person' => 'that person',
            'custom' => 'the addresses given',
            default => 'the department',
        };
    }

    private static function recipients(array $c, array $brand): array
    {
        $to = $c['to'] ?? 'team';
        if ($to === 'person' && !empty($c['user_id'])) return Db::all('SELECT id, name, email, phone FROM users WHERE id = ? AND is_active = 1', [$c['user_id']]);
        if ($to === 'role' && !empty($c['role'])) return Db::all('SELECT id, name, email, phone FROM users WHERE role = ? AND is_active = 1', [$c['role']]);
        if ($to === 'client_lead' && !empty($c['team_id'])) {
            return Db::all('SELECT u.id, u.name, u.email, u.phone FROM client_team ct JOIN users u ON u.id = ct.user_id WHERE ct.brand_id = ? AND ct.team_id = ? AND u.is_active = 1', [$brand['id'], $c['team_id']]);
        }
        if ($to === 'team' && !empty($c['team_id'])) return Db::all('SELECT id, name, email, phone FROM users WHERE team_id = ? AND is_active = 1', [$c['team_id']]);
        return [];
    }

    private static function emails(array $c, array $brand): array
    {
        $to = $c['to'] ?? 'team';
        if ($to === 'client') return []; // workflows are internal: they never message the client
        if ($to === 'custom') return array_values(array_filter(array_map('trim', explode(',', (string) ($c['emails'] ?? ''))), fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));
        return array_values(array_filter(array_column(self::recipients($c, $brand), 'email')));
    }

    private static function numbers(array $c, array $brand): array
    {
        if (($c['to'] ?? 'person') === 'custom') return array_values(array_filter(array_map('trim', explode(',', (string) ($c['numbers'] ?? '')))));
        if (($c['to'] ?? '') === 'client') return []; // workflows are internal: they never message the client
        return array_values(array_filter(array_column(self::recipients($c, $brand), 'phone')));
    }

    private static function callApi(array $c, array $run, array $brand): array
    {
        $url = self::fill(trim((string) ($c['url'] ?? '')), $run, $brand);
        if (!preg_match('#^https?://#i', $url)) return [false, 'No valid URL (it must start with http:// or https://)'];
        $method = strtoupper((string) ($c['method'] ?? 'POST'));
        if (!in_array($method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], true)) $method = 'POST';
        $headers = ['Accept: application/json'];
        foreach (preg_split('/\r?\n/', (string) ($c['headers'] ?? '')) as $line) {
            if (strpos($line, ':') !== false) $headers[] = trim(preg_replace('/[\r\n]/', '', $line));
        }
        $body = self::fill((string) ($c['body'] ?? ''), $run, $brand);
        if ($body !== '' && !preg_grep('/^content-type:/i', $headers)) $headers[] = 'Content-Type: application/json';
        $tries = 1 + max(0, min(3, (int) ($c['retries'] ?? 1)));
        $last = '';
        for ($i = 1; $i <= $tries; $i++) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_HTTPHEADER => $headers, CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            ]);
            if ($body !== '' && $method !== 'GET') curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
            $res = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err = curl_error($ch);
            curl_close($ch);
            if ($res !== false && $code >= 200 && $code < 300) {
                return [true, "$method $url → $code" . ($i > 1 ? " (try $i)" : '') . ($res ? ': ' . mb_substr(trim((string) $res), 0, 160) : '')];
            }
            $last = $res === false ? "no response ($err)" : "$code: " . mb_substr(trim((string) $res), 0, 160);
        }
        return [false, "$method $url failed after $tries " . ($tries === 1 ? 'try' : 'tries') . " → $last"];
    }

    private static function matches(array $c, array $brand): bool
    {
        $want = mb_strtolower(trim((string) ($c['value'] ?? '')));
        $have = match ($c['field'] ?? 'client.type') {
            'client.type' => (string) ($brand['brand_type'] ?? ''),
            'client.status' => (string) ($brand['status'] ?? ''),
            'client.industry' => (string) ($brand['industry'] ?? ''),
            'client.tags' => is_array($t = json_decode((string) ($brand['tags'] ?? ''), true)) ? implode(', ', $t) : (string) ($brand['tags'] ?? ''),
            default => '',
        };
        $have = mb_strtolower($have);
        return match ($c['op'] ?? 'is') {
            'is_not' => $have !== $want,
            'contains' => $want !== '' && str_contains($have, $want),
            default => $have === $want,
        };
    }

    public static function conditionText(array $c): string
    {
        $fields = ['client.type' => 'client type', 'client.status' => 'client status', 'client.industry' => 'industry', 'client.tags' => 'tags'];
        $ops = ['is' => 'is', 'is_not' => 'is not', 'contains' => 'contains'];
        return ($fields[$c['field'] ?? 'client.type'] ?? 'value') . ' ' . ($ops[$c['op'] ?? 'is'] ?? 'is') . ' “' . ($c['value'] ?? '') . '”';
    }
}
