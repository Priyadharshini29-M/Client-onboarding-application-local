<?php
declare(strict_types=1);

namespace App\Services;

/**
 * Brand health out of 100. Starts at 100 and loses points for things that need attention,
 * so the number always has a reason the team can act on.
 */
class Health
{
    public static function score(array $c): array
    {
        $reasons = [];
        $score = 100;
        $late = (int) ($c['late_count'] ?? 0);
        $blocked = (int) ($c['blocked_count'] ?? 0);
        $changes = (int) ($c['changes_count'] ?? 0);

        if ($late) { $p = min(40, $late * 10); $score -= $p; $reasons[] = "$late overdue task" . ($late > 1 ? 's' : ''); }
        if ($blocked) { $p = min(30, $blocked * 15); $score -= $p; $reasons[] = "$blocked blocked"; }
        if ($changes) { $p = min(15, $changes * 5); $score -= $p; $reasons[] = "$changes waiting on changes"; }
        if (($c['project_status'] ?? '') === 'on_hold') { $score -= 20; $reasons[] = 'project on hold'; }
        $intakeOpen = in_array($c['intake_status'] ?? '', ['not_sent', 'sent', 'in_progress'], true);
        if ($intakeOpen && strtotime((string) $c['created_at']) < strtotime('-7 days')) { $score -= 10; $reasons[] = 'intake form open for over a week'; }
        $pendingDocs = (int) ($c['docs_pending'] ?? 0);
        if ($pendingDocs && strtotime((string) $c['created_at']) < strtotime('-7 days')) { $score -= 5; $reasons[] = "$pendingDocs document" . ($pendingDocs > 1 ? 's' : '') . ' still missing'; }

        return ['health' => max(0, $score), 'health_reasons' => $reasons];
    }
}
