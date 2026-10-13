<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Workflows;
use App\Services\Activity;

/** The internal setup checklist, and moving a client to retainer once it is complete. */
class SetupController
{
    private const STANDARD = [
        'Brand guidelines and logo files saved to the shared drive',
        'Website admin access checked',
        'Meta Business Suite access checked',
        'Google Analytics & Ads access checked',
        'Payment gateway access checked',
        'Domain and hosting logins stored safely',
        'Monthly scope and reporting day agreed with the client',
        'Retainer team assigned',
    ];

    public static function index(Request $r): array
    {
        self::client($r->param('id'));
        return self::items($r->param('id'));
    }

    public static function store(Request $r): array
    {
        $clientId = $r->param('id');
        self::client($clientId);
        $data = Validator::validate($r->body, ['title' => 'required,max:255', 'owner_id' => 'int', 'due_date' => 'date', 'note' => 'max:500']);
        $data += ['brand_id' => $clientId, 'position' => self::nextPosition($clientId)];
        Db::insert('setup_items', $data);
        return self::items($clientId);
    }

    public static function addStandard(Request $r): array
    {
        $clientId = $r->param('id');
        self::client($clientId);
        $have = array_map('strtolower', array_column(Db::all('SELECT title FROM setup_items WHERE brand_id = ?', [$clientId]), 'title'));
        $pos = self::nextPosition($clientId);
        foreach (self::STANDARD as $title) {
            if (in_array(strtolower($title), $have, true)) continue;
            Db::insert('setup_items', ['brand_id' => $clientId, 'title' => $title, 'position' => $pos++]);
        }
        return self::items($clientId);
    }

    public static function update(Request $r): array
    {
        $item = Db::one('SELECT * FROM setup_items WHERE id = ?', [$r->param('id')]);
        if (!$item) throw HttpException::notFound('Setup item');
        $data = Validator::validate($r->body, [
            'title' => 'required,max:255', 'done' => 'bool', 'status' => 'in:pending|in_progress|done',
            'owner_id' => 'int', 'due_date' => 'date', 'note' => 'max:500',
        ], true);
        if (array_key_exists('status', $data)) $data['done'] = $data['status'] === 'done' ? 1 : 0;
        elseif (array_key_exists('done', $data)) $data['status'] = $data['done'] ? 'done' : 'pending';
        if (array_key_exists('done', $data)) $data['done_at'] = $data['done'] ? date('Y-m-d H:i:s') : null;
        Db::update('setup_items', (int) $item['id'], $data);
        return self::items((int) $item['brand_id']);
    }

    public static function destroy(Request $r): void
    {
        Db::exec('DELETE FROM setup_items WHERE id = ?', [$r->param('id')]);
    }

    public static function toRetainer(Request $r): array
    {
        $clientId = $r->param('id');
        $client = self::client($clientId);
        if ($client['status'] === 'retainer') throw new HttpException(409, "{$client['name']} is already on retainer.");
        $total = (int) Db::value('SELECT COUNT(*) FROM setup_items WHERE brand_id = ?', [$clientId]);
        $open = (int) Db::value('SELECT COUNT(*) FROM setup_items WHERE brand_id = ? AND done = 0', [$clientId]);
        if ($total === 0) throw new HttpException(422, 'Add the setup checklist first.');
        if ($open > 0) throw new HttpException(422, "$open setup item" . ($open > 1 ? 's are' : ' is') . ' still open.');
        Db::exec("UPDATE brands SET status = 'retainer', retainer_at = NOW() WHERE id = ?", [$clientId]);
        Activity::log($clientId, $r->user['id'], 'client.retainer', "Moved {$client['name']} to retainer");
        Workflows::fire('client.retainer', (int) $clientId);
        return ['ok' => true];
    }

    private static function items(int $clientId): array
    {
        $items = Db::all(
            'SELECT s.id, s.title, s.status, s.done, s.owner_id, u.name AS owner_name, s.due_date, s.note, s.done_at
             FROM setup_items s LEFT JOIN users u ON u.id = s.owner_id WHERE s.brand_id = ? ORDER BY s.position, s.id',
            [$clientId]
        );
        $files = Db::all(
            'SELECT id, setup_item_id, kind, title, url, file_name, file_size FROM assets WHERE brand_id = ? AND setup_item_id IS NOT NULL ORDER BY id',
            [$clientId]
        );
        foreach ($items as &$item) {
            $item['attachments'] = array_values(array_filter($files, fn($f) => (int) $f['setup_item_id'] === (int) $item['id']));
        }
        return $items;
    }

    private static function nextPosition(int $clientId): int
    {
        return (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM setup_items WHERE brand_id = ?', [$clientId]);
    }

    private static function client(int $id): array
    {
        $c = Db::one('SELECT id, name, status FROM brands WHERE id = ?', [$id]);
        if (!$c) throw HttpException::notFound('Client');
        return $c;
    }
}
