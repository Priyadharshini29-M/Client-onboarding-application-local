<?php
declare(strict_types=1);

namespace App\Core;

class Auth
{
    public const ROLES = ['super_admin', 'admin', 'creative_head', 'project_manager', 'tech_lead', 'member'];

    private const ROLE_LABELS = [
        'super_admin' => 'Owner',
        'admin' => 'Admin',
        'creative_head' => 'Creative Head',
        'project_manager' => 'Project Manager',
        'tech_lead' => 'Tech Lead',
        'member' => 'Team member',
    ];

    public static function roleLabel(string $role): string
    {
        if ($role === 'auto') return 'No approval needed';
        return self::ROLE_LABELS[$role] ?? $role;
    }

    public static function issueToken(int $userId): string
    {
        $token = bin2hex(random_bytes(32));
        Db::insert('api_tokens', [
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token),
            'expires_at' => date('Y-m-d H:i:s', strtotime('+' . (int) config('token_ttl_days', 14) . ' days')),
        ]);
        return $token;
    }

    public static function revoke(string $token): void
    {
        Db::exec('DELETE FROM api_tokens WHERE token_hash = ?', [hash('sha256', $token)]);
    }

    private const USER_COLUMNS = 'u.id, u.name, u.email, u.role, u.team_id, t.name AS team_name';

    public static function requireUser(Request $request): array
    {
        $token = $request->bearerToken();
        if (!$token) throw new HttpException(401, 'Please sign in to continue.');
        $user = Db::one(
            'SELECT ' . self::USER_COLUMNS . '
             FROM api_tokens k JOIN users u ON u.id = k.user_id LEFT JOIN teams t ON t.id = u.team_id
             WHERE k.token_hash = ? AND k.expires_at > NOW() AND u.is_active = 1',
            [hash('sha256', $token)]
        );
        if (!$user) throw new HttpException(401, 'Your session has expired. Please sign in again.');
        return self::normalize($user);
    }

    public static function userById(int $id): array
    {
        $user = Db::one('SELECT ' . self::USER_COLUMNS . ' FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?', [$id]);
        if (!$user) throw HttpException::notFound('User');
        return self::normalize($user);
    }

    private static function normalize(array $user): array
    {
        $user['id'] = (int) $user['id'];
        $user['team_id'] = $user['team_id'] !== null ? (int) $user['team_id'] : null;
        return $user;
    }

    public static function isAdmin(array $user): bool
    {
        return in_array($user['role'], ['super_admin', 'admin'], true);
    }

    public static function requireAdmin(Request $request): void
    {
        if (!self::isAdmin($request->user)) throw HttpException::forbidden('Only admins can do this.');
    }

    /** Admins can sign off anything; everyone else only stages assigned to their role. */
    public static function canApprove(array $user, string $approverRole): bool
    {
        return self::isAdmin($user) || $user['role'] === $approverRole;
    }
}
