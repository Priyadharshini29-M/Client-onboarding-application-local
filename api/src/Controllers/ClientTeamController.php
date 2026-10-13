<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Activity;

/** Who looks after a client on each team: one person per team. */
class ClientTeamController
{
    public static function teamFor(int $clientId): array
    {
        return Db::all(
            'SELECT t.id AS team_id, t.name AS team_name, t.icon, ct.user_id, u.name AS user_name, ct.assigned_at
             FROM teams t
             LEFT JOIN client_team ct ON ct.team_id = t.id AND ct.brand_id = ?
             LEFT JOIN users u ON u.id = ct.user_id
             ORDER BY t.position, t.name',
            [$clientId]
        );
    }

    public static function index(Request $r): array
    {
        return self::teamFor($r->param('id'));
    }

    /** The project as a chain of departments, and whether handoff notifications are on. */
    public static function handoff(Request $r): array
    {
        $id = (int) $r->param('id');
        if (!Db::value('SELECT id FROM brands WHERE id = ?', [$id])) throw HttpException::notFound('Client');
        return ['auto_handoff' => \App\Services\Handoff::enabled($id), 'chain' => \App\Services\Handoff::chain($id)];
    }

    public static function setHandoff(Request $r): array
    {
        $id = (int) $r->param('id');
        $name = Db::value('SELECT name FROM brands WHERE id = ?', [$id]);
        if (!$name) throw HttpException::notFound('Client');
        $data = Validator::validate($r->body, ['auto_handoff' => 'required,bool']);
        Db::exec('UPDATE brands SET auto_handoff = ? WHERE id = ?', [$data['auto_handoff'], $id]);
        Activity::log($id, $r->user['id'], 'handoff.setting', $data['auto_handoff'] ? 'Turned on automatic handoff' : 'Turned off automatic handoff');
        return self::handoff($r);
    }

    public static function assign(Request $r): array
    {
        $clientId = $r->param('id');
        $teamId = $r->param('team');
        $client = Db::one('SELECT id, name FROM brands WHERE id = ?', [$clientId]);
        $team = Db::one('SELECT id, name FROM teams WHERE id = ?', [$teamId]);
        if (!$client || !$team) throw HttpException::notFound('Client or team');
        $data = Validator::validate($r->body, ['user_id' => 'int']);

        if (empty($data['user_id'])) {
            Db::exec('DELETE FROM client_team WHERE brand_id = ? AND team_id = ?', [$clientId, $teamId]);
            Activity::log($clientId, $r->user['id'], 'team.unassigned', "Removed the {$team['name']} lead");
        } else {
            $user = Db::one('SELECT id, name FROM users WHERE id = ? AND is_active = 1', [$data['user_id']]);
            if (!$user) throw HttpException::validation(['user_id' => 'Choose an active team member.']);
            Db::exec(
                'INSERT INTO client_team (brand_id, team_id, user_id) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), assigned_at = NOW()',
                [$clientId, $teamId, $user['id']]
            );
            Activity::log($clientId, $r->user['id'], 'team.assigned', "Made {$user['name']} the {$team['name']} lead");
            \App\Services\Handoff::leadChanged((int) $clientId, (int) $teamId, (int) $user['id']);
        }
        return self::teamFor($clientId);
    }
}
