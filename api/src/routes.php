<?php
declare(strict_types=1);

use App\Controllers\ApprovalController as Approvals;
use App\Controllers\AssetController as Assets;
use App\Controllers\AssetFormatController as Formats;
use App\Controllers\AuthController as AuthC;
use App\Controllers\ClientTeamController as ClientTeam;
use App\Controllers\ContentController as Content;
use App\Controllers\DocumentController as Docs;
use App\Controllers\ClientController as Clients;
use App\Controllers\DeliverableController as Deliverables;
use App\Controllers\FormController as Forms;
use App\Controllers\IntegrationController as Integrations;
use App\Controllers\HomeController as Home;
use App\Controllers\ProjectController as Projects;
use App\Controllers\SetupController as Setup;
use App\Controllers\TeamController as Teams;
use App\Controllers\TemplateController as Templates;
use App\Controllers\WebhookController as Webhooks;
use App\Controllers\WorkflowController as Workflows;

/** @var App\Core\Router $router */

$router->get('/health', fn() => ['ok' => true, 'time' => date('c')], false);

// digihrms status sync — authenticated by shared secret in the body, not a bearer token.
$router->post('/webhooks/hrms-task-status', [Webhooks::class, 'hrmsTaskStatus'], false);

// Session
$router->post('/auth/login', [AuthC::class, 'login'], false);
$router->get('/public/invites/{token}', [AuthC::class, 'inviteShow'], false);
$router->post('/public/invites/{token}', [AuthC::class, 'inviteAccept'], false);
$router->get('/auth/me', [AuthC::class, 'me']);
$router->post('/auth/logout', [AuthC::class, 'logout']);

$router->get('/home', [Home::class, 'index']);
$router->get('/activity', [Home::class, 'activity']);

// Clients and their projects
$router->get('/clients', [Clients::class, 'index']);
$router->post('/clients', [Clients::class, 'store']);
$router->get('/clients/{id}', [Clients::class, 'show']);
$router->patch('/clients/{id}', [Clients::class, 'update']);
$router->delete('/clients/{id}', [Clients::class, 'destroy']);
$router->post('/clients/{id}/projects', [Projects::class, 'start']);
$router->get('/clients/{id}/intake', [Forms::class, 'clientIntake']);
$router->post('/clients/{id}/intake/share', [Forms::class, 'share']);

$router->get('/clients/{id}/setup', [Setup::class, 'index']);
$router->post('/clients/{id}/setup', [Setup::class, 'store']);
$router->post('/clients/{id}/setup/standard', [Setup::class, 'addStandard']);
$router->post('/clients/{id}/retainer', [Setup::class, 'toRetainer']);
$router->patch('/setup/{id}', [Setup::class, 'update']);
$router->delete('/setup/{id}', [Setup::class, 'destroy']);

$router->get('/clients/{id}/team', [ClientTeam::class, 'index']);
$router->put('/clients/{id}/team/{team}', [ClientTeam::class, 'assign']);
$router->get('/clients/{id}/handoff', [ClientTeam::class, 'handoff']);
$router->put('/clients/{id}/handoff', [ClientTeam::class, 'setHandoff']);

$router->get('/clients/{id}/documents', [Docs::class, 'index']);
$router->post('/clients/{id}/documents', [Docs::class, 'store']);
$router->post('/clients/{id}/documents/standard', [Docs::class, 'addStandard']);
$router->patch('/documents/{id}', [Docs::class, 'update']);
$router->delete('/documents/{id}', [Docs::class, 'destroy']);
$router->post('/documents/{id}/file', [Docs::class, 'upload']);
$router->get('/documents/{id}/file', [Docs::class, 'file']);
$router->get('/public/documents/{token}', [Docs::class, 'publicShow'], false);
$router->post('/public/documents/{token}/{doc}', [Docs::class, 'publicUpload'], false);

$router->get('/content', [Content::class, 'index']);
$router->get('/clients/{id}/content', [Content::class, 'index']);
$router->post('/clients/{id}/content', [Content::class, 'store']);
$router->patch('/content/{id}', [Content::class, 'update']);
$router->post('/content/bulk', [Content::class, 'bulk']);

$router->get('/assets', [Assets::class, 'index']);
$router->post('/clients/{id}/assets', [Assets::class, 'store']);
$router->delete('/assets/{id}', [Assets::class, 'destroy']);
$router->get('/assets/{id}/file', [Assets::class, 'file']);

$router->get('/asset-formats', [Formats::class, 'index']);
$router->post('/asset-formats', [Formats::class, 'store']);
$router->get('/asset-formats/{id}', [Formats::class, 'show']);
$router->patch('/asset-formats/{id}', [Formats::class, 'update']);
$router->delete('/asset-formats/{id}', [Formats::class, 'destroy']);
$router->post('/asset-formats/{id}/fields', [Formats::class, 'addField']);
$router->post('/asset-formats/{id}/fields/order', [Formats::class, 'orderFields']);
$router->patch('/asset-fields/{id}', [Formats::class, 'updateField']);
$router->delete('/asset-fields/{id}', [Formats::class, 'deleteField']);
$router->post('/asset-formats/{id}/entries', [Formats::class, 'storeEntry']);
$router->get('/asset-entries', [Formats::class, 'entries']);
$router->get('/asset-entries/{id}', [Formats::class, 'showEntry']);
$router->patch('/asset-entries/{id}', [Formats::class, 'updateEntry']);
$router->post('/asset-entries/{id}/review', [Formats::class, 'reviewEntry']);
$router->delete('/asset-entries/{id}', [Formats::class, 'deleteEntry']);

$router->get('/blueprints', [Projects::class, 'blueprints']);
$router->post('/projects/start', [Projects::class, 'startMany']);
$router->get('/projects/{id}', [Projects::class, 'show']);
$router->patch('/projects/{id}', [Projects::class, 'update']);
$router->post('/stages/{id}/deliverables', [Projects::class, 'addDeliverable']);

// Deliverables, versions and reviews
$router->get('/work', [Deliverables::class, 'index']);
$router->get('/reviews', [Deliverables::class, 'reviews']);
$router->get('/approvals', [Approvals::class, 'index']);
$router->get('/approvals/summary', [Approvals::class, 'summary']);
$router->get('/deliverables/{id}', [Deliverables::class, 'show']);
$router->patch('/deliverables/{id}', [Deliverables::class, 'update']);
$router->delete('/deliverables/{id}', [Deliverables::class, 'destroy']);
$router->post('/deliverables/{id}/versions', [Deliverables::class, 'submitVersion']);
$router->post('/deliverables/{id}/decision', [Deliverables::class, 'decide']);
$router->post('/deliverables/{id}/block', [Deliverables::class, 'block']);
$router->post('/deliverables/{id}/unblock', [Deliverables::class, 'unblock']);
$router->post('/versions/{id}/comments', [Deliverables::class, 'comment']);
$router->get('/versions/{id}/file', [Deliverables::class, 'file']);

// Intake form: team side
$router->put('/forms/{id}', [Forms::class, 'save']);
$router->post('/forms/{id}/reopen', [Forms::class, 'reopen']);
$router->post('/forms/{id}/autofill', [Forms::class, 'autofill']);
$router->post('/forms/{id}/files/{field}', [Forms::class, 'upload']);
$router->get('/forms/{id}/files/{field}', [Forms::class, 'download']);

// Intake form: the client's private link (no sign-in)
$router->get('/public/forms/{token}', [Forms::class, 'publicShow'], false);
$router->put('/public/forms/{token}', [Forms::class, 'publicSave'], false);
$router->post('/public/forms/{token}/submit', [Forms::class, 'publicSubmit'], false);
$router->post('/public/forms/{token}/autofill', [Forms::class, 'publicAutofill'], false);
$router->post('/public/forms/{token}/files/{field}', [Forms::class, 'publicUpload'], false);

// Settings
$router->get('/teams', [Teams::class, 'teams']);
$router->post('/teams', [Teams::class, 'createTeam']);
$router->get('/teams/{id}/overview', [Teams::class, 'overview']);
$router->patch('/teams/{id}', [Teams::class, 'updateTeam']);
$router->delete('/teams/{id}', [Teams::class, 'deleteTeam']);
$router->get('/users', [Teams::class, 'users']);
$router->post('/users', [Teams::class, 'createUser']);
$router->patch('/users/{id}', [Teams::class, 'updateUser']);
$router->get('/users/{id}/removal', [Teams::class, 'removalPreview']);
$router->post('/users/{id}/invite', [Teams::class, 'sendInvite']);
$router->delete('/users/{id}', [Teams::class, 'removeUser']);

$router->get('/templates', [Templates::class, 'index']);
$router->post('/templates', [Templates::class, 'store']);
$router->get('/templates/{id}', [Templates::class, 'show']);
$router->patch('/templates/{id}', [Templates::class, 'update']);
$router->delete('/templates/{id}', [Templates::class, 'destroy']);
$router->post('/templates/{id}/duplicate', [Templates::class, 'duplicate']);
$router->post('/templates/{id}/sections', [Templates::class, 'addSection']);
$router->patch('/sections/{id}', [Templates::class, 'updateSection']);
$router->delete('/sections/{id}', [Templates::class, 'deleteSection']);
$router->post('/sections/{id}/move', [Templates::class, 'moveSection']);
$router->post('/sections/{id}/fields', [Templates::class, 'addField']);
$router->patch('/fields/{id}', [Templates::class, 'updateField']);
$router->delete('/fields/{id}', [Templates::class, 'deleteField']);
$router->post('/fields/{id}/move', [Templates::class, 'moveField']);
$router->post('/sections/{id}/order', [Templates::class, 'orderFields']);

// Workflows
$router->get('/workflows', [Workflows::class, 'index']);
$router->post('/workflows', [Workflows::class, 'store']);
$router->get('/workflow-meta', [Workflows::class, 'meta']);
$router->get('/workflow-runs', [Workflows::class, 'runs']);
$router->get('/workflow-runs/{id}', [Workflows::class, 'showRun']);
$router->post('/workflow-runs/{id}/stop', [Workflows::class, 'stopRun']);
$router->post('/workflow-tick', [Workflows::class, 'tick']);
$router->get('/email-outbox', [Workflows::class, 'outbox']);
$router->get('/notifications', [Workflows::class, 'notifications']);
$router->post('/notifications/read', [Workflows::class, 'readNotifications']);
$router->get('/workflows/{id}', [Workflows::class, 'show']);
$router->patch('/workflows/{id}', [Workflows::class, 'update']);
$router->delete('/workflows/{id}', [Workflows::class, 'destroy']);
$router->put('/workflows/{id}/graph', [Workflows::class, 'saveGraph']);
$router->post('/workflows/{id}/triggers', [Workflows::class, 'addTrigger']);
$router->post('/workflows/{id}/run', [Workflows::class, 'runNow']);
$router->patch('/workflow-triggers/{id}', [Workflows::class, 'updateTrigger']);
$router->delete('/workflow-triggers/{id}', [Workflows::class, 'deleteTrigger']);

// Integrations (Brevo) and emailing links to clients
$router->get('/settings/integrations', [Integrations::class, 'show']);
$router->put('/settings/integrations', [Integrations::class, 'save']);
$router->post('/settings/integrations/disconnect', [Integrations::class, 'disconnect']);
$router->post('/settings/integrations/test-email', [Integrations::class, 'testEmail']);
$router->post('/settings/integrations/sync-clients', [Integrations::class, 'syncClients']);
$router->post('/clients/{id}/email-form-link', [Integrations::class, 'sendFormLink']);
$router->post('/clients/{id}/email-documents-link', [Integrations::class, 'sendDocumentsLink']);
