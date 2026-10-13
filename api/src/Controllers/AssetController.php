<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Activity;

/** Client assets: Google Drive (or other) links and uploaded documents. Nothing else. */
class AssetController
{
    public const DOC_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'];
    public const CATEGORIES = ['brand', 'legal', 'product', 'access', 'other'];

    private const SQL = "
        SELECT a.id, a.brand_id, b.name AS brand_name, a.setup_item_id, a.kind, a.title, a.category, a.url,
               a.file_name, a.file_size, a.created_at, u.name AS added_by_name
        FROM assets a JOIN brands b ON b.id = a.brand_id LEFT JOIN users u ON u.id = a.added_by";

    public static function index(Request $r): array
    {
        $where = [];
        $params = [];
        if (!empty($r->query['client_id'])) { $where[] = 'a.brand_id = ?'; $params[] = (int) $r->query['client_id']; }
        if (!empty($r->query['kind']) && in_array($r->query['kind'], ['link', 'file'], true)) { $where[] = 'a.kind = ?'; $params[] = $r->query['kind']; }
        if (!empty($r->query['category']) && in_array($r->query['category'], self::CATEGORIES, true)) { $where[] = 'a.category = ?'; $params[] = $r->query['category']; }
        if (!empty($r->query['q'])) { $where[] = '(a.title LIKE ? OR b.name LIKE ?)'; $params[] = "%{$r->query['q']}%"; $params[] = "%{$r->query['q']}%"; }
        return Db::all(self::SQL . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY a.id DESC LIMIT 500', $params);
    }

    /** Multipart: title, category, and either url (link) or file (document). Optional setup_item_id. */
    public static function store(Request $r): array
    {
        $clientId = $r->param('id');
        if (!Db::value('SELECT id FROM brands WHERE id = ?', [$clientId])) throw HttpException::notFound('Client');
        $data = Validator::validate($r->body, [
            'title' => 'max:200',
            'category' => 'in:' . implode('|', self::CATEGORIES),
            'url' => 'max:500',
            'setup_item_id' => 'int',
        ]);
        $file = !empty($_FILES['file']) && $_FILES['file']['error'] !== UPLOAD_ERR_NO_FILE ? $_FILES['file'] : null;
        $url = $data['url'] ?? null;

        if (!$file && !$url) throw HttpException::validation(['url' => 'Paste a Drive link or choose a document.']);
        if ($url && !preg_match('#^https?://#i', $url)) throw HttpException::validation(['url' => 'Links start with http:// or https://']);
        if (!empty($data['setup_item_id'])) {
            $ok = Db::value('SELECT id FROM setup_items WHERE id = ? AND brand_id = ?', [$data['setup_item_id'], $clientId]);
            if (!$ok) throw HttpException::validation(['setup_item_id' => 'That checklist item belongs to another client.']);
        }

        $row = [
            'brand_id' => $clientId,
            'setup_item_id' => $data['setup_item_id'] ?? null,
            'category' => $data['category'] ?? 'other',
            'added_by' => $r->user['id'],
        ];
        if ($file) {
            $stored = self::storeDoc($clientId, $file);
            $row += ['kind' => 'file', 'file_name' => $stored['name'], 'file_path' => $stored['path'], 'file_size' => $stored['size'],
                     'title' => $data['title'] ?: pathinfo($stored['name'], PATHINFO_FILENAME)];
        } else {
            $row += ['kind' => 'link', 'url' => $url, 'title' => $data['title'] ?: self::linkTitle($url)];
        }
        $id = Db::insert('assets', $row);
        Activity::log($clientId, $r->user['id'], 'asset.added', ($row['kind'] === 'file' ? 'Uploaded ' : 'Added the link ') . $row['title']);
        return Db::one(self::SQL . ' WHERE a.id = ?', [$id]);
    }

    public static function destroy(Request $r): void
    {
        $a = Db::one('SELECT * FROM assets WHERE id = ?', [$r->param('id')]);
        if (!$a) throw HttpException::notFound('Asset');
        if ($a['file_path']) @unlink(__DIR__ . '/../../storage/uploads/' . $a['file_path']);
        Db::exec('DELETE FROM assets WHERE id = ?', [$a['id']]);
        Activity::log((int) $a['brand_id'], $r->user['id'], 'asset.removed', "Removed {$a['title']}");
    }

    public static function file(Request $r): void
    {
        $a = Db::one('SELECT file_name, file_path FROM assets WHERE id = ?', [$r->param('id')]);
        $base = realpath(__DIR__ . '/../../storage/uploads');
        $path = $a && $a['file_path'] ? realpath($base . '/' . $a['file_path']) : false;
        if (!$path || strpos($path, $base) !== 0 || !is_file($path)) throw HttpException::notFound('File');
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $a['file_name']) . '"');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    private static function storeDoc(int $clientId, array $file): array
    {
        if ($file['error'] !== UPLOAD_ERR_OK) throw new HttpException(422, 'The file did not upload. Please try again.');
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, self::DOC_EXT, true)) {
            throw new HttpException(422, 'Only documents can be uploaded (PDF, Word, Excel, PowerPoint, TXT, CSV). For images and videos, add a Drive link.');
        }
        $max = (int) config('upload_max_mb', 15) * 1024 * 1024;
        if ($file['size'] > $max) throw new HttpException(422, 'That document is over ' . config('upload_max_mb', 15) . ' MB. Add a Drive link instead.');
        $dir = __DIR__ . '/../../storage/uploads/assets/' . $clientId;
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $name = bin2hex(random_bytes(12)) . '.' . $ext;
        if (!move_uploaded_file($file['tmp_name'], "$dir/$name")) throw new HttpException(500, 'The file could not be saved.');
        return ['name' => mb_substr(basename($file['name']), 0, 200), 'path' => "assets/$clientId/$name", 'size' => (int) $file['size']];
    }

    private static function linkTitle(string $url): string
    {
        if (stripos($url, 'drive.google.com') !== false) return 'Google Drive folder';
        if (stripos($url, 'docs.google.com') !== false) return 'Google Doc';
        return (string) (parse_url($url, PHP_URL_HOST) ?: 'Link');
    }
}
