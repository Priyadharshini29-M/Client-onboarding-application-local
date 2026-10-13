<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Db;
use App\Core\HttpException;
use App\Core\RateLimit;
use App\Core\Request;
use App\Core\Validator;

class AuthController
{
    public static function login(Request $r): array
    {
        $data = Validator::validate($r->body, ['email' => 'required,email', 'password' => 'required']);
        $email = strtolower($data['email']);
        // Lock an email for 15 minutes after 8 wrong passwords from one place, or 20 from anywhere.
        $keyIp = 'login:' . RateLimit::ip() . '|' . $email;
        $keyAll = 'login:' . $email;
        if (RateLimit::blocked($keyIp, 8, 900) || RateLimit::blocked($keyAll, 20, 900)) {
            throw new HttpException(429, 'Too many wrong passwords. Wait 15 minutes, or ask your admin for a reset link.');
        }
        $user = Db::one('SELECT id, password_hash, is_active FROM users WHERE email = ?', [$email]);
        if (!$user || !password_verify((string) $data['password'], $user['password_hash'])) {
            RateLimit::add($keyIp, 900);
            RateLimit::add($keyAll, 900);
            usleep(300000); // slow down guessing
            throw new HttpException(401, 'That email and password do not match.');
        }
        RateLimit::clear($keyIp);
        if (!(int) $user['is_active']) throw new HttpException(403, 'This account is deactivated. Ask an admin to re-enable it.');

        Db::exec('DELETE FROM api_tokens WHERE expires_at < NOW()');
        $token = Auth::issueToken((int) $user['id']);
        return ['token' => $token, 'user' => Auth::userById((int) $user['id'])];
    }

    /** Public: who an invite or reset link is for (the /join page). */
    public static function inviteShow(Request $r): array
    {
        $inv = \App\Services\Invites::find((string) $r->params['token']);
        return ['name' => $inv['name'], 'email' => $inv['email'], 'purpose' => $inv['purpose'], 'role' => Auth::roleLabel($inv['role']),
                'team' => $inv['team_name'], 'expires_at' => $inv['expires_at']];
    }

    /** Public: set the password from an invite or reset link, and sign in. */
    public static function inviteAccept(Request $r): array
    {
        $data = Validator::validate($r->body, ['password' => 'required,max:200']);
        return \App\Services\Invites::accept((string) $r->params['token'], (string) $data['password']);
    }

    public static function me(Request $r): array
    {
        return ['user' => $r->user];
    }

    public static function logout(Request $r): void
    {
        if ($token = $r->bearerToken()) Auth::revoke($token);
    }
}
