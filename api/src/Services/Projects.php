<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;

/**
 * The Brand OS flow.
 *
 * A project copies its stages and deliverables from a blueprint. Stages open one
 * at a time. Work on a deliverable is submitted as a version (V1, V2...). The
 * stage's approver either approves the version, which locks the deliverable, or
 * requests changes, which asks for the next version. When every deliverable in a
 * stage is approved the stage is done and the next one opens.
 */
class Projects
{

    public static function create(int $brandId, int $blueprintId, ?int $ownerId, int $userId): int
    {
        $blueprint = Db::one('SELECT * FROM blueprints WHERE id = ?', [$blueprintId]);
        if (!$blueprint) throw HttpException::validation(['blueprint_id' => 'Choose a project type.']);
        $stages = Db::all('SELECT * FROM blueprint_stages WHERE blueprint_id = ? ORDER BY position', [$blueprintId]);

        return Db::transaction(function () use ($brandId, $blueprint, $stages, $ownerId, $userId) {
            $total = array_sum(array_map(fn($s) => (int) $s['duration_days'], $stages));
            $projectId = Db::insert('projects', [
                'brand_id' => $brandId,
                'blueprint_id' => $blueprint['id'],
                'name' => $blueprint['name'],
                'owner_id' => $ownerId,
                'target_date' => date('Y-m-d', strtotime("+$total days")),
            ]);
            $offset = 0;
            foreach ($stages as $i => $s) {
                $offset += (int) $s['duration_days'];
                $stageId = Db::insert('project_stages', [
                    'project_id' => $projectId,
                    'position' => $i + 1,
                    'name' => $s['name'],
                    'summary' => $s['summary'],
                    'team_id' => $s['team_id'],
                    'approver_role' => $s['approver_role'],
                    'status' => $i === 0 ? 'open' : 'locked',
                    'opened_at' => $i === 0 ? date('Y-m-d H:i:s') : null,
                    'due_date' => date('Y-m-d', strtotime("+$offset days")),
                ]);
                $items = Db::all('SELECT * FROM blueprint_deliverables WHERE stage_id = ? ORDER BY position', [$s['id']]);
                foreach ($items as $j => $d) {
                    Db::insert('deliverables', [
                        'project_id' => $projectId,
                        'stage_id' => $stageId,
                        'position' => $j,
                        'kind' => $d['kind'],
                        'title' => $d['title'],
                        'brief' => $d['brief'],
                        'due_date' => date('Y-m-d', strtotime("+$offset days")),
                        'assignee_id' => $d['kind'] === 'intake' ? $ownerId : null,
                    ]);
                }
            }
            Db::exec("UPDATE brands SET status = 'in_progress' WHERE id = ? AND status = 'new'", [$brandId]);
            Db::exec('UPDATE brands SET onboarding_started_at = COALESCE(onboarding_started_at, NOW()) WHERE id = ?', [$brandId]);
            Activity::log($brandId, $userId, 'project.created', "Started a {$blueprint['name']} project");
            return $projectId;
        });
    }

    // Reading ------------------------------------------------------------------------------

    public static function detail(int $projectId, array $user): array
    {
        $p = Db::one(
            'SELECT p.*, b.name AS brand_name, o.name AS owner_name FROM projects p
             JOIN brands b ON b.id = p.brand_id LEFT JOIN users o ON o.id = p.owner_id WHERE p.id = ?',
            [$projectId]
        );
        if (!$p) throw HttpException::notFound('Project');
        $stages = Db::all(
            'SELECT s.*, t.name AS team_name, t.icon AS team_icon FROM project_stages s
             LEFT JOIN teams t ON t.id = s.team_id WHERE s.project_id = ? ORDER BY s.position',
            [$projectId]
        );
        $deliverables = Db::all(self::DELIVERABLE_SQL . ' WHERE d.project_id = ? ORDER BY d.position, d.id', [$projectId]);
        $byStage = [];
        foreach ($deliverables as $d) $byStage[(int) $d['stage_id']][] = self::shape($d);
        foreach ($stages as &$s) {
            $s['deliverables'] = $byStage[(int) $s['id']] ?? [];
            $s['can_review'] = Auth::canApprove($user, $s['approver_role']);
        }
        $p['stages'] = $stages;
        $p['progress'] = self::progress($deliverables);
        return $p;
    }

    public const DELIVERABLE_SQL = "
        SELECT d.*, u.name AS assignee_name, s.name AS stage_name, s.position AS stage_no, s.status AS stage_status,
               s.approver_role, s.team_id, t.name AS team_name, t.icon AS team_icon,
               p.brand_id, b.name AS brand_name, ab.name AS approved_by_name, bb.name AS blocked_by_name,
               p.kind AS project_kind, p.name AS project_name, af.name AS asset_format_name,
               (SELECT v.id FROM deliverable_versions v WHERE v.deliverable_id = d.id ORDER BY v.version_no DESC LIMIT 1) AS latest_version_id
        FROM deliverables d
        JOIN project_stages s ON s.id = d.stage_id
        JOIN projects p ON p.id = d.project_id
        JOIN brands b ON b.id = p.brand_id
        LEFT JOIN teams t ON t.id = s.team_id
        LEFT JOIN users u ON u.id = d.assignee_id
        LEFT JOIN users ab ON ab.id = d.approved_by
        LEFT JOIN users bb ON bb.id = d.blocked_by
        LEFT JOIN asset_formats af ON af.id = d.asset_format_id";

    public static function shape(array $d): array
    {
        foreach (['id', 'project_id', 'stage_id', 'stage_no', 'version_count', 'brand_id'] as $k) {
            if (isset($d[$k])) $d[$k] = (int) $d[$k];
        }
        if (array_key_exists('tags', $d)) $d['tags'] = $d['tags'] ? (json_decode($d['tags'], true) ?: []) : [];
        if (isset($d['blocked'])) $d['blocked'] = (bool) $d['blocked'];
        return $d;
    }

    public static function progress(array $deliverables): array
    {
        $done = count(array_filter($deliverables, fn($d) => $d['status'] === 'approved'));
        return ['done' => $done, 'total' => count($deliverables)];
    }

    public static function deliverable(int $id): array
    {
        $d = Db::one(self::DELIVERABLE_SQL . ' WHERE d.id = ?', [$id]);
        if (!$d) throw HttpException::notFound('Task');
        return self::shape($d);
    }

    // Working ------------------------------------------------------------------------------

    public static function submitVersion(array $d, array $user, ?string $note, ?string $link, ?array $file): int
    {
        self::assertWorkable($d);
        if ($d['kind'] === 'intake') throw new HttpException(422, 'The client fills this in through their form link.');
        if ($d['status'] === 'in_review') throw new HttpException(409, 'The latest version is still waiting for approval.');
        if (!$note && !$link && !$file) {
            throw HttpException::validation(['note' => 'Add a file, a link or a note describing this version.']);
        }
        if ($link && !preg_match('#^https?://#i', $link)) throw HttpException::validation(['link_url' => 'Start the link with http:// or https://']);

        $stored = $file ? self::storeFile((int) $d['id'], $file) : null;
        $no = (int) $d['version_count'] + 1;
        $vid = Db::transaction(function () use ($d, $user, $note, $link, $stored, $no) {
            $vid = Db::insert('deliverable_versions', [
                'deliverable_id' => $d['id'],
                'version_no' => $no,
                'note' => $note ?: null,
                'link_url' => $link ?: null,
                'file_name' => $stored['name'] ?? null,
                'file_path' => $stored['path'] ?? null,
                'file_size' => $stored['size'] ?? null,
                'created_by' => $user['id'],
            ]);
            Db::exec(
                "UPDATE deliverables SET status = 'in_review', version_count = ?, assignee_id = COALESCE(assignee_id, ?) WHERE id = ?",
                [$no, $user['id'], $d['id']]
            );
            Activity::log((int) $d['brand_id'], $user['id'], 'version.submitted', "Submitted {$d['title']} (version $no) for approval");
            return $vid;
        });
        // Workflow tasks set to "no approval needed" are done as soon as they are submitted.
        if ($d['approver_role'] === 'auto') {
            self::decide(self::deliverable((int) $d['id']), ['id' => $user['id'], 'role' => 'super_admin'], 'approved', null);
            return $vid;
        }
        $approvers = Db::all('SELECT id, name, email FROM users WHERE role = ? AND is_active = 1 AND id <> ?', [$d['approver_role'], $user['id']]);
        if (!$approvers) $approvers = Db::all("SELECT id, name, email FROM users WHERE role IN ('super_admin','admin') AND is_active = 1 AND id <> ?", [$user['id']]);
        $who = Db::value('SELECT name FROM users WHERE id = ?', [$user['id']]);
        Workflows::notifyUsers($approvers, "Waiting for your approval: {$d['title']}", "{$d['brand_name']} · version $no from $who" . ($note ? "\n\nWhat changed: $note" : ''), '/reviews', (int) $d['brand_id'], true);
        return $vid;
    }

    public static function decide(array $d, array $user, string $decision, ?string $note): void
    {
        if (!Auth::canApprove($user, $d['approver_role'])) {
            throw HttpException::forbidden('Only the ' . Auth::roleLabel($d['approver_role']) . ' can approve work in this stage.');
        }
        self::assertWorkable($d);
        if ($decision === 'changes_requested' && trim((string) $note) === '') {
            throw HttpException::validation(['note' => 'Say what needs to change.']);
        }

        if ($d['kind'] === 'intake') {
            $status = Db::value("SELECT fs.status FROM form_submissions fs JOIN projects p ON p.brand_id = fs.brand_id WHERE p.id = ? AND fs.kind = 'intake'", [$d['project_id']]);
            if ($decision === 'approved' && $status !== 'submitted') {
                throw new HttpException(409, 'The client has not submitted their form yet.');
            }
            Db::transaction(function () use ($d, $user, $decision, $note) {
                if ($decision === 'approved') {
                    Db::exec("UPDATE deliverables SET status = 'approved', approved_at = NOW(), approved_by = ? WHERE id = ?", [$user['id'], $d['id']]);
                    Activity::log((int) $d['brand_id'], $user['id'], 'deliverable.approved', "Accepted the client's intake form");
                    self::afterApproval((int) $d['stage_id'], $user);
                } else {
                    Db::exec("UPDATE form_submissions fs JOIN projects p ON p.brand_id = fs.brand_id SET fs.status = 'in_progress', fs.submitted_at = NULL WHERE p.id = ? AND fs.kind = 'intake'", [$d['project_id']]);
                    Db::exec("UPDATE deliverables SET status = 'changes_requested' WHERE id = ?", [$d['id']]);
                    Activity::log((int) $d['brand_id'], $user['id'], 'deliverable.changes', "Reopened the intake form: $note");
                }
            });
            return;
        }

        $version = Db::one("SELECT * FROM deliverable_versions WHERE deliverable_id = ? AND status = 'in_review' ORDER BY version_no DESC LIMIT 1", [$d['id']]);
        if (!$version) throw new HttpException(409, 'There is nothing waiting for approval.');

        Db::transaction(function () use ($d, $user, $decision, $note, $version) {
            Db::exec(
                'UPDATE deliverable_versions SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?',
                [$decision, $user['id'], $note ?: null, $version['id']]
            );
            $v = 'version ' . $version['version_no'];
            if ($decision === 'approved') {
                Db::exec("UPDATE deliverables SET status = 'approved', approved_at = NOW(), approved_by = ? WHERE id = ?", [$user['id'], $d['id']]);
                Activity::log((int) $d['brand_id'], $user['id'], 'deliverable.approved', "Approved {$d['title']} $v");
                self::afterApproval((int) $d['stage_id'], $user);
            } else {
                Db::exec("UPDATE deliverables SET status = 'changes_requested' WHERE id = ?", [$d['id']]);
                Activity::log((int) $d['brand_id'], $user['id'], 'deliverable.changes', "Sent back {$d['title']} $v: $note");
            }
        });
        $people = Db::all('SELECT id, name, email FROM users WHERE id IN (?, ?) AND is_active = 1 AND id <> ?', [(int) $version['created_by'], (int) ($d['assignee_id'] ?? 0), $user['id']]);
        $by = Db::value('SELECT name FROM users WHERE id = ?', [$user['id']]);
        if ($decision === 'approved') {
            Workflows::notifyUsers($people, "Approved: {$d['title']}", "{$d['brand_name']} · approved by $by", "/clients/{$d['brand_id']}", (int) $d['brand_id'], true);
        } else {
            Workflows::notifyUsers($people, "Rework needed: {$d['title']}", "{$d['brand_name']} · $by asked for changes:\n$note", "/clients/{$d['brand_id']}", (int) $d['brand_id'], true);
        }
        Workflows::flush();
    }

    /** Closes the stage when all its deliverables are approved and opens the next one. */
    private static function afterApproval(int $stageId, array $user): void
    {
        $open = (int) Db::value("SELECT COUNT(*) FROM deliverables WHERE stage_id = ? AND status <> 'approved'", [$stageId]);
        if ($open > 0) return;
        self::closeStage($stageId, $user);
    }

    public static function closeStage(int $stageId, array $user): void
    {
        $stage = Db::one('SELECT s.*, p.brand_id, p.kind AS project_kind FROM project_stages s JOIN projects p ON p.id = s.project_id WHERE s.id = ?', [$stageId]);
        Db::exec("UPDATE project_stages SET status = 'done', done_at = NOW() WHERE id = ?", [$stageId]);
        if ($stage['project_kind'] === 'workflow') {
            // A workflow creates its stages one at a time; the run decides what happens next.
            Workflows::taskFinished((int) $stageId);
            return;
        }
        Activity::log((int) $stage['brand_id'], $user['id'], 'stage.done', "Finished the {$stage['name']} stage");

        $next = Db::one("SELECT * FROM project_stages WHERE project_id = ? AND position > ? ORDER BY position LIMIT 1", [$stage['project_id'], $stage['position']]);
        if (!$next) {
            Db::exec("UPDATE projects SET status = 'completed', completed_at = NOW() WHERE id = ?", [$stage['project_id']]);
            Db::exec("UPDATE brands SET status = 'live' WHERE id = ? AND status <> 'retainer'", [$stage['brand_id']]);
            Activity::log((int) $stage['brand_id'], $user['id'], 'project.completed', 'Completed the project');
            Workflows::fire('onboarding.completed', (int) $stage['brand_id']);
            return;
        }
        Db::exec("UPDATE project_stages SET status = 'open', opened_at = NOW() WHERE id = ?", [$next['id']]);
        Db::exec('UPDATE projects SET current_stage = ? WHERE id = ?', [$next['position'], $stage['project_id']]);
        $count = (int) Db::value('SELECT COUNT(*) FROM deliverables WHERE stage_id = ?', [$next['id']]);
        if ($count === 0) { self::closeStage((int) $next['id'], $user); return; }

        // Hand the next stage to the next department's person and tell them it's their turn.
        $prev = $stage + ['team_name' => $stage['team_id'] ? Db::value('SELECT name FROM teams WHERE id = ?', [$stage['team_id']]) : null];
        $approver = Db::one('SELECT id, name FROM users WHERE id = ?', [$user['id']]);
        Handoff::stageOpened((int) $next['id'], $prev, $approver);
    }

    public static function assertWorkable(array $d): void
    {
        $project = Db::one('SELECT status FROM projects WHERE id = ?', [$d['project_id']]);
        if ($project['status'] === 'on_hold') throw new HttpException(409, 'This project is on hold. Resume it to continue.');
        if ($d['stage_status'] === 'locked') throw new HttpException(409, "The {$d['stage_name']} stage opens after the previous stage is finished.");
        if ($d['status'] === 'approved') throw new HttpException(409, 'This task is already approved.');
    }

    private static function storeFile(int $deliverableId, array $file): array
    {
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) throw new HttpException(422, 'The file did not upload. Please try again.');
        $max = (int) config('upload_max_mb', 15) * 1024 * 1024;
        if ($file['size'] > $max) throw new HttpException(422, 'That file is larger than ' . config('upload_max_mb', 15) . ' MB. Share a link instead.');
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        $allowed = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ai', 'psd', 'fig', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'zip', 'mp4', 'mov', 'txt'];
        if (!in_array($ext, $allowed, true)) throw new HttpException(422, 'That file type is not supported. Zip it or share a link.');
        $dir = __DIR__ . '/../../storage/uploads/deliverables/' . $deliverableId;
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $name = bin2hex(random_bytes(12)) . '.' . $ext;
        if (!move_uploaded_file($file['tmp_name'], "$dir/$name")) throw new HttpException(500, 'The file could not be saved on the server.');
        return ['name' => mb_substr(basename($file['name']), 0, 200), 'path' => "deliverables/$deliverableId/$name", 'size' => (int) $file['size']];
    }
}
