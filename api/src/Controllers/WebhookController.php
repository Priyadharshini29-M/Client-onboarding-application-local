<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Db;
use App\Core\HttpException;
use App\Core\Request;

class WebhookController
{
    /**
     * digihrms calls this when a task linked to a Brand OS deliverable changes status there
     * (see brandos_sync_helper.php in the digihrms repo). Authenticated by a shared secret in
     * the body, not a bearer token, since the caller is a server, not a signed-in person.
     *
     * HRMS's "Done" only moves the task to review, not approved — Brand OS's own approval flow
     * (versions, comments, sign-off) still owns what "approved" means, the same guard the old
     * DigiOps/HRMS sync used to protect fill-link and collateral requirements.
     */
    public static function hrmsTaskStatus(Request $r): array
    {
        if (!hash_equals((string) config('hrms.webhook_secret', ''), (string) ($r->body['secret'] ?? ''))) {
            throw new HttpException(401, 'Invalid webhook secret.');
        }
        $id = (int) ($r->body['deliverable_id'] ?? 0);
        $status = (string) ($r->body['status'] ?? '');
        $d = Db::one('SELECT d.id, d.status, s.status AS stage_status FROM deliverables d JOIN project_stages s ON s.id = d.stage_id WHERE d.id = ?', [$id]);
        if (!$d) throw new HttpException(404, 'Task not found.');
        if ($d['stage_status'] === 'locked') return ['ok' => true, 'skipped' => 'stage not open'];

        if ($status === 'BLOCKED') {
            Db::update('deliverables', $id, ['blocked' => 1, 'block_type' => 'action', 'block_reason' => 'Blocked in HRMS', 'blocked_at' => date('Y-m-d H:i:s')]);
            return ['ok' => true];
        }
        $map = ['TODO' => 'not_started', 'IN_PROGRESS' => 'in_progress', 'REVIEW' => 'in_review', 'DONE' => 'in_review', 'REWORK' => 'changes_requested'];
        $opsStatus = $map[$status] ?? null;
        if (!$opsStatus || !in_array($d['status'], ['not_started', 'in_progress', 'in_review', 'changes_requested'], true) || $d['status'] === $opsStatus) {
            return ['ok' => true, 'skipped' => 'no-op'];
        }
        Db::update('deliverables', $id, ['status' => $opsStatus]);
        return ['ok' => true];
    }
}
