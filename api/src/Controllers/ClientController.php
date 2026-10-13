<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Workflows;
use App\Services\Activity;
use App\Services\ClientTypes;
use App\Services\Forms;
use App\Services\Health;
use App\Services\Projects;

class ClientController
{
    public const STATUSES = ['new', 'in_progress', 'on_hold', 'live', 'retainer'];

    private const LIST_SQL = "
        SELECT b.id, b.name, b.email, b.contact_name, b.phone, b.website, b.industry, b.brand_type, b.profile, b.logo_url, b.tags,
               b.status, b.created_at, b.updated_at, b.onboarding_started_at, b.retainer_at,
               b.owner_id, o.name AS owner_name, fs.status AS intake_status, fs.submitted_at AS intake_submitted_at,
               p.id AS project_id, p.name AS project_name, p.status AS project_status, p.current_stage, p.target_date,
               (SELECT COUNT(*) FROM project_stages s WHERE s.project_id = p.id) AS stage_count,
               (SELECT s.name FROM project_stages s WHERE s.project_id = p.id AND s.position = p.current_stage) AS stage_name,
               (SELECT t.icon FROM project_stages s JOIN teams t ON t.id = s.team_id WHERE s.project_id = p.id AND s.position = p.current_stage) AS stage_icon,
               (SELECT COUNT(*) FROM deliverables d WHERE d.project_id = p.id AND d.status = 'in_review') AS in_review,
               (SELECT COUNT(*) FROM deliverables d WHERE d.project_id = p.id AND d.status = 'approved') AS approved,
               (SELECT COUNT(*) FROM deliverables d WHERE d.project_id = p.id) AS deliverable_count,
               (SELECT COUNT(*) FROM deliverables d JOIN project_stages s ON s.id = d.stage_id JOIN projects px ON px.id = d.project_id
                  WHERE px.brand_id = b.id AND s.status = 'open' AND d.status <> 'approved') AS open_work,
               (SELECT COUNT(*) FROM deliverables d JOIN project_stages s ON s.id = d.stage_id JOIN projects px ON px.id = d.project_id
                  WHERE px.brand_id = b.id AND s.status = 'open' AND d.status <> 'approved' AND d.due_date < CURDATE()) AS late_count,
               (SELECT COUNT(*) FROM deliverables d JOIN projects px ON px.id = d.project_id WHERE px.brand_id = b.id AND d.blocked = 1 AND d.status <> 'approved') AS blocked_count,
               (SELECT COUNT(*) FROM deliverables d JOIN projects px ON px.id = d.project_id WHERE px.brand_id = b.id AND d.status = 'changes_requested') AS changes_count,
               (SELECT COUNT(*) FROM setup_items si WHERE si.brand_id = b.id) AS setup_total,
               (SELECT COUNT(*) FROM setup_items si WHERE si.brand_id = b.id AND si.done = 1) AS setup_done,
               (SELECT COUNT(*) FROM client_documents cd WHERE cd.brand_id = b.id) AS docs_total,
               (SELECT COUNT(*) FROM client_documents cd WHERE cd.brand_id = b.id AND cd.status = 'pending') AS docs_pending,
               (SELECT COUNT(*) FROM assets ast WHERE ast.brand_id = b.id) AS asset_count
        FROM brands b
        LEFT JOIN users o ON o.id = b.owner_id
        LEFT JOIN form_submissions fs ON fs.brand_id = b.id AND fs.kind = 'intake'
        LEFT JOIN projects p ON p.id = (SELECT p2.id FROM projects p2 WHERE p2.brand_id = b.id AND p2.kind = 'onboarding' ORDER BY p2.id DESC LIMIT 1)";

    public static function shape(array $c): array
    {
        $c['tags'] = $c['tags'] ? (json_decode($c['tags'], true) ?: []) : [];
        $c['profile'] = $c['profile'] ? ((object) (json_decode($c['profile'], true) ?: [])) : (object) [];
        return $c + Health::score($c);
    }

    public static function index(Request $r): array
    {
        $where = [];
        $params = [];
        if (!empty($r->query['status']) && in_array($r->query['status'], self::STATUSES, true)) {
            $where[] = 'b.status = ?';
            $params[] = $r->query['status'];
        }
        if (!empty($r->query['type']) && in_array($r->query['type'], ClientTypes::TYPES, true)) {
            $where[] = 'b.brand_type = ?';
            $params[] = $r->query['type'];
        }
        if (!empty($r->query['q'])) {
            $where[] = '(b.name LIKE ? OR b.contact_name LIKE ? OR b.email LIKE ? OR b.industry LIKE ? OR b.tags LIKE ?)';
            $like = '%' . $r->query['q'] . '%';
            array_push($params, $like, $like, $like, $like, $like);
        }
        $clients = array_map([self::class, 'shape'], Db::all(self::LIST_SQL . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY b.updated_at DESC', $params));
        $counts = array_column(Db::all('SELECT status, COUNT(*) AS n FROM brands GROUP BY status'), 'n', 'status');
        $types = array_column(Db::all('SELECT brand_type, COUNT(*) AS n FROM brands GROUP BY brand_type'), 'n', 'brand_type');
        return ['clients' => $clients, 'counts' => (object) $counts, 'types' => (object) $types];
    }

    public static function show(Request $r): array
    {
        $c = Db::one(self::LIST_SQL . ' WHERE b.id = ?', [$r->param('id')]);
        if (!$c) throw HttpException::notFound('Client');
        $c = self::shape($c);
        $c['projects'] = Db::all("SELECT id, name, status, started_at, completed_at FROM projects WHERE brand_id = ? AND kind = 'onboarding' ORDER BY id DESC", [$c['id']]);
        $c['team'] = ClientTeamController::teamFor((int) $c['id']);
        $c['activity'] = Activity::recent((int) $c['id'], 30);
        return $c;
    }

    /** Adds a client, prepares their intake form and starts their first project. */
    public static function store(Request $r): array
    {
        $data = Validator::validate($r->body, [
            'name' => 'required,max:160',
            'contact_name' => 'max:120',
            'email' => 'email,max:190',
            'phone' => 'max:40',
            'website' => 'max:255',
            'industry' => 'max:120',
            'brand_type' => 'required,in:' . implode('|', ClientTypes::TYPES),
            'template_id' => 'int',
            'blueprint_id' => 'int',
            'profile' => 'array',
        ]);
        // The client type picks the intake form and the project flow unless one is chosen explicitly.
        $data['template_id'] = $data['template_id']
            ?? Db::value('SELECT id FROM templates WHERE category = ? ORDER BY id LIMIT 1', [$data['brand_type']])
            ?? Db::value('SELECT id FROM templates ORDER BY id LIMIT 1');
        $data['blueprint_id'] = $data['blueprint_id']
            ?? Db::value('SELECT id FROM blueprints WHERE client_type = ? ORDER BY position, id LIMIT 1', [$data['brand_type']]);
        if (!$data['template_id']) throw HttpException::validation(['brand_type' => 'Create an intake form for this client type first.']);
        if (!$data['blueprint_id']) throw HttpException::validation(['brand_type' => 'Create a project type for this client type first.']);
        $data['profile'] = json_encode(ClientTypes::cleanProfile($data['brand_type'], (array) ($data['profile'] ?? [])));
        if (Db::value('SELECT id FROM brands WHERE name = ?', [$data['name']])) {
            throw HttpException::validation(['name' => 'You already have a client with this name.']);
        }
        $blueprintId = (int) $data['blueprint_id'];
        unset($data['blueprint_id']);
        $data['owner_id'] = $r->user['id'];
        $data['docs_token'] = bin2hex(random_bytes(20));

        $id = Db::transaction(function () use ($data, $blueprintId, $r) {
            $id = Db::insert('brands', $data + ['status' => 'new']);
            Forms::createSubmission((int) $data['template_id'], $id);
            Activity::log($id, $r->user['id'], 'client.created', "Added {$data['name']} as a client");
            Projects::create($id, $blueprintId, $r->user['id'], $r->user['id']);
            return $id;
        });
        self::syncToBrevo((int) $id);
        Workflows::fire('client.added', $id);
        $r->params['id'] = $id;
        return self::show($r);
    }

    public static function update(Request $r): array
    {
        $id = $r->param('id');
        if (!Db::value('SELECT id FROM brands WHERE id = ?', [$id])) throw HttpException::notFound('Client');
        $data = Validator::validate($r->body, [
            'name' => 'required,max:160',
            'contact_name' => 'max:120',
            'email' => 'email,max:190',
            'phone' => 'max:40',
            'website' => 'max:255',
            'industry' => 'max:120',
            'brand_type' => 'in:' . implode('|', ClientTypes::TYPES),
            'logo_url' => 'max:500',
            'owner_id' => 'int',
            'tags' => 'array',
            'profile' => 'array',
        ], true);
        if (array_key_exists('profile', $data)) {
            $type = $data['brand_type'] ?? Db::value('SELECT brand_type FROM brands WHERE id = ?', [$id]);
            $data['profile'] = json_encode(ClientTypes::cleanProfile($type, (array) $data['profile']));
        }
        if (!empty($data['logo_url']) && !preg_match('#^https?://#i', $data['logo_url'])) {
            throw HttpException::validation(['logo_url' => 'Paste an image link that starts with https://']);
        }
        if (array_key_exists('tags', $data)) {
            $tags = [];
            foreach ((array) $data['tags'] as $t) {
                $t = strtolower(trim((string) $t));
                if ($t === '') continue;
                if (!preg_match('/^[a-z0-9_-]{1,40}$/', $t)) throw HttpException::validation(['tags' => 'Tags use lowercase letters, numbers, - and _ only.']);
                $tags[$t] = true;
            }
            $data['tags'] = json_encode(array_keys($tags));
        }
        Db::update('brands', $id, $data);
        self::syncToBrevo((int) $id);
        return self::show($r);
    }

    /** Adds the client's contact to the Brevo list when "Sync clients to Brevo" is on. Never blocks saving. */
    private static function syncToBrevo(int $id): void
    {
        if (!\App\Services\Settings::bool('sync_clients') || !\App\Services\Brevo::connected()) return;
        try {
            [$ok, $res] = \App\Services\Brevo::syncClient(Db::one('SELECT * FROM brands WHERE id = ?', [$id]));
            if (!$ok) error_log("Brevo sync for client $id: $res");
        } catch (\Throwable $e) {
            error_log('Brevo sync: ' . $e->getMessage());
        }
    }

    public static function destroy(Request $r): void
    {
        Auth::requireAdmin($r);
        $id = $r->param('id');
        if (!Db::value('SELECT id FROM brands WHERE id = ?', [$id])) throw HttpException::notFound('Client');
        $base = __DIR__ . '/../../storage/uploads/';
        $dirs = array_merge(
            array_map(fn($s) => $base . (int) $s['id'], Db::all('SELECT id FROM form_submissions WHERE brand_id = ?', [$id])),
            [$base . 'assets/' . (int) $id, $base . 'client-docs/' . (int) $id],
            array_map(fn($d) => $base . 'deliverables/' . (int) $d['id'], Db::all('SELECT d.id FROM deliverables d JOIN projects p ON p.id = d.project_id WHERE p.brand_id = ?', [$id]))
        );
        foreach ($dirs as $dir) {
            foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
            @rmdir($dir);
        }
        Db::exec('DELETE FROM brands WHERE id = ?', [$id]);
    }
}
