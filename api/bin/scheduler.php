<?php
declare(strict_types=1);

/**
 * Fires due workflow schedules and resumes finished waits.
 *
 * The API already does this on requests (at most once a minute), so it works while anyone uses the app.
 * For schedules that must fire when nobody is signed in, run this every few minutes:
 *   Windows Task Scheduler:  C:\xampp\php\php.exe D:\Client-Onboarding-app\api\bin\scheduler.php
 *   Linux cron:              *\/5 * * * * php /path/to/api/bin/scheduler.php
 */

require __DIR__ . '/../src/bootstrap.php';

$result = \App\Services\Workflows::tick();
echo date('Y-m-d H:i') . " · started {$result['fired']} runs · resumed {$result['resumed']} waits\n";
