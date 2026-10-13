<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\Request;
use App\Services\Activity;
use App\Services\Projects;

class HomeController
{
    public static function index(Request $r): array
    {
        $user = $r->user;

        $reviewRows = Db::all(Projects::DELIVERABLE_SQL . " WHERE d.status = 'in_review' AND s.status = 'open' AND p.status = 'active' ORDER BY d.updated_at");
        $reviews = array_values(array_filter(array_map([Projects::class, 'shape'], $reviewRows), fn($d) => Auth::canApprove($user, $d['approver_role'])));

        $work = array_map([Projects::class, 'shape'], Db::all(
            Projects::DELIVERABLE_SQL . " WHERE s.status = 'open' AND p.status = 'active'
              AND d.status IN ('not_started','in_progress','changes_requested')
              AND (d.assignee_id = ? OR (d.assignee_id IS NULL AND s.team_id = ?))
              ORDER BY d.status = 'changes_requested' DESC, d.due_date IS NULL, d.due_date LIMIT 12",
            [$user['id'], $user['team_id'] ?? 0]
        ));

        $projects = Db::all(
            "SELECT p.id, p.name, p.status, p.current_stage, p.target_date, b.id AS client_id, b.name AS client_name,
                    (SELECT COUNT(*) FROM project_stages s WHERE s.project_id = p.id) AS stage_count,
                    (SELECT s.name FROM project_stages s WHERE s.project_id = p.id AND s.position = p.current_stage) AS stage_name,
                    (SELECT t.icon FROM project_stages s JOIN teams t ON t.id = s.team_id WHERE s.project_id = p.id AND s.position = p.current_stage) AS stage_icon,
                    (SELECT t.name FROM project_stages s JOIN teams t ON t.id = s.team_id WHERE s.project_id = p.id AND s.position = p.current_stage) AS team_name,
                    (SELECT COUNT(*) FROM deliverables d WHERE d.project_id = p.id AND d.status = 'in_review') AS in_review,
                    (SELECT COUNT(*) FROM deliverables d JOIN project_stages s ON s.id = d.stage_id WHERE d.project_id = p.id AND s.status = 'open' AND d.status <> 'approved' AND d.due_date < CURDATE()) AS late
             FROM projects p JOIN brands b ON b.id = p.brand_id
             WHERE p.status IN ('active','on_hold') AND p.kind = 'onboarding' ORDER BY p.status, p.started_at DESC LIMIT 12"
        );

        $counts = Db::one(
            "SELECT
               (SELECT COUNT(*) FROM projects WHERE status = 'active' AND kind = 'onboarding') AS active_projects,
               (SELECT COUNT(*) FROM deliverables d JOIN project_stages s ON s.id = d.stage_id JOIN projects p ON p.id = d.project_id
                  WHERE s.status = 'open' AND p.status = 'active' AND d.status <> 'approved' AND d.due_date < CURDATE()) AS late,
               (SELECT COUNT(*) FROM form_submissions WHERE status IN ('sent','in_progress')) AS forms_out,
               (SELECT COUNT(*) FROM deliverable_versions WHERE status = 'approved' AND decided_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS approved_week"
        );

        return [
            'reviews' => $reviews,
            'work' => $work,
            'projects' => $projects,
            'counts' => $counts,
            'activity' => Activity::recent(null, 10),
        ];
    }

    public static function activity(Request $r): array
    {
        $clientId = (int) ($r->query['client_id'] ?? 0);
        return Activity::recent($clientId ?: null, 50);
    }
}
