<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Activity;
use App\Services\Projects;

class ProjectController
{
    public static function blueprints(Request $r): array
    {
        $blueprints = Db::all('SELECT id, client_type, name, description FROM blueprints ORDER BY position, id');
        $stages = Db::all(
            'SELECT s.id, s.blueprint_id, s.position, s.name, s.summary, s.approver_role, s.duration_days, t.name AS team_name, t.icon AS team_icon,
                    (SELECT COUNT(*) FROM blueprint_deliverables d WHERE d.stage_id = s.id) AS deliverable_count
             FROM blueprint_stages s LEFT JOIN teams t ON t.id = s.team_id ORDER BY s.position'
        );
        foreach ($blueprints as &$b) {
            $b['stages'] = array_values(array_filter($stages, fn($s) => (int) $s['blueprint_id'] === (int) $b['id']));
        }
        return $blueprints;
    }

    public static function show(Request $r): array
    {
        return Projects::detail($r->param('id'), $r->user);
    }

    public static function start(Request $r): array
    {
        $clientId = $r->param('id');
        if (!Db::value('SELECT id FROM brands WHERE id = ?', [$clientId])) throw HttpException::notFound('Client');
        $data = Validator::validate($r->body, ['blueprint_id' => 'required,int']);
        $id = Projects::create($clientId, (int) $data['blueprint_id'], $r->user['id'], $r->user['id']);
        return Projects::detail($id, $r->user);
    }

    /** Starts the same project type for several clients at once. Clients already running it are skipped. */
    public static function startMany(Request $r): array
    {
        $data = Validator::validate($r->body, ['blueprint_id' => 'required,int', 'client_ids' => 'required,array']);
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $data['client_ids']))));
        if (!$ids) throw HttpException::validation(['client_ids' => 'Choose at least one client.']);
        $started = [];
        $skipped = [];
        foreach ($ids as $clientId) {
            $client = Db::one('SELECT id, name FROM brands WHERE id = ?', [$clientId]);
            if (!$client) continue;
            $running = Db::value(
                "SELECT id FROM projects WHERE brand_id = ? AND blueprint_id = ? AND status IN ('active','on_hold')",
                [$clientId, $data['blueprint_id']]
            );
            if ($running) { $skipped[] = $client['name']; continue; }
            Projects::create($clientId, (int) $data['blueprint_id'], $r->user['id'], $r->user['id']);
            $started[] = $client['name'];
        }
        return ['started' => $started, 'skipped' => $skipped];
    }

    public static function update(Request $r): array
    {
        $id = $r->param('id');
        $project = Db::one('SELECT * FROM projects WHERE id = ?', [$id]);
        if (!$project) throw HttpException::notFound('Project');
        $data = Validator::validate($r->body, ['status' => 'in:active|on_hold', 'owner_id' => 'int', 'target_date' => 'date'], true);
        if (isset($data['status']) && $project['status'] === 'completed') throw new HttpException(409, 'This project is already complete.');
        Db::update('projects', $id, $data);
        if (isset($data['status']) && $data['status'] !== $project['status']) {
            $brandStatus = $data['status'] === 'on_hold' ? 'on_hold' : 'in_progress';
            Db::exec('UPDATE brands SET status = ? WHERE id = ?', [$brandStatus, $project['brand_id']]);
            Activity::log((int) $project['brand_id'], $r->user['id'], 'project.status', $data['status'] === 'on_hold' ? 'Put the project on hold' : 'Resumed the project');
        }
        return Projects::detail($id, $r->user);
    }

    public static function addDeliverable(Request $r): array
    {
        $stage = Db::one('SELECT s.*, p.brand_id FROM project_stages s JOIN projects p ON p.id = s.project_id WHERE s.id = ?', [$r->param('id')]);
        if (!$stage) throw HttpException::notFound('Stage');
        if (!Auth::canApprove($r->user, $stage['approver_role']) && $r->user['role'] !== 'project_manager') {
            throw HttpException::forbidden('Only the stage approver or a project manager can add tasks.');
        }
        if ($stage['status'] === 'done') throw new HttpException(409, 'This stage is finished.');
        $data = Validator::validate($r->body, ['title' => 'required,max:200', 'brief' => 'max:5000', 'assignee_id' => 'int', 'due_date' => 'date']);
        $data += [
            'project_id' => $stage['project_id'],
            'stage_id' => $stage['id'],
            'position' => (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM deliverables WHERE stage_id = ?', [$stage['id']]),
            'due_date' => $stage['due_date'],
        ];
        $id = Db::insert('deliverables', $data);
        Activity::log((int) $stage['brand_id'], $r->user['id'], 'deliverable.added', "Added {$data['title']} to {$stage['name']}");
        return Projects::deliverable($id);
    }
}
