<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Activity;
use App\Services\Workflows;

class TeamController
{
    public static function teams(Request $r): array
    {
        return Db::all(
            'SELECT t.id, t.name, t.slug, t.icon, COUNT(u.id) AS member_count
             FROM teams t LEFT JOIN users u ON u.team_id = t.id AND u.is_active = 1
             GROUP BY t.id ORDER BY t.position, t.name'
        );
    }

    public static function createTeam(Request $r): array
    {
        Auth::requireAdmin($r);
        $data = Validator::validate($r->body, ['name' => 'required,max:80', 'icon' => 'required,in:briefcase|palette|camera|megaphone|code|film|pen-tool|shopping-bag|users|headphones|bar-chart|mail|search|layout|pen-line|package']);
        $slug = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($data['name'])), '-') ?: 'team';
        if (Db::value('SELECT id FROM teams WHERE slug = ?', [$slug])) throw HttpException::validation(['name' => 'A team with this name already exists.']);
        Db::insert('teams', $data + ['slug' => $slug, 'position' => (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM teams')]);
        return self::teams($r);
    }

    public static function updateTeam(Request $r): array
    {
        Auth::requireAdmin($r);
        $data = Validator::validate($r->body, ['name' => 'required,max:80', 'icon' => 'in:briefcase|palette|camera|megaphone|code|film|pen-tool|shopping-bag|users|headphones|bar-chart|mail|search|layout|pen-line|package'], true);
        Db::update('teams', $r->param('id'), $data);
        return self::teams($r);
    }

    public static function deleteTeam(Request $r): array
    {
        Auth::requireAdmin($r);
        $id = $r->param('id');
        $people = (int) Db::value('SELECT COUNT(*) FROM users WHERE team_id = ?', [$id]);
        $stages = (int) Db::value('SELECT COUNT(*) FROM blueprint_stages WHERE team_id = ?', [$id]);
        if ($people || $stages) throw new HttpException(409, "Move its $people people and $stages project-type stages to another team first.");
        Db::exec('DELETE FROM teams WHERE id = ?', [$id]);
        return self::teams($r);
    }

    /** One department at a glance: its people, how busy each one is, and the clients it's working on now. */
    public static function overview(Request $r): array
    {
        $id = $r->param('id');
        $team = Db::one('SELECT id, name, icon FROM teams WHERE id = ?', [$id]);
        if (!$team) throw HttpException::notFound('Department');

        // Open = in an open stage of an active project and not yet approved.
        $open = "s.status = 'open' AND p.status = 'active' AND d.status <> 'approved'";
        $people = Db::all(
            "SELECT u.id, u.name, u.email, u.role,
                    COUNT(CASE WHEN $open THEN d.id END) AS open_tasks,
                    COUNT(CASE WHEN $open AND d.status = 'in_progress' THEN d.id END) AS in_progress,
                    COUNT(CASE WHEN $open AND d.status = 'in_review' THEN d.id END) AS waiting,
                    COUNT(CASE WHEN $open AND d.status = 'changes_requested' THEN d.id END) AS needs_changes,
                    COUNT(CASE WHEN $open AND d.due_date < CURDATE() THEN d.id END) AS overdue,
                    COUNT(CASE WHEN d.status = 'approved' AND d.updated_at >= NOW() - INTERVAL 30 DAY THEN d.id END) AS done_30
             FROM users u
             LEFT JOIN deliverables d ON d.assignee_id = u.id
             LEFT JOIN project_stages s ON s.id = d.stage_id
             LEFT JOIN projects p ON p.id = d.project_id
             WHERE u.team_id = ? AND u.is_active = 1
             GROUP BY u.id ORDER BY FIELD(u.role, 'super_admin','admin','creative_head','project_manager','tech_lead','member'), u.name",
            [$id]
        );
        $leads = Db::all(
            'SELECT ct.user_id, b.id, b.name FROM client_team ct JOIN brands b ON b.id = ct.brand_id WHERE ct.team_id = ? ORDER BY b.name',
            [$id]
        );
        foreach ($people as &$u) {
            $u['clients'] = array_values(array_map(fn($l) => ['id' => (int) $l['id'], 'name' => $l['name']],
                array_filter($leads, fn($l) => (int) $l['user_id'] === (int) $u['id'])));
        }
        unset($u);

        $clients = Db::all(
            "SELECT b.id, b.name, b.brand_type, s.name AS stage_name, s.due_date,
                    COUNT(d.id) AS tasks,
                    COUNT(CASE WHEN d.status = 'approved' THEN 1 END) AS done,
                    COUNT(CASE WHEN d.status = 'in_review' THEN 1 END) AS waiting,
                    COUNT(CASE WHEN d.status <> 'approved' AND d.assignee_id IS NULL THEN 1 END) AS unassigned,
                    lu.name AS lead_name
             FROM project_stages s
             JOIN projects p ON p.id = s.project_id AND p.status = 'active'
             JOIN brands b ON b.id = p.brand_id
             LEFT JOIN deliverables d ON d.stage_id = s.id
             LEFT JOIN client_team ct ON ct.brand_id = b.id AND ct.team_id = s.team_id
             LEFT JOIN users lu ON lu.id = ct.user_id
             WHERE s.team_id = ? AND s.status = 'open'
             GROUP BY s.id ORDER BY s.due_date IS NULL, s.due_date, b.name",
            [$id]
        );

        $totals = Db::one(
            "SELECT COUNT(*) AS open_tasks,
                    COUNT(CASE WHEN d.assignee_id IS NULL THEN 1 END) AS unassigned,
                    COUNT(CASE WHEN d.status = 'in_review' THEN 1 END) AS waiting,
                    COUNT(CASE WHEN d.due_date < CURDATE() THEN 1 END) AS overdue
             FROM deliverables d JOIN project_stages s ON s.id = d.stage_id JOIN projects p ON p.id = d.project_id
             WHERE s.team_id = ? AND $open",
            [$id]
        );

        return ['team' => $team, 'people' => $people, 'clients' => $clients, 'totals' => $totals];
    }

    public static function users(Request $r): array
    {
        $activeOnly = ($r->query['all'] ?? '') !== '1';
        return Db::all(
            'SELECT u.id, u.name, u.email, u.phone, u.role, u.team_id, t.name AS team_name, u.is_active, u.created_at, u.joined_at,
                    (SELECT MAX(i.expires_at) FROM user_invites i WHERE i.user_id = u.id AND i.used_at IS NULL) AS invite_expires_at,
                    (SELECT MAX(i.created_at) FROM user_invites i WHERE i.user_id = u.id AND i.purpose = \'join\') AS invited_at
             FROM users u LEFT JOIN teams t ON t.id = u.team_id '
            . ($activeOnly ? 'WHERE u.is_active = 1 ' : '')
            . 'ORDER BY u.is_active DESC, u.name'
        );
    }

    public static function createUser(Request $r): array
    {
        Auth::requireAdmin($r);
        $data = Validator::validate($r->body, [
            'name' => 'required,max:120',
            'email' => 'required,email,max:190',
            'phone' => 'max:40',
            'password' => 'max:200',
            'role' => 'required,in:' . implode('|', Auth::ROLES),
            'team_id' => 'int',
        ]);
        self::guardRole($r, $data['role']);
        // No password means an invite: the person chooses their own through the link.
        $password = trim((string) ($data['password'] ?? ''));
        if ($password !== '' && mb_strlen($password) < 8) throw HttpException::validation(['password' => 'Use at least 8 characters.']);
        $email = strtolower($data['email']);
        if (Db::value('SELECT id FROM users WHERE email = ?', [$email])) {
            throw HttpException::validation(['email' => 'Someone already uses this email.']);
        }
        $id = Db::insert('users', [
            'name' => $data['name'],
            'email' => $email,
            'password_hash' => $password !== '' ? password_hash($password, PASSWORD_DEFAULT) : '',
            'joined_at' => $password !== '' ? date('Y-m-d H:i:s') : null,
            'role' => $data['role'],
            'team_id' => $data['team_id'] ?? null,
            'phone' => $data['phone'] ?? null,
        ]);
        // Invited people get a link to choose their own password (emailed through Brevo, and shown to the admin to copy).
        return ['id' => $id, 'invite' => $password === '' ? \App\Services\Invites::send($id, $r->user) : null];
    }

    public static function updateUser(Request $r): array
    {
        Auth::requireAdmin($r);
        $id = $r->param('id');
        $target = Db::one('SELECT id, role FROM users WHERE id = ?', [$id]);
        if (!$target) throw HttpException::notFound('User');
        $data = Validator::validate($r->body, [
            'name' => 'required,max:120',
            'phone' => 'max:40',
            'role' => 'required,in:' . implode('|', Auth::ROLES),
            'team_id' => 'int',
            'is_active' => 'bool',
            'password' => 'max:200',
        ], true);
        if (isset($data['role'])) self::guardRole($r, $data['role']);
        if ($target['role'] === 'super_admin' && $r->user['role'] !== 'super_admin') {
            throw HttpException::forbidden('Only a super admin can edit another super admin.');
        }
        if ($id === $r->user['id'] && isset($data['is_active']) && !$data['is_active']) {
            throw new HttpException(422, 'You cannot deactivate your own account.');
        }
        if (!empty($data['password'])) {
            if (mb_strlen($data['password']) < 8) throw HttpException::validation(['password' => 'Use at least 8 characters.']);
            $data['password_hash'] = password_hash($data['password'], PASSWORD_DEFAULT);
            Db::exec('DELETE FROM api_tokens WHERE user_id = ?', [$id]);
        }
        unset($data['password']);
        Db::update('users', $id, $data);
        if (isset($data['is_active']) && !$data['is_active']) Db::exec('DELETE FROM api_tokens WHERE user_id = ?', [$id]);
        return ['ok' => true];
    }

    /** Sends a new invite link (or a password-reset link to someone who has already joined). */
    public static function sendInvite(Request $r): array
    {
        Auth::requireAdmin($r);
        $u = Db::one('SELECT id, role FROM users WHERE id = ?', [$r->param('id')]);
        if (!$u) throw HttpException::notFound('Person');
        if ($u['role'] === 'super_admin' && $r->user['role'] !== 'super_admin' && (int) $u['id'] !== (int) $r->user['id']) {
            throw HttpException::forbidden('Only an Owner can send a link to another Owner.');
        }
        return \App\Services\Invites::send((int) $u['id'], $r->user);
    }

    /** What removing this person would affect, so the admin can hand it over first. */
    public static function removalPreview(Request $r): array
    {
        Auth::requireAdmin($r);
        $u = self::removable($r);
        $id = (int) $u['id'];
        return [
            'person' => ['id' => $id, 'name' => $u['name'], 'role' => $u['role'], 'team_id' => $u['team_id'] ? (int) $u['team_id'] : null],
            'open_tasks' => (int) Db::value("SELECT COUNT(*) FROM deliverables WHERE assignee_id = ? AND status <> 'approved'", [$id]),
            'waiting_approval' => (int) Db::value("SELECT COUNT(*) FROM deliverables WHERE assignee_id = ? AND status = 'in_review'", [$id]),
            'leads' => Db::all('SELECT b.id, b.name AS client, t.name AS department FROM client_team ct JOIN brands b ON b.id = ct.brand_id JOIN teams t ON t.id = ct.team_id WHERE ct.user_id = ? ORDER BY b.name', [$id]),
            'managed_clients' => (int) Db::value('SELECT COUNT(*) FROM brands WHERE owner_id = ?', [$id]),
            'open_content' => (int) Db::value("SELECT COUNT(*) FROM content_items WHERE assignee_id = ? AND status <> 'live'", [$id]),
            'setup_items' => (int) Db::value('SELECT COUNT(*) FROM setup_items WHERE owner_id = ? AND done = 0', [$id]),
            'suggested' => Db::all(
                'SELECT id, name, team_id FROM users WHERE is_active = 1 AND id <> ? ORDER BY (team_id <=> ?) DESC, name',
                [$id, $u['team_id']]
            ),
        ];
    }

    /**
     * Removes a person. Their open work (tasks, client-lead spots, managed clients, content, setup items) goes to
     * `hand_to` when given, otherwise it is left unassigned. Past work and history are kept, without their name.
     */
    public static function removeUser(Request $r): array
    {
        Auth::requireAdmin($r);
        $u = self::removable($r);
        $id = (int) $u['id'];
        $data = Validator::validate($r->body, ['hand_to' => 'int']);
        $to = null;
        if (!empty($data['hand_to'])) {
            $to = Db::one('SELECT id, name FROM users WHERE id = ? AND is_active = 1', [$data['hand_to']]);
            if (!$to || (int) $to['id'] === $id) throw HttpException::validation(['hand_to' => 'Choose an active person to hand the work to.']);
        }

        $moved = Db::transaction(function () use ($id, $u, $to, $r) {
            $moved = ['tasks' => 0, 'leads' => 0, 'clients' => 0];
            $clients = array_column(Db::all(
                "SELECT DISTINCT p.brand_id FROM deliverables d JOIN projects p ON p.id = d.project_id WHERE d.assignee_id = ? AND d.status <> 'approved'
                 UNION SELECT brand_id FROM client_team WHERE user_id = ? UNION SELECT id FROM brands WHERE owner_id = ?", [$id, $id, $id]
            ), 'brand_id');
            if ($to) {
                $tid = (int) $to['id'];
                $moved['tasks'] = Db::exec("UPDATE deliverables SET assignee_id = ? WHERE assignee_id = ? AND status <> 'approved'", [$tid, $id]);
                $moved['leads'] = Db::exec('UPDATE client_team SET user_id = ?, assigned_at = NOW() WHERE user_id = ?', [$tid, $id]);
                $moved['clients'] = Db::exec('UPDATE brands SET owner_id = ? WHERE owner_id = ?', [$tid, $id]);
                Db::exec('UPDATE projects SET owner_id = ? WHERE owner_id = ?', [$tid, $id]);
                Db::exec("UPDATE content_items SET assignee_id = ? WHERE assignee_id = ? AND status <> 'live'", [$tid, $id]);
                Db::exec('UPDATE setup_items SET owner_id = ? WHERE owner_id = ? AND done = 0', [$tid, $id]);
            }
            foreach ($clients as $cid) {
                Activity::log((int) $cid, $r->user['id'], 'person.removed',
                    "Removed {$u['name']} from the team" . ($to ? "; their work on this client went to {$to['name']}" : '; their open work here is now unassigned'));
            }
            Db::exec('DELETE FROM users WHERE id = ?', [$id]); // sessions, lead spots and notifications go with them; history keeps the rows
            return $moved;
        });

        if ($to && array_sum($moved) > 0) {
            Workflows::notifyUsers(Db::all('SELECT id, name, email FROM users WHERE id = ?', [$to['id']]),
                "You've taken over {$u['name']}'s work",
                trim(($moved['tasks'] ? "{$moved['tasks']} open task" . ($moved['tasks'] === 1 ? '' : 's') . '. ' : '')
                    . ($moved['leads'] ? "Client lead on {$moved['leads']} client" . ($moved['leads'] === 1 ? '' : 's') . '. ' : '')
                    . ($moved['clients'] ? "Manager of {$moved['clients']} client" . ($moved['clients'] === 1 ? '' : 's') . '.' : '')),
                '/teams', null, true);
        }
        return ['removed' => $u['name'], 'handed_to' => $to['name'] ?? null, 'moved' => $moved];
    }

    /** The person to remove, after the safety checks. */
    private static function removable(Request $r): array
    {
        $u = Db::one('SELECT id, name, role, team_id, is_active FROM users WHERE id = ?', [$r->param('id')]);
        if (!$u) throw HttpException::notFound('Person');
        if ((int) $u['id'] === (int) $r->user['id']) throw new HttpException(422, "You can't remove yourself. Ask another admin.");
        if ($u['role'] === 'super_admin') {
            if ($r->user['role'] !== 'super_admin') throw HttpException::forbidden('Only an Owner can remove another Owner.');
            $owners = (int) Db::value("SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND is_active = 1 AND id <> ?", [$u['id']]);
            if ($owners === 0) throw new HttpException(422, 'This is the last Owner. Make someone else an Owner first.');
        }
        return $u;
    }

    private static function guardRole(Request $r, string $role): void
    {
        if ($role === 'super_admin' && $r->user['role'] !== 'super_admin') {
            throw HttpException::forbidden('Only a super admin can create another super admin.');
        }
    }
}
