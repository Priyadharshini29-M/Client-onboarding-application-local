<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;

/** Monthly content calendar per client: one row per post. */
class ContentController
{
    private const RULES = [
        'post_date' => 'date', 'funnel' => 'in:top|mid|bot', 'one_liner' => 'max:255', 'concept' => 'max:120',
        'post_type' => 'max:60', 'concept_idea' => 'max:4000', 'copy' => 'max:4000', 'caption' => 'max:4000',
        'channels' => 'max:200', 'status' => 'in:pending|in_progress|ready|approved|live', 'assignee_id' => 'int',
        'output_due' => 'date', 'live_date' => 'date',
    ];

    private const SQL = 'SELECT c.*, u.name AS assignee_name, b.name AS brand_name
        FROM content_items c JOIN brands b ON b.id = c.brand_id LEFT JOIN users u ON u.id = c.assignee_id';

    public static function index(Request $r): array
    {
        $month = self::month($r->query['month'] ?? null);
        $where = ['c.month = ?'];
        $params = [$month];
        if ($r->param('id')) { $where[] = 'c.brand_id = ?'; $params[] = $r->param('id'); }
        elseif (!empty($r->query['client_id'])) { $where[] = 'c.brand_id = ?'; $params[] = (int) $r->query['client_id']; }
        $rows = Db::all(self::SQL . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY b.name, c.post_date IS NULL, c.post_date, c.position, c.id', $params);
        $summary = [];
        foreach (['pending', 'in_progress', 'ready', 'approved', 'live'] as $s) $summary[$s] = count(array_filter($rows, fn($x) => $x['status'] === $s));
        return ['month' => $month, 'rows' => $rows, 'summary' => $summary];
    }

    public static function store(Request $r): array
    {
        $clientId = $r->param('id');
        if (!Db::value('SELECT id FROM brands WHERE id = ?', [$clientId])) throw HttpException::notFound('Client');
        $month = self::month($r->input('month'));
        $data = Validator::validate($r->body, self::RULES);
        $count = (int) $r->input('count', 1);
        $count = max(1, min(31, $count));
        for ($i = 0; $i < $count; $i++) {
            Db::insert('content_items', $data + [
                'brand_id' => $clientId, 'month' => $month,
                'position' => (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM content_items WHERE brand_id = ? AND month = ?', [$clientId, $month]),
            ]);
        }
        $r->query['month'] = $month;
        return self::index($r);
    }

    public static function update(Request $r): array
    {
        $row = Db::one('SELECT * FROM content_items WHERE id = ?', [$r->param('id')]);
        if (!$row) throw HttpException::notFound('Post');
        $data = Validator::validate($r->body, self::RULES, true);
        Db::update('content_items', (int) $row['id'], $data);
        return Db::one(self::SQL . ' WHERE c.id = ?', [$row['id']]);
    }

    /** Bulk: set status on, or delete, several rows. */
    public static function bulk(Request $r): array
    {
        $data = Validator::validate($r->body, ['ids' => 'required,array', 'status' => 'in:pending|in_progress|ready|approved|live', 'delete' => 'bool']);
        $ids = array_values(array_filter(array_map('intval', (array) $data['ids'])));
        if (!$ids) return ['changed' => 0];
        $in = implode(',', array_fill(0, count($ids), '?'));
        if (!empty($data['delete'])) {
            $n = Db::exec("DELETE FROM content_items WHERE id IN ($in)", $ids);
        } elseif (!empty($data['status'])) {
            $n = Db::exec("UPDATE content_items SET status = ? WHERE id IN ($in)", array_merge([$data['status']], $ids));
        } else {
            throw HttpException::validation(['status' => 'Choose a status or delete.']);
        }
        return ['changed' => $n];
    }

    private static function month(?string $m): string
    {
        if ($m && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $m)) return $m;
        return date('Y-m');
    }
}
