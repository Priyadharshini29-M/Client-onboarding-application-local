<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Db;

class Activity
{
    public static function log(?int $brandId, ?int $userId, string $action, string $message): void
    {
        Db::insert('activity_log', [
            'brand_id' => $brandId,
            'user_id' => $userId,
            'action' => $action,
            'message' => mb_substr($message, 0, 500),
        ]);
    }

    public static function recent(?int $brandId = null, int $limit = 20): array
    {
        $where = $brandId ? 'WHERE a.brand_id = ?' : '';
        $params = $brandId ? [$brandId] : [];
        return Db::all(
            "SELECT a.id, a.action, a.message, a.created_at, a.brand_id, b.name AS brand_name, u.name AS user_name
             FROM activity_log a
             LEFT JOIN users u ON u.id = a.user_id
             LEFT JOIN brands b ON b.id = a.brand_id
             $where ORDER BY a.id DESC LIMIT " . (int) $limit,
            $params
        );
    }
}
