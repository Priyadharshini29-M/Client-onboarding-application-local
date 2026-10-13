<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Db;
use App\Core\HttpException;
use App\Core\RateLimit;
use App\Core\Request;
use App\Services\Workflows;
use App\Services\Activity;
use App\Services\Autofill;
use App\Services\Forms;

/** The client intake form: the team's view, and the private link the client opens. */
class FormController
{
    // Team ----------------------------------------------------------------------------------

    public static function clientIntake(Request $r): array
    {
        return Forms::payload(self::intakeFor($r->param('id')), true);
    }

    /** Marks the form as shared and returns the link. Sending it (email, WhatsApp) stays with the team. */
    public static function share(Request $r): array
    {
        $sub = self::intakeFor($r->param('id'));
        if ($sub['status'] === 'not_sent') {
            Db::exec("UPDATE form_submissions SET status = 'sent' WHERE id = ?", [$sub['id']]);
            self::syncIntakeDeliverable((int) $sub['brand_id'], 'in_progress');
            Activity::log((int) $sub['brand_id'], $r->user['id'], 'intake.shared', 'Shared the intake form with the client');
        }
        return Forms::payload(Forms::submissionById((int) $sub['id']), true);
    }

    public static function save(Request $r): array
    {
        $sub = Forms::submissionById($r->param('id'));
        Forms::saveValues($sub, (array) $r->input('values', []));
        return Forms::payload(Forms::submissionById((int) $sub['id']), true);
    }

    public static function upload(Request $r): array
    {
        return Forms::upload(Forms::submissionById($r->param('id')), $r->param('field'), $_FILES['file'] ?? null);
    }

    public static function download(Request $r): void
    {
        Forms::streamFile(Forms::submissionById($r->param('id')), $r->param('field'));
    }

    /** "Fill from a document" for the team: returns suggested answers, saves nothing. */
    public static function autofill(Request $r): array
    {
        $sub = Forms::submissionById($r->param('id'));
        return Autofill::suggest(Forms::template((int) $sub['template_id']), (string) $r->input('text', ''));
    }

    public static function reopen(Request $r): array
    {
        $sub = Forms::submissionById($r->param('id'));
        Db::exec("UPDATE form_submissions SET status = 'in_progress', submitted_at = NULL WHERE id = ?", [$sub['id']]);
        self::syncIntakeDeliverable((int) $sub['brand_id'], 'in_progress');
        Activity::log((int) $sub['brand_id'], $r->user['id'], 'intake.reopened', 'Reopened the intake form for the client');
        return Forms::payload(Forms::submissionById((int) $sub['id']), true);
    }

    // Client (no sign-in) -----------------------------------------------------------------------

    public static function publicShow(Request $r): array
    {
        return Forms::payload(Forms::submissionByToken((string) $r->params['token']), false);
    }

    public static function publicSave(Request $r): array
    {
        $sub = self::editable((string) $r->params['token']);
        Forms::saveValues($sub, (array) $r->input('values', []));
        self::syncIntakeDeliverable((int) $sub['brand_id'], 'in_progress');
        return Forms::payload(Forms::submissionById((int) $sub['id']), false);
    }

    public static function publicUpload(Request $r): array
    {
        $sub = self::editable((string) $r->params['token']);
        return Forms::upload($sub, (int) $r->params['field'], $_FILES['file'] ?? null);
    }

    /** "Fill from a document" on the client's link: returns suggested answers, saves nothing. */
    public static function publicAutofill(Request $r): array
    {
        $sub = self::editable((string) $r->params['token']);
        RateLimit::hit('autofill:' . (int) $sub['id'], 20, 3600, 'Too many documents in a short time. Please try again in a little while.');
        return Autofill::suggest(Forms::template((int) $sub['template_id']), (string) $r->input('text', ''));
    }

    public static function publicSubmit(Request $r): array
    {
        $sub = self::editable((string) $r->params['token']);
        Forms::saveValues($sub, (array) $r->input('values', []));
        Forms::submit(Forms::submissionById((int) $sub['id']));
        self::syncIntakeDeliverable((int) $sub['brand_id'], 'in_review');
        Activity::log((int) $sub['brand_id'], null, 'intake.submitted', 'The client submitted their intake form');
        $owner = Db::all('SELECT u.id, u.name, u.email FROM brands b JOIN users u ON u.id = b.owner_id WHERE b.id = ?', [$sub['brand_id']]);
        $brandName = (string) Db::value('SELECT name FROM brands WHERE id = ?', [$sub['brand_id']]);
        Workflows::notifyUsers($owner, "$brandName submitted their intake form", 'It is waiting for you to check it.', '/reviews', (int) $sub['brand_id'], true);
        Workflows::fire('intake.submitted', (int) $sub['brand_id']);
        return Forms::payload(Forms::submissionById((int) $sub['id']), false);
    }

    // Helpers -------------------------------------------------------------------------------------

    private static function intakeFor(int $brandId): array
    {
        $sub = Db::one("SELECT * FROM form_submissions WHERE brand_id = ? AND kind = 'intake'", [$brandId]);
        if (!$sub) throw HttpException::notFound('Intake form');
        return $sub;
    }

    private static function editable(string $token): array
    {
        $sub = Forms::submissionByToken($token);
        if ($sub['status'] === 'submitted') {
            throw new HttpException(409, 'This form has already been submitted. Contact your project manager to change an answer.');
        }
        return $sub;
    }

    /** Keeps the project's "Intake form" deliverable in step with the client's form. */
    private static function syncIntakeDeliverable(int $brandId, string $status): void
    {
        Db::exec(
            "UPDATE deliverables d JOIN projects p ON p.id = d.project_id
             SET d.status = ? WHERE p.brand_id = ? AND d.kind = 'intake' AND d.status <> 'approved'",
            [$status, $brandId]
        );
    }
}
