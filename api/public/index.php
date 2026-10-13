<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use App\Core\Request;
use App\Core\Router;

$router = new Router();
require __DIR__ . '/../src/routes.php';
// Workflow schedules and waits. Runs at most once a minute; bin/scheduler.php does the same from a cron job.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'OPTIONS') \App\Services\Workflows::maybeTick();

$router->dispatch(Request::capture());
