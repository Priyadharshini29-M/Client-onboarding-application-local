<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Db;

/**
 * Automatic handoff between departments on a client's project.
 *
 * A client's project runs stage by stage, and each stage belongs to a department. When a stage is finished
 * (every task in it approved), the next stage opens and this hands it over:
 *   1. its unassigned tasks go to the client's lead for that department (Team tab),
 *      or to the least busy person in the department when the client has no lead there;
 *   2. that person is notified (bell, and email when turned on in Integrations);
 *   3. whoever finished the previous stage is told who it went to.
 * It can be turned off per client on the Team tab.
 */
class Handoff
{
    public static function enabled(int $brandId): bool
    {
        return (bool) Db::value('SELECT auto_handoff FROM brands WHERE id = ?', [$brandId]);
    }

    /** Called when $stageId has just opened because $prev finished. $approver is who approved the last task. */
    public static function stageOpened(int $stageId, ?array $prev, ?array $approver): void
    {
        $stage = Db::one(
            'SELECT s.*, p.brand_id, b.name AS brand_name, t.name AS team_name
             FROM project_stages s JOIN projects p ON p.id = s.project_id JOIN brands b ON b.id = p.brand_id LEFT JOIN teams t ON t.id = s.team_id
             WHERE s.id = ?',
            [$stageId]
        );
        if (!$stage || !self::enabled((int) $stage['brand_id'])) return;
        $brandId = (int) $stage['brand_id'];

        [$personId, $why] = self::pickPerson($brandId, $stage['team_id'] ? (int) $stage['team_id'] : null);
        if ($personId) {
            Db::exec("UPDATE deliverables SET assignee_id = ? WHERE stage_id = ? AND assignee_id IS NULL AND status <> 'approved' AND kind = 'work'", [$personId, $stageId]);
        }
        $tasks = Db::all("SELECT title, due_date FROM deliverables WHERE stage_id = ? AND status <> 'approved' ORDER BY position, id", [$stageId]);
        if (!$tasks) return;

        $prevText = $prev
            ? ($prev['team_name'] ? "{$prev['team_name']} finished {$prev['name']}" : "{$prev['name']} is finished") . (!empty($approver['name']) ? ", approved by {$approver['name']}" : '') . '.'
            : '';
        $due = array_filter(array_column($tasks, 'due_date'));
        $dueText = $due ? ' First one due ' . date('j M', strtotime(min($due))) . '.' : '';
        $list = implode(', ', array_slice(array_column($tasks, 'title'), 0, 4)) . (count($tasks) > 4 ? ' and ' . (count($tasks) - 4) . ' more' : '');

        if ($personId) {
            $person = Db::all('SELECT id, name, email FROM users WHERE id = ?', [$personId]);
            $n = count($tasks);
            Workflows::notifyUsers($person, "Your turn on {$stage['brand_name']}: {$stage['name']}",
                trim("$prevText $n " . ($n === 1 ? 'task is' : 'tasks are') . " now yours: $list.$dueText"),
                "/clients/$brandId?view=project", $brandId, true);
            $who = $person[0]['name'] ?? 'someone';
            Activity::log($brandId, $approver['id'] ?? null, 'handoff', "Handed {$stage['name']} to $who ($why)");
        } else {
            // Nobody in that department: tell whoever manages the client so it doesn't stall.
            $owner = Db::all('SELECT u.id, u.name, u.email FROM brands b JOIN users u ON u.id = b.owner_id WHERE b.id = ?', [$brandId]);
            Workflows::notifyUsers($owner, "Nobody to hand {$stage['name']} to", trim("$prevText {$stage['brand_name']} has no " . ($stage['team_name'] ?: 'department') . ' person for this stage. Assign its tasks on the project.'),
                "/clients/$brandId?view=project", $brandId, true);
            Activity::log($brandId, $approver['id'] ?? null, 'handoff', "{$stage['name']} opened but nobody could be assigned");
            return;
        }

        // Tell the people who finished the previous stage where it went.
        if ($prev) {
            $done = Db::all(
                "SELECT DISTINCT u.id, u.name, u.email FROM deliverables d JOIN users u ON u.id = d.assignee_id
                 WHERE d.stage_id = ? AND u.is_active = 1 AND u.id <> ?", [$prev['id'], $personId]
            );
            Workflows::notifyUsers($done, "Handed over: {$stage['brand_name']}", "{$prev['name']} is approved. {$stage['name']} is now with $who" . ($stage['team_name'] ? " ({$stage['team_name']})" : '') . '.',
                "/clients/$brandId?view=project", $brandId, false);
        }
    }

    /** The client's lead for the department, else the least busy person in it. @return array{0:?int,1:string} */
    public static function pickPerson(int $brandId, ?int $teamId): array
    {
        if (!$teamId) return [null, 'no department'];
        $lead = Db::value('SELECT ct.user_id FROM client_team ct JOIN users u ON u.id = ct.user_id AND u.is_active = 1 WHERE ct.brand_id = ? AND ct.team_id = ?', [$brandId, $teamId]);
        if ($lead) return [(int) $lead, 'the client’s lead'];
        $any = Workflows::leastBusy($teamId);
        return $any ? [$any, 'least busy in the department, no lead set'] : [null, 'nobody in the department'];
    }

    /** When a lead is set on the Team tab, give them the unassigned tasks of that department's open stage. */
    public static function leadChanged(int $brandId, int $teamId, int $userId): int
    {
        if (!self::enabled($brandId)) return 0;
        return Db::exec(
            "UPDATE deliverables d JOIN project_stages s ON s.id = d.stage_id JOIN projects p ON p.id = d.project_id
             SET d.assignee_id = ?
             WHERE p.brand_id = ? AND p.kind = 'onboarding' AND s.team_id = ? AND s.status = 'open' AND d.assignee_id IS NULL AND d.status <> 'approved' AND d.kind = 'work'",
            [$userId, $brandId, $teamId]
        );
    }

    /** The client's project as a chain of departments: who did it, who has it now, who is next. */
    public static function chain(int $brandId): array
    {
        $project = Db::one("SELECT id FROM projects WHERE brand_id = ? AND kind = 'onboarding' ORDER BY id DESC LIMIT 1", [$brandId]);
        if (!$project) return [];
        $rows = Db::all(
            "SELECT s.id, s.position, s.name, s.status, s.team_id, t.name AS team_name, t.icon AS team_icon, s.approver_role, s.done_at, s.opened_at,
                    (SELECT COUNT(*) FROM deliverables d WHERE d.stage_id = s.id) AS tasks,
                    (SELECT COUNT(*) FROM deliverables d WHERE d.stage_id = s.id AND d.status = 'approved') AS approved,
                    (SELECT GROUP_CONCAT(DISTINCT u.name ORDER BY u.name SEPARATOR ', ') FROM deliverables d JOIN users u ON u.id = d.assignee_id WHERE d.stage_id = s.id) AS people,
                    (SELECT u.name FROM client_team ct JOIN users u ON u.id = ct.user_id WHERE ct.brand_id = ? AND ct.team_id = s.team_id) AS lead_name
             FROM project_stages s LEFT JOIN teams t ON t.id = s.team_id
             WHERE s.project_id = ? ORDER BY s.position",
            [$brandId, $project['id']]
        );
        return array_map(function ($r) use ($brandId) {
            $r['next_person'] = null;
            if ($r['status'] === 'locked') {
                [$pid, $why] = self::pickPerson($brandId, $r['team_id'] ? (int) $r['team_id'] : null);
                $r['next_person'] = $pid ? Db::value('SELECT name FROM users WHERE id = ?', [$pid]) : null;
                $r['next_why'] = $why;
            }
            return $r;
        }, $rows);
    }
}
