<?php
// Copy to config.php and adjust. config.php is git-ignored.
return [
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'name' => 'brandos',
        'user' => 'root',
        'pass' => '',
    ],
    // 32+ random characters. Encrypts credential ("secret") form fields at rest.
    // Changing it makes previously saved secrets unreadable.
    'app_key' => 'change-me-to-a-long-random-string-0123456789',
    // Public URL of the React app, used to build client form links.
    'app_url' => 'http://localhost:5173',
    // Allowed browser origins for CORS. The Vite dev server proxies /api, so this only
    // matters when the frontend is served from a different host than the API.
    'cors_origins' => ['http://localhost:5173'],
    'token_ttl_days' => 14,
    'upload_max_mb' => 15,
    // Workflow emails. With enabled = false they are only recorded in the outbox (Workflows → Emails).
    // With true, PHP mail() is used, so php.ini needs working SMTP settings.
    'mail' => ['enabled' => false, 'from' => 'Brand OS <no-reply@example.com>'],
    // digihrms integration: pushes assigned tasks into HRMS and takes status updates back.
    'hrms' => [
        'api_url' => '', // e.g. https://hrms.example.com/api.php
        'api_key' => '', // from digihrms's api_keys.php
        'webhook_secret' => 'change-me-to-a-long-random-string', // must match digihrms's BRANDOS_WEBHOOK_SECRET
    ],
];
