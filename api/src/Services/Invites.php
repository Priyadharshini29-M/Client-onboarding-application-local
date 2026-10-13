<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;

/**
 * Invite and password-reset links. There is no public sign-up: an admin invites a person, they get a
 * private link (by email through Brevo, or copied by the admin) and choose their own password.
 * The same link type resets a password for someone who has already joined.
 * Only a SHA-256 hash of each link is stored; a link works once and expires after 7 days.
 */
class Invites
{
    public const DAYS = 7;

    /** Creates a fresh link for the person (older unused links stop working) and emails it. */
    public static function send(int $userId, ?array $by): array
    {
        $u = Db::one('SELECT u.id, u.name, u.email, u.role, u.joined_at, t.name AS team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ? AND u.is_active = 1', [$userId]);
        if (!$u) throw new HttpException(422, 'Only active people can get an invite. Turn their access back on first.');

        $raw = bin2hex(random_bytes(24));
        $expires = date('Y-m-d H:i:s', strtotime('+' . self::DAYS . ' days'));
        Db::exec('DELETE FROM user_invites WHERE user_id = ? AND used_at IS NULL', [$userId]);
        Db::insert('user_invites', [
            'user_id' => $userId, 'token_hash' => hash('sha256', $raw), 'purpose' => $u['joined_at'] ? 'reset' : 'join',
            'expires_at' => $expires, 'created_by' => $by['id'] ?? null,
        ]);

        $link = rtrim((string) config('app_url', ''), '/') . '/join/' . $raw;
        $first = explode(' ', trim($u['name']))[0];
        $until = date('j M Y', strtotime($expires));
        if ($u['joined_at']) {
            $subject = 'Reset your Brand OS password';
            $body = "Hi $first,\n\nUse this link to choose a new password for Brand OS:\n$link\n\nThe link works once and expires on $until. If you didn't ask for this, you can ignore it.";
        } else {
            $who = trim(($by['name'] ?? 'Your team') . '');
            $as = Auth::roleLabel($u['role']) . ($u['team_name'] ? " in {$u['team_name']}" : '');
            $subject = "$who invited you to Brand OS";
            $body = "Hi $first,\n\n$who invited you to Brand OS as $as.\n\nChoose your password and sign in here:\n$link\n\nThe link works once and expires on $until.";
        }
        [$status, $error] = Messenger::email([$u['email']], $subject, $body, ['kind' => $u['joined_at'] ? 'password_reset' : 'invite']);
        return ['link' => $link, 'email_status' => $status, 'email_error' => $error, 'expires_at' => $expires, 'purpose' => $u['joined_at'] ? 'reset' : 'join', 'email' => $u['email']];
    }

    /** The invite behind a link, or an error that explains what to do. */
    public static function find(string $raw): array
    {
        $row = Db::one(
            'SELECT i.*, u.name, u.email, u.role, u.is_active, t.name AS team_name
             FROM user_invites i JOIN users u ON u.id = i.user_id LEFT JOIN teams t ON t.id = u.team_id
             WHERE i.token_hash = ?', [hash('sha256', $raw)]
        );
        if (!$row) throw new HttpException(404, 'This link is not valid. Ask your admin for a new invite.');
        if ($row['used_at']) throw new HttpException(410, 'This link has already been used. Sign in with your email and password.');
        if (strtotime($row['expires_at']) < time()) throw new HttpException(410, 'This link has expired. Ask your admin to send a new one.');
        if (!(int) $row['is_active']) throw new HttpException(403, 'This account is turned off. Ask your admin.');
        return $row;
    }

    /** Sets the password, uses up the link and signs the person in. */
    public static function accept(string $raw, string $password): array
    {
        $inv = self::find($raw);
        if (mb_strlen($password) < 8) throw HttpException::validation(['password' => 'Use at least 8 characters.']);
        if (mb_strlen($password) > 200) throw HttpException::validation(['password' => 'Keep it under 200 characters.']);
        Db::transaction(function () use ($inv, $password) {
            Db::exec('UPDATE users SET password_hash = ?, joined_at = COALESCE(joined_at, NOW()) WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $inv['user_id']]);
            Db::exec('UPDATE user_invites SET used_at = NOW() WHERE id = ?', [$inv['id']]);
            Db::exec('DELETE FROM api_tokens WHERE user_id = ?', [$inv['user_id']]); // old sessions end when the password changes
        });
        return ['token' => Auth::issueToken((int) $inv['user_id']), 'user' => Auth::userById((int) $inv['user_id'])];
    }
}
