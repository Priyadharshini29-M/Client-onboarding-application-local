<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;
use App\Services\Activity;

/**
 * Documents we need from the client (GST certificate, PAN, cancelled cheque...).
 * The team keeps the list; the client uploads through a private link without signing in.
 */
class DocumentController
{
    private const STANDARD = [
        'GST certificate', 'PAN card', 'Cancelled cheque', 'Logo files (AI / SVG / PNG)',
        'Brand guidelines (if any)', 'Product catalogue', 'Trademark certificate (if any)',
    ];
    private const EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'ai', 'eps', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'zip'];

    // Team -------------------------------------------------------------------------------------------

    public static function index(Request $r): array
    {
        $client = self::client($r->param('id'));
        return self::payload($client);
    }

    public static function store(Request $r): array
    {
        $client = self::client($r->param('id'));
        $data = Validator::validate($r->body, ['name' => 'required,max:200', 'due_date' => 'date']);
        $data += ['brand_id' => $client['id'], 'position' => self::nextPos((int) $client['id'])];
        Db::insert('client_documents', $data);
        return self::payload($client);
    }

    public static function addStandard(Request $r): array
    {
        $client = self::client($r->param('id'));
        $have = array_map('strtolower', array_column(Db::all('SELECT name FROM client_documents WHERE brand_id = ?', [$client['id']]), 'name'));
        $pos = self::nextPos((int) $client['id']);
        foreach (self::STANDARD as $name) {
            if (!in_array(strtolower($name), $have, true)) Db::insert('client_documents', ['brand_id' => $client['id'], 'name' => $name, 'position' => $pos++]);
        }
        return self::payload($client);
    }

    public static function update(Request $r): array
    {
        $doc = self::doc($r->param('id'));
        $data = Validator::validate($r->body, ['name' => 'required,max:200', 'status' => 'in:pending|uploaded|approved', 'due_date' => 'date'], true);
        Db::update('client_documents', (int) $doc['id'], $data);
        if (($data['status'] ?? null) === 'approved') Activity::log((int) $doc['brand_id'], $r->user['id'], 'document.approved', "Accepted {$doc['name']}");
        return self::payload(self::client((int) $doc['brand_id']));
    }

    public static function destroy(Request $r): void
    {
        $doc = self::doc($r->param('id'));
        if ($doc['file_path']) @unlink(self::base() . $doc['file_path']);
        Db::exec('DELETE FROM client_documents WHERE id = ?', [$doc['id']]);
    }

    /** Staff can also upload on the client's behalf. */
    public static function upload(Request $r): array
    {
        $doc = self::doc($r->param('id'));
        self::store_file($doc, $_FILES['file'] ?? null, $r->user['id']);
        return self::payload(self::client((int) $doc['brand_id']));
    }

    public static function file(Request $r): void
    {
        $doc = self::doc($r->param('id'));
        $path = $doc['file_path'] ? realpath(self::base() . $doc['file_path']) : false;
        $base = realpath(self::base());
        if (!$path || strpos($path, $base) !== 0) throw HttpException::notFound('File');
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $doc['file_name']) . '"');
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    // Client (private link, no sign-in) ----------------------------------------------------------------

    public static function publicShow(Request $r): array
    {
        $client = self::byToken((string) $r->params['token']);
        $items = Db::all('SELECT id, name, status, due_date, file_name, file_size, uploaded_at FROM client_documents WHERE brand_id = ? ORDER BY position, id', [$client['id']]);
        return ['brand' => ['name' => $client['name']], 'items' => $items];
    }

    public static function publicUpload(Request $r): array
    {
        $client = self::byToken((string) $r->params['token']);
        $doc = Db::one('SELECT * FROM client_documents WHERE id = ? AND brand_id = ?', [(int) $r->params['doc'], $client['id']]);
        if (!$doc) throw HttpException::notFound('Document');
        if ($doc['status'] === 'approved') throw new HttpException(409, 'This document has already been accepted by the team.');
        self::store_file($doc, $_FILES['file'] ?? null, null);
        return self::publicShow($r);
    }

    // Helpers ---------------------------------------------------------------------------------------------

    private static function store_file(array $doc, ?array $file, ?int $userId): void
    {
        if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) throw new HttpException(422, 'The file did not upload. Please try again.');
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, self::EXT, true)) throw new HttpException(422, 'Use PDF, an image, Word, Excel, CSV, AI/EPS or ZIP.');
        $max = (int) config('upload_max_mb', 15) * 1024 * 1024;
        if ($file['size'] > $max) throw new HttpException(422, 'That file is over ' . config('upload_max_mb', 15) . ' MB.');
        $dir = self::base() . 'client-docs/' . (int) $doc['brand_id'];
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $name = bin2hex(random_bytes(12)) . '.' . $ext;
        if (!move_uploaded_file($file['tmp_name'], "$dir/$name")) throw new HttpException(500, 'The file could not be saved.');
        if ($doc['file_path']) @unlink(self::base() . $doc['file_path']);
        Db::update('client_documents', (int) $doc['id'], [
            'file_name' => mb_substr(basename($file['name']), 0, 200), 'file_path' => 'client-docs/' . (int) $doc['brand_id'] . "/$name",
            'file_size' => (int) $file['size'], 'uploaded_at' => date('Y-m-d H:i:s'), 'status' => 'uploaded',
        ]);
        Activity::log((int) $doc['brand_id'], $userId, 'document.uploaded', "Uploaded {$doc['name']}");
        if ($userId === null) {
            $owner = Db::all('SELECT u.id, u.name, u.email FROM brands b JOIN users u ON u.id = b.owner_id WHERE b.id = ?', [$doc['brand_id']]);
            $brandName = (string) Db::value('SELECT name FROM brands WHERE id = ?', [$doc['brand_id']]);
            \App\Services\Workflows::notifyUsers($owner, "$brandName uploaded {$doc['name']}", 'Check it on their Onboarding tab.', "/clients/{$doc['brand_id']}", (int) $doc['brand_id'], true);
        }
    }

    private static function payload(array $client): array
    {
        if (!$client['docs_token']) {
            $client['docs_token'] = bin2hex(random_bytes(20));
            Db::update('brands', (int) $client['id'], ['docs_token' => $client['docs_token']]);
        }
        return [
            'link' => rtrim((string) config('app_url'), '/') . '/documents/' . $client['docs_token'],
            'items' => Db::all('SELECT id, name, status, due_date, file_name, file_size, uploaded_at FROM client_documents WHERE brand_id = ? ORDER BY position, id', [$client['id']]),
        ];
    }

    private static function client(int $id): array
    {
        $c = Db::one('SELECT id, name, docs_token FROM brands WHERE id = ?', [$id]);
        if (!$c) throw HttpException::notFound('Client');
        return $c;
    }

    private static function byToken(string $token): array
    {
        $c = Db::one('SELECT id, name FROM brands WHERE docs_token = ?', [$token]);
        if (!$c) throw HttpException::notFound('Link');
        return $c;
    }

    private static function doc(int $id): array
    {
        $d = Db::one('SELECT * FROM client_documents WHERE id = ?', [$id]);
        if (!$d) throw HttpException::notFound('Document');
        return $d;
    }

    private static function nextPos(int $clientId): int
    {
        return (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM client_documents WHERE brand_id = ?', [$clientId]);
    }

    private static function base(): string
    {
        return __DIR__ . '/../../storage/uploads/';
    }
}
