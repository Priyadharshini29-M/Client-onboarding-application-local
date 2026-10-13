<?php
declare(strict_types=1);

/**
 * Creates the database, runs the schema and loads starter data.
 *   php api/bin/setup.php                                 real install: departments, forms, project types, asset formats
 *                                                         and one admin with a random password (printed once). No sample data.
 *   php api/bin/setup.php --admin-email=you@company.com   the same, with your own admin email
 *   php api/bin/setup.php --demo                          adds sample clients and people (password123). Never on a live server.
 *   --fresh                                               drops everything first. Without it, refuses if tables exist.
 */

require __DIR__ . '/../src/bootstrap.php';

use App\Core\Db;
use App\Services\Forms;
use App\Services\Projects;

$fresh = in_array('--fresh', $argv, true);
$c = config('db');

$server = new PDO(sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $c['host'], $c['port']), $c['user'], $c['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);
$server->exec("CREATE DATABASE IF NOT EXISTS `{$c['name']}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

$pdo = Db::pdo();
if ($pdo->query("SHOW TABLES LIKE 'users'")->fetchColumn() && !$fresh) {
    fwrite(STDERR, "Database '{$c['name']}' is already set up. Run with --fresh to wipe and reinstall.\n");
    exit(1);
}
foreach (array_filter(array_map('trim', preg_split('/;\s*$/m', file_get_contents(__DIR__ . '/../database/schema.sql')))) as $stmt) {
    if (preg_match('/^(--[^\n]*\n\s*)*$/', $stmt . "\n")) continue;
    $pdo->exec($stmt);
}
echo "Schema created.\n";

if (!in_array('--demo', $argv, true)) {
    // Real install: the same starter data as Docs/database/02_starter_data.sql, nothing made up.
    $email = 'admin@yourcompany.com';
    foreach ($argv as $arg) if (str_starts_with($arg, '--admin-email=')) $email = strtolower(trim(substr($arg, 14)));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { fwrite(STDERR, "That admin email is not valid.\n"); exit(1); }
    $sql = file_get_contents(__DIR__ . '/../../Docs/database/02_starter_data.sql');
    foreach (array_filter(array_map('trim', preg_split('/;\s*$/m', $sql))) as $stmt) {
        if (preg_match('/^(--[^\n]*\n\s*)*$/', $stmt . "\n")) continue;
        $pdo->exec($stmt);
    }
    $password = substr(strtr(base64_encode(random_bytes(12)), '+/', 'Kx'), 0, 16);
    Db::exec("UPDATE users SET email = ?, password_hash = ? WHERE role = 'super_admin' ORDER BY id LIMIT 1", [$email, password_hash($password, PASSWORD_DEFAULT)]);
    echo "Starter data loaded (departments, intake forms, project types, asset formats).\n\n";
    echo "Sign in with:\n  Email:    $email\n  Password: $password\n\nChange the password after signing in (Settings -> People -> your name).\n";
    exit(0);
}
echo "Loading demo data (sample clients and people). Do not use this on a live server.\n";

// Teams (colours match the Brand OS flow) -------------------------------------------------
$teams = [
    'pm' => ['Project Management', 'briefcase'],
    'creative' => ['Creative', 'palette'],
    'shoot' => ['Shoot', 'camera'],
    'digital' => ['Digital', 'megaphone'],
    'tech' => ['Tech', 'code'],
];
$teamId = [];
$i = 0;
foreach ($teams as $slug => [$name, $icon]) {
    $teamId[$slug] = Db::insert('teams', ['name' => $name, 'slug' => $slug, 'icon' => $icon, 'position' => $i++]);
}

// People (all use password123; change them after first sign-in) -------------------------------
$people = [
    ['Admin', 'admin@brandos.local', 'super_admin', 'pm'],
    ['Arjun', 'arjun@brandos.local', 'project_manager', 'pm'],
    ['Nithya', 'nithya@brandos.local', 'creative_head', 'creative'],
    ['Priya', 'priya@brandos.local', 'member', 'creative'],
    ['Sanjay', 'sanjay@brandos.local', 'member', 'shoot'],
    ['Karthik', 'karthik@brandos.local', 'member', 'digital'],
    ['Rahul', 'rahul@brandos.local', 'tech_lead', 'tech'],
    ['Meena', 'meena@brandos.local', 'member', 'tech'],
];
$userId = [];
foreach ($people as [$name, $email, $role, $team]) {
    $userId[$name] = Db::insert('users', [
        'name' => $name, 'email' => $email, 'role' => $role, 'team_id' => $teamId[$team],
        'password_hash' => password_hash('password123', PASSWORD_DEFAULT),
        'phone' => '+91 98400 ' . str_pad((string) (10000 + count($userId) * 111), 5, '0', STR_PAD_LEFT),
    ]);
}

// Intake forms ------------------------------------------------------------------------------------
function addForm(string $name, string $category, string $desc, array $sections): int
{
    $tid = Db::insert('templates', ['name' => $name, 'category' => $category, 'description' => $desc]);
    foreach ($sections as $si => [$title, $fields]) {
        $sid = Db::insert('template_sections', ['template_id' => $tid, 'title' => $title, 'position' => $si]);
        foreach ($fields as $fi => $f) {
            Db::insert('template_fields', [
                'section_id' => $sid, 'label' => $f[0], 'type' => $f[1], 'placeholder' => $f[2] ?? null,
                'options' => isset($f[3]) ? json_encode($f[3]) : null, 'required' => !empty($f[4]) ? 1 : 0, 'position' => $fi,
            ]);
        }
    }
    return $tid;
}

$access = ['Access given', "We don't have one", 'Will do soon'];
$d2cForm = addForm('E-commerce brand questionnaire', 'ecommerce', 'For product brands selling online', [
    ['About your business', [
        ['Your name', 'text', 'Who is filling this in?', null, true],
        ['Brand name', 'text', 'As customers know it', null, true],
        ['Registered company name', 'text'],
        ['Business address', 'textarea', 'Street, city, PIN code'],
        ['GST number', 'text', '15-character GSTIN'],
        ['Email', 'email', 'you@yourbrand.com', null, true],
        ['Phone', 'phone', '+91', null, true],
    ]],
    ['Your brand', [
        ['What does your brand stand for?', 'textarea', 'In a few sentences, in your own words', null, true],
        ['Who are your customers?', 'textarea', 'Age, location, what they care about'],
        ['Brands you admire or compete with', 'textarea', 'Names or website links'],
        ['Anything your brand should never say or look like?', 'textarea'],
    ]],
    ['Products', [
        ['Product list and categories', 'textarea', 'e.g. Skincare: face serum, cleanser, toner', null, true],
        ['Price range', 'text', 'e.g. ₹499 – ₹1,999'],
        ['Product photos (folder link)', 'url', 'Google Drive or Dropbox link'],
        ['Product catalogue', 'file'],
    ]],
    ['Documents', [
        ['GST certificate', 'file'],
        ['PAN card', 'file'],
        ['Cancelled cheque', 'file'],
        ['Bank account details', 'textarea', 'Account name, number, IFSC'],
    ]],
    ['Social media', [
        ['Instagram handle', 'text', '@yourbrand'],
        ['Instagram password', 'secret'],
        ['Facebook page link', 'url', 'https://facebook.com/...'],
        ['Meta Business Suite access for our team', 'select', null, $access],
    ]],
    ['Website, domain & payments', [
        ['Do you already have a website?', 'select', null, ['Yes', 'No']],
        ['Website admin link', 'url', 'https://'],
        ['Website admin username', 'text'],
        ['Website admin password', 'secret'],
        ['Domain provider', 'text', 'e.g. GoDaddy, Hostinger'],
        ['Domain login email', 'email'],
        ['Domain login password', 'secret'],
        ['Payment gateway', 'select', null, ['Razorpay', 'PhonePe', 'Cashfree', 'Not decided']],
        ['Google Analytics & Ads access for our team', 'select', null, $access],
    ]],
    ['Main contact', [
        ['Who should we talk to day to day?', 'text', 'Name', null, true],
        ['Their email', 'email'],
        ['Their phone', 'phone'],
    ]],
]);

$leadForm = addForm('Lead generation questionnaire', 'lead_gen', 'For service businesses that need enquiries and leads', [
    ['About your business', [
        ['Your name', 'text', 'Who is filling this in?', null, true],
        ['Business name', 'text', 'As customers know it', null, true],
        ['Email', 'email', 'you@business.com', null, true],
        ['Phone', 'phone', '+91', null, true],
        ['Business address', 'textarea', 'Street, city, PIN code'],
        ['GST number', 'text', '15-character GSTIN'],
    ]],
    ['Services & customers', [
        ['What services do you offer?', 'textarea', 'List each service and its starting price', null, true],
        ['Which areas do you serve?', 'text', 'Cities, localities or pan-India'],
        ['Who is your ideal customer?', 'textarea', 'Age, income, business size, what they need'],
        ['Competitors you know of', 'textarea', 'Names or website links'],
    ]],
    ['Lead goals', [
        ['Leads you want each month', 'number', 'e.g. 300', null, true],
        ['Target cost per lead (₹)', 'number', 'e.g. 150'],
        ['Monthly ad budget (₹)', 'number', 'e.g. 60000', null, true],
        ['Where should new leads go?', 'select', null, ['WhatsApp', 'CRM', 'Google Sheet', 'Email']],
        ['CRM you use (if any)', 'text', 'e.g. Zoho, LeadSquared, HubSpot'],
        ['How many people follow up on leads?', 'number', 'Sales team size'],
    ]],
    ['Website & ads access', [
        ['Website or landing page link', 'url', 'https://'],
        ['Website admin login link', 'url', 'https://'],
        ['Website admin password', 'secret'],
        ['Facebook page link', 'url', 'https://facebook.com/...'],
        ['Meta Business Suite access for our team', 'select', null, $access],
        ['Google Ads access for our team', 'select', null, $access],
    ]],
    ['Main contact', [
        ['Who should we talk to day to day?', 'text', 'Name', null, true],
        ['Their phone', 'phone'],
        ['Best time to call', 'text', 'e.g. weekdays after 11 am'],
    ]],
]);
echo "Intake forms created.\n";

// Blueprints: the Brand OS flow and two shorter project types --------------------------------------
$STAGES = [
    'intake' => ['Client Intake', 'The client shares everything through one form.', 'pm', 'project_manager', 3, [
        ['intake', 'Intake form', 'Filled in by the client through their private link.'],
        ['work', 'Kick-off meeting notes', 'Goals, timelines and who is who on the client side.'],
    ]],
    'understanding' => ['Brand Understanding', 'Turn the answers into a clear brand profile.', 'creative', 'creative_head', 4, [
        ['work', 'Brand profile', 'Positioning, tone of voice, audience, and what to avoid.'],
        ['work', 'Competitor & audience research', 'Who we compete with and who we are talking to.'],
    ]],
    'branding' => ['Branding & Products', 'The visual identity and one record per product.', 'creative', 'creative_head', 10, [
        ['work', 'Moodboard', 'Direction for look, photography, textures and colour.'],
        ['work', 'Logo', 'Present 2–3 concepts with rationale, then refine the chosen one.'],
        ['work', 'Colours & typography', 'Palette with HEX/RGB/CMYK and the type system.'],
        ['work', 'Brand guidelines', 'Built from the approved logo, colours and type.'],
        ['work', 'Product catalogue', 'Names, prices, variants and claims for every product.'],
    ]],
    'shoot' => ['Shoot & Content', 'Plan the shoot, shoot it, edit it.', 'shoot', 'creative_head', 10, [
        ['work', 'Lookbook & shot list', 'Mood, models, location, lighting, props and every shot.'],
        ['work', 'Product photos', 'Edited, exported for web and social.'],
        ['work', 'Product videos', 'Edited reels and product clips.'],
    ]],
    'uiux' => ['UI / UX Design', 'Pages designed from the approved brand and photos.', 'digital', 'creative_head', 8, [
        ['work', 'Sitemap & wireframes', 'Page structure before visual design.'],
        ['work', 'Homepage design', 'Desktop and mobile.'],
        ['work', 'Product page design', 'Desktop and mobile.'],
    ]],
    'dev' => ['Development', 'Build the approved designs.', 'tech', 'tech_lead', 10, [
        ['work', 'Theme setup', 'Development theme on the store, never the live one.'],
        ['work', 'Website build', 'All approved pages built and connected.'],
    ]],
    'testing' => ['Testing & Brand Check', 'Everything works and matches the guidelines.', 'tech', 'creative_head', 4, [
        ['work', 'QA report', 'Devices, browsers, speed, forms and checkout.'],
        ['work', 'Brand check', 'Logo, colours, fonts, photos and product claims.'],
    ]],
    'launch' => ['Launch', 'Final checks, then go live.', 'tech', 'project_manager', 2, [
        ['work', 'Launch checklist', 'Domain, analytics, payments, shipping, backup.'],
        ['work', 'Go live', 'Publish and confirm the site is live.'],
    ]],
    'lg_strategy' => ['Offer & Funnel Plan', 'What we sell, to whom, and the path from ad to lead.', 'digital', 'project_manager', 4, [
        ['work', 'Offer & audience plan', 'Core offer, audiences and budget split.'],
        ['work', 'Funnel map', 'Ad → landing page → form → follow-up.'],
    ]],
    'lg_creatives' => ['Ad Creatives', 'Static and video ads for each audience.', 'creative', 'creative_head', 6, [
        ['work', 'Ad copy set', 'Headlines, primary text and CTAs for each audience.'],
        ['work', 'Static ad creatives', 'Sized for feed and stories.'],
        ['work', 'Video ad', 'Short reel for awareness and retargeting.'],
    ]],
    'lg_landing' => ['Landing Page', 'A fast page built to turn visits into enquiries.', 'tech', 'creative_head', 6, [
        ['work', 'Landing page design', 'Desktop and mobile.'],
        ['work', 'Landing page build', 'Live on the client domain with the lead form.'],
    ]],
    'lg_tracking' => ['Tracking & CRM', 'Every lead is counted and reaches the sales team.', 'tech', 'tech_lead', 3, [
        ['work', 'Pixel & conversion tracking', 'Meta pixel, Google tag and test conversions.'],
        ['work', 'Lead routing', 'Leads flow to WhatsApp, CRM or sheet in real time.'],
    ]],
    'lg_launch' => ['Campaign Launch', 'Campaigns go live and are watched closely for the first week.', 'digital', 'project_manager', 4, [
        ['work', 'Campaign setup', 'Campaigns, ad sets, budgets and schedules.'],
        ['work', 'First-week report', 'Leads, cost per lead and what we changed.'],
    ]],
    'handoff' => ['Handoff', 'The client gets everything in one package.', 'pm', 'project_manager', 3, [
        ['work', 'Handoff package', 'Brand assets, source files, logins and guides.'],
        ['work', 'Client walkthrough', 'Training session and sign-off.'],
    ]],
];
$blueprints = [
    ['ecommerce', 'E-commerce brand', 'Brand identity, product shoot, online store and launch', ['intake', 'understanding', 'branding', 'shoot', 'uiux', 'dev', 'testing', 'launch', 'handoff']],
    ['lead_gen', 'Lead generation', 'Offer, ad creatives, landing page, tracking and campaign launch', ['intake', 'understanding', 'lg_strategy', 'lg_creatives', 'lg_landing', 'lg_tracking', 'lg_launch', 'handoff']],
];
$blueprintIds = [];
foreach ($blueprints as $bi => [$ctype, $name, $desc, $keys]) {
    $bid = Db::insert('blueprints', ['client_type' => $ctype, 'name' => $name, 'description' => $desc, 'position' => $bi]);
    $blueprintIds[] = $bid;
    foreach ($keys as $si => $key) {
        [$sname, $summary, $team, $role, $days, $items] = $STAGES[$key];
        $sid = Db::insert('blueprint_stages', [
            'blueprint_id' => $bid, 'position' => $si + 1, 'name' => $sname, 'summary' => $summary,
            'team_id' => $teamId[$team], 'approver_role' => $role, 'duration_days' => $days,
        ]);
        foreach ($items as $di => [$kind, $title, $brief]) {
            Db::insert('blueprint_deliverables', ['stage_id' => $sid, 'position' => $di, 'kind' => $kind, 'title' => $title, 'brief' => $brief]);
        }
    }
}
echo "Project blueprints created.\n";

// Sample clients so the app opens with real-looking work ----------------------------------------------
$admin = ['id' => $userId['Admin'], 'role' => 'super_admin', 'team_id' => $teamId['pm']];
$pm = ['id' => $userId['Arjun'], 'role' => 'project_manager', 'team_id' => $teamId['pm']];
$head = ['id' => $userId['Nithya'], 'role' => 'creative_head', 'team_id' => $teamId['creative']];
$priya = ['id' => $userId['Priya'], 'role' => 'member', 'team_id' => $teamId['creative']];

$client = function (string $name, string $contact, int $form, int $blueprint, string $intake, string $type = 'ecommerce', array $profile = [], ?string $industry = null) use ($userId) {
    $id = Db::insert('brands', [
        'name' => $name, 'contact_name' => $contact, 'template_id' => $form, 'owner_id' => $userId['Arjun'],
        'brand_type' => $type, 'profile' => json_encode($profile), 'industry' => $industry,
        'email' => strtolower(preg_replace('/\W+/', '', $name)) . '@example.com', 'status' => 'new',
    ]);
    $sid = Forms::createSubmission($form, $id);
    Db::exec('UPDATE form_submissions SET status = ?, submitted_at = IF(? = "submitted", NOW(), NULL) WHERE id = ?', [$intake, $intake, $sid]);
    if ($intake === 'submitted' || $intake === 'in_progress') {
        // Plausible answers so the sample forms are not empty.
        $answers = [
            'Your name' => $contact, 'Brand name' => $name, 'Business name' => $name, 'Email' => strtolower(preg_replace('/\W+/', '', $name)) . '@example.com',
            'Phone' => '+91 98400 12345', 'What does your brand stand for?' => "Honest, everyday products that feel premium without the premium price.",
            'Who are your customers?' => 'Women 24–38 in metro cities who buy online and care about ingredients.',
            'Product list and categories' => 'Skincare: face serum, cleanser, toner. Body: lotion, scrub.', 'Price range' => '₹499 – ₹1,499',
            'Instagram handle' => '@' . strtolower(preg_replace('/\W+/', '', $name)), 'Who should we talk to day to day?' => $contact,
            'What services do you offer?' => 'Braces from ₹35,000, implants from ₹25,000, whitening ₹6,000.',
            'Which areas do you serve?' => 'Anna Nagar and nearby, Chennai', 'Leads you want each month' => '120', 'Monthly ad budget (₹)' => '30000',
        ];
        if ($intake === 'in_progress') $answers = array_slice($answers, 0, 4, true);
        foreach (Db::all('SELECT f.id, f.label FROM template_fields f JOIN template_sections s ON s.id = f.section_id WHERE s.template_id = ?', [$form]) as $f) {
            if (isset($answers[$f['label']])) Db::insert('form_values', ['submission_id' => $sid, 'field_id' => $f['id'], 'value' => $answers[$f['label']]]);
        }
    }
    $pid = Projects::create($id, $blueprint, $userId['Arjun'], $userId['Arjun']);
    $intakeStatus = ['not_sent' => 'not_started', 'sent' => 'in_progress', 'in_progress' => 'in_progress', 'submitted' => 'in_review'][$intake];
    Db::exec("UPDATE deliverables SET status = ? WHERE project_id = ? AND kind = 'intake'", [$intakeStatus, $pid]);
    return $pid;
};

// Lushra: intake done, now in Brand Understanding with a logo moodboard in review.
$lushra = $client('Lushra', 'Divya Raman', $d2cForm, $blueprintIds[0], 'submitted', 'ecommerce', [
    'store_url' => 'https://lushra.example.com', 'platform' => 'Shopify', 'category' => 'Skincare', 'sku_count' => '24',
    'avg_order_value' => '1150', 'monthly_orders' => '900', 'marketplaces' => 'Amazon, Nykaa', 'payment_gateway' => 'Razorpay',
    'shipping_partner' => 'Shiprocket', 'instagram' => '@lushra', 'monthly_ad_budget' => '150000',
], 'Beauty & personal care');
$del = fn(int $pid, string $title) => Projects::deliverable((int) Db::value('SELECT id FROM deliverables WHERE project_id = ? AND title = ?', [$pid, $title]));
Projects::decide($del($lushra, 'Intake form'), $pm, 'approved', null);
Projects::submitVersion($del($lushra, 'Kick-off meeting notes'), $pm, 'Goals: launch before Diwali, focus on the serum range.', null, null);
Projects::decide($del($lushra, 'Kick-off meeting notes'), $pm, 'approved', null);
Projects::submitVersion($del($lushra, 'Brand profile'), $priya, 'First pass at positioning and tone.', 'https://docs.google.com/document/d/example', null);
Projects::decide($del($lushra, 'Brand profile'), $head, 'changes_requested', 'Tone reads too clinical. Make it warmer and drop "chemical-free".');
Projects::submitVersion($del($lushra, 'Brand profile'), $priya, 'Warmer tone, removed unapproved claims.', 'https://docs.google.com/document/d/example-v2', null);
Db::exec("UPDATE deliverables SET assignee_id = ?, status = 'in_progress' WHERE project_id = ? AND title = 'Competitor & audience research'", [$userId['Karthik'], $lushra]);

// Lushra's setup checklist, partly done.
$lushraClient = (int) Db::value('SELECT brand_id FROM projects WHERE id = ?', [$lushra]);
$items = [
    ['Brand guidelines and logo files saved to the shared drive', 1],
    ['Website admin access checked', 1],
    ['Meta Business Suite access checked', 0],
    ['Monthly scope and reporting day agreed with the client', 0],
];
foreach ($items as $i => [$title, $done]) {
    Db::insert('setup_items', [
        'brand_id' => $lushraClient, 'title' => $title, 'done' => $done, 'position' => $i,
        'owner_id' => $userId['Arjun'], 'done_at' => $done ? date('Y-m-d H:i:s') : null,
    ]);
}

// A few assets for Lushra.
foreach ([
    ['Brand photos (Drive)', 'https://drive.google.com/drive/folders/lushra-photos', 'brand'],
    ['Product catalogue sheet', 'https://docs.google.com/spreadsheets/d/lushra-catalogue', 'product'],
    ['Logo source files', 'https://drive.google.com/drive/folders/lushra-logo', 'brand'],
] as [$title, $url, $cat]) {
    Db::insert('assets', ['brand_id' => $lushraClient, 'kind' => 'link', 'title' => $title, 'url' => $url, 'category' => $cat, 'added_by' => $userId['Arjun']]);
}

// Brand details, team leads, client documents and a content month for Lushra.
Db::update('brands', $lushraClient, [
    'website' => 'https://lushra.example.com',
    'tags' => json_encode(['premium', 'shopify']), 'docs_token' => bin2hex(random_bytes(20)),
]);
foreach (['pm' => 'Arjun', 'creative' => 'Nithya', 'shoot' => 'Sanjay', 'digital' => 'Karthik', 'tech' => 'Rahul'] as $team => $person) {
    Db::insert('client_team', ['brand_id' => $lushraClient, 'team_id' => $teamId[$team], 'user_id' => $userId[$person]]);
}
foreach ([['GST certificate', 'approved'], ['PAN card', 'uploaded'], ['Cancelled cheque', 'pending'], ['Logo files (AI / SVG / PNG)', 'pending']] as $i => [$name, $st]) {
    Db::insert('client_documents', [
        'brand_id' => $lushraClient, 'name' => $name, 'status' => $st, 'position' => $i,
        'file_name' => $st === 'pending' ? null : strtolower(str_replace(' ', '-', $name)) . '.pdf', 'uploaded_at' => $st === 'pending' ? null : date('Y-m-d H:i:s'),
    ]);
}
$month = date('Y-m');
$posts = [
    ['05', 'top', 'Why your skin loves rose water', 'Education', 'Reel', 'ready', 'Priya'],
    ['09', 'mid', 'Serum routine in 30 seconds', 'Product', 'Carousel', 'in_progress', 'Priya'],
    ['14', 'bot', 'Festive combo: 20% off', 'Offer', 'Static', 'pending', 'Karthik'],
    ['20', 'top', 'Behind the scenes: our shoot day', 'Brand story', 'Reel', 'pending', 'Sanjay'],
];
foreach ($posts as $i => [$day, $funnel, $line, $concept, $type, $st, $who]) {
    Db::insert('content_items', [
        'brand_id' => $lushraClient, 'month' => $month, 'post_date' => "$month-$day", 'funnel' => $funnel, 'one_liner' => $line,
        'concept' => $concept, 'post_type' => $type, 'channels' => 'Instagram, Facebook', 'status' => $st,
        'assignee_id' => $userId[$who], 'position' => $i,
    ]);
}
// Mooie: client is still filling in the form.
$client('Mooie', 'Farah Khan', $d2cForm, $blueprintIds[0], 'in_progress', 'ecommerce', ['platform' => 'Shopify', 'category' => 'Women\'s fashion', 'marketplaces' => 'Myntra'], 'Fashion');
// Vivid LED: lead generation, form not sent yet.
$client('Vivid LED', 'Suresh', $leadForm, $blueprintIds[1], 'not_sent', 'lead_gen', [
    'services' => 'Custom lighting design and installation', 'service_areas' => 'Chennai, Coimbatore', 'monthly_lead_target' => '250',
    'target_cpl' => '180', 'monthly_ad_budget' => '45000', 'lead_destination' => 'WhatsApp',
], 'Home & lighting');
// Smile Dental: lead generation, intake submitted and waiting for the PM.
$client('Smile Dental Care', 'Dr. Ananya', $leadForm, $blueprintIds[1], 'submitted', 'lead_gen', [
    'services' => 'Braces, implants, whitening', 'service_areas' => 'Anna Nagar, Chennai', 'monthly_lead_target' => '120',
    'target_cpl' => '250', 'monthly_ad_budget' => '30000', 'lead_destination' => 'CRM', 'crm' => 'Zoho',
], 'Healthcare');
Db::exec("UPDATE brands SET docs_token = SHA1(CONCAT(id, RAND())) WHERE docs_token IS NULL");
echo "Sample clients created.\n\n";

// ---------------------------------------------------------------- asset formats
// [name, kind, description, [[label, type, required, placeholder, options], ...]]
$formats = [
    ['Content Calendar', 'calendar', 'Month plan of posts: one row per post', [
        ['Post date', 'date', 1], ['Platform', 'select', 1, null, ['Instagram', 'Facebook', 'LinkedIn', 'YouTube', 'Other']],
        ['Format', 'select', 1, null, ['Static post', 'Carousel', 'Reel', 'Story', 'Video']],
        ['Content pillar', 'select', 0, null, ['Educational', 'Promotional', 'Engagement', 'Festive', 'Behind the scenes']],
        ['Topic', 'text', 1, 'e.g. How to pick the right serum'], ['Hook / headline', 'text', 0, 'First line people read'],
        ['Caption', 'textarea', 0], ['Hashtags', 'text', 0, '#skincare #selfcare'], ['Call to action', 'text', 0, 'e.g. Shop now'],
        ['Reference link', 'link', 0, 'https://'], ['Creative link', 'link', 0, 'Drive link to the final design'],
        ['Posting time', 'text', 0, 'e.g. 7:00 PM'], ['Status', 'select', 0, null, ['Planned', 'In design', 'Ready', 'Posted']], ['Notes', 'textarea', 0],
    ]],
    ['Shoot Requirements', 'form', 'Shoot brief submitted by the team before the shoot', [
        ['Shoot title / theme', 'text', 1, 'e.g. Baby Essentials Lifestyle Shoot'], ['Shoot date', 'date', 1],
        ['Shoot location', 'text', 1, 'Studio / Outdoor / Client premises'], ['Number of posts requiring shoot', 'number', 1, 'e.g. 8'],
        ['Content types needed', 'select', 1, null, ['Only photos', 'Only videos', 'Both photos & videos']],
        ['Looks / setups required', 'text', 1, 'e.g. 3 setups: bedroom, kitchen, outdoor'], ['Props required', 'textarea', 0, 'List all props needed'],
        ['Wardrobe / styling notes', 'textarea', 0, 'Colour palette, outfits, brand guidelines'], ['Mood board / reference link', 'link', 0, 'https://'],
        ['Models required', 'text', 0, 'e.g. 1 female model, 25–30'], ['Products to shoot', 'textarea', 0, 'Product names or SKUs'],
        ['Special instructions', 'textarea', 0],
    ]],
    ['Shoot Delivery', 'form', 'What the shoot team hands over after the shoot', [
        ['Shoot date', 'date', 1], ['Drive folder link', 'link', 1, 'https://drive.google.com/...'], ['Photos delivered', 'number', 0, 'e.g. 40'],
        ['Videos delivered', 'number', 0, 'e.g. 6'], ['Raw or edited', 'select', 1, null, ['Raw', 'Edited', 'Both']], ['Notes', 'textarea', 0],
    ]],
    ['Strategy Document', 'form', 'The brand strategy the team works from', [
        ['Document link', 'link', 1, 'https://docs.google.com/...'], ['Period covered', 'text', 0, 'e.g. Oct–Dec 2026'],
        ['Key goals', 'textarea', 0, 'What we want to achieve'], ['Notes', 'textarea', 0],
    ]],
    ['Plan Of Action', 'form', 'Month-by-month plan shared with the client', [['Plan document link', 'link', 1, 'https://docs.google.com/...']]],
    ['Video Editing PPT', 'form', 'Edit plan for the video team', [['Presentation link', 'link', 1, 'https://docs.google.com/presentation/...']]],
    ['Website Check List', 'checklist', 'Tick these off before the website goes live', [
        ['Domain & hosting connected', 'checkbox', 0], ['All pages built and reviewed', 'checkbox', 0], ['Payment gateway tested', 'checkbox', 0],
    ]],
    ['Website SEO Check List', 'checklist', 'Basic SEO before launch', [
        ['Meta titles & descriptions added', 'checkbox', 0], ['Google Search Console verified', 'checkbox', 0],
        ['Sitemap submitted', 'checkbox', 0], ['Image alt text added', 'checkbox', 0],
    ]],
    ['Plan Of Action Retention', 'form', 'Plan for keeping retainer clients growing', [['Plan document link', 'link', 1, 'https://docs.google.com/...']]],
    ['Client Kickstart Meet', 'form', 'Notes from the first meeting with the client', [['Meeting notes link', 'link', 1, 'https://docs.google.com/...']]],
];
$formatId = [];
foreach ($formats as $pos => [$name, $kind, $desc, $fields]) {
    $slug = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($name)), '_');
    $fid = Db::insert('asset_formats', ['name' => $name, 'slug' => $slug, 'kind' => $kind, 'description' => $desc, 'position' => $pos]);
    $formatId[$name] = $fid;
    foreach ($fields as $i => $f) {
        Db::insert('asset_format_fields', [
            'format_id' => $fid, 'label' => $f[0], 'field_key' => trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($f[0])), '_'),
            'type' => $f[1], 'required' => $f[2], 'placeholder' => $f[3] ?? null,
            'options' => isset($f[4]) ? json_encode($f[4]) : null, 'position' => $i,
        ]);
    }
}
$mooieClient = (int) Db::value("SELECT id FROM brands WHERE name = 'Mooie'");
Db::insert('asset_entries', [
    'format_id' => $formatId['Shoot Requirements'], 'brand_id' => $lushraClient, 'title' => 'October product shoot', 'status' => 'approved',
    'created_by' => $userId['Sanjay'], 'reviewed_by' => $userId['Nithya'],
    'answers' => json_encode([
        'shoot_title_theme' => 'Glow ritual: serum and moisturiser', 'shoot_date' => date('Y-m-d', strtotime('+6 days')), 'shoot_location' => 'Studio',
        'number_of_posts_requiring_shoot' => 8, 'content_types_needed' => 'Both photos & videos', 'looks_setups_required' => '3 setups: vanity, bathroom shelf, hand model',
        'props_required' => 'Marble tray, towels, eucalyptus, glass droplets', 'wardrobe_styling_notes' => 'Soft neutrals, no logos',
    ], JSON_UNESCAPED_UNICODE),
]);
Db::insert('asset_entries', [
    'format_id' => $formatId['Content Calendar'], 'brand_id' => $lushraClient, 'title' => 'October content calendar', 'status' => 'waiting',
    'created_by' => $userId['Priya'],
    'answers' => json_encode([
        ['post_date' => date('Y-m-d', strtotime('+3 days')), 'platform' => 'Instagram', 'format' => 'Reel', 'content_pillar' => 'Educational', 'topic' => '3 steps to a morning routine', 'status' => 'In design'],
        ['post_date' => date('Y-m-d', strtotime('+5 days')), 'platform' => 'Instagram', 'format' => 'Carousel', 'content_pillar' => 'Promotional', 'topic' => 'Meet the Glow serum', 'status' => 'Planned'],
        ['post_date' => date('Y-m-d', strtotime('+8 days')), 'platform' => 'Facebook', 'format' => 'Static post', 'content_pillar' => 'Engagement', 'topic' => 'This or that: serum or oil?', 'status' => 'Planned'],
    ], JSON_UNESCAPED_UNICODE),
]);
Db::insert('asset_entries', [
    'format_id' => $formatId['Website Check List'], 'brand_id' => $mooieClient, 'title' => 'Mooie store launch', 'status' => 'needs_changes',
    'created_by' => $userId['Rahul'], 'reviewed_by' => $userId['Admin'], 'review_note' => 'Payment gateway still shows test mode.',
    'answers' => json_encode(['domain_hosting_connected' => true, 'all_pages_built_and_reviewed' => true, 'payment_gateway_tested' => false]),
]);
echo "Asset formats created.\n\n";

// ---------------------------------------------------------------- workflows (canvas graphs)
// Workflows are internal: they move work between our departments and never message the client.
// $nodes: key => [type, title, config, x, y]; $edges: [from key|'start', to key, branch]
$wf = function (string $name, string $desc, bool $live, array $nodes, array $edges, array $triggers) use ($userId): int {
    $id = Db::insert('workflows', ['name' => $name, 'description' => $desc, 'is_live' => $live ? 1 : 0, 'created_by' => $userId['Admin']]);
    $ids = [];
    foreach ($nodes as $key => [$type, $title, $config, $x, $y]) {
        // Layouts are written compactly here and spread out so the arrows between cards are easy to see.
        $ids[$key] = Db::insert('workflow_steps', ['workflow_id' => $id, 'type' => $type, 'title' => $title, 'config' => json_encode($config, JSON_UNESCAPED_UNICODE), 'pos_x' => (int) round(160 + ($x - 160) * 1.5), 'pos_y' => (int) round($y * 1.4)]);
    }
    foreach ($edges as [$from, $to, $branch]) {
        Db::insert('workflow_edges', ['workflow_id' => $id, 'from_step_id' => $from === 'start' ? null : $ids[$from], 'to_step_id' => $ids[$to], 'branch' => $branch]);
    }
    foreach ($triggers as $t) Db::insert('workflow_triggers', $t + ['workflow_id' => $id, 'last_fired_at' => date('Y-m-d H:i:s')]);
    return $id;
};

// 1. New client handoff: every department in turn, each one started by the previous team's approved work.
$handoff = $wf('New client handoff', 'Kick-off, strategy, website, shoot and the first content calendar, handed from team to team', true, [
    'kickoff'  => ['task', 'Kick-off call and brief', ['team_id' => $teamId['pm'], 'assignee' => 'client_lead', 'due_days' => 2, 'asset_format_id' => $formatId['Client Kickstart Meet'],
                    'description' => 'Hold the kick-off with {client}, then add the meeting notes link.'], 160, 120],
    'tellCr'   => ['notify', 'Brief ready for {client}', ['to' => 'team', 'team_id' => $teamId['creative'], 'message' => 'The kick-off is done. The strategy task is on your board.'], 160, 250],
    'strategy' => ['task', 'Brand strategy', ['team_id' => $teamId['creative'], 'assignee' => 'client_lead', 'due_days' => 4, 'asset_format_id' => $formatId['Strategy Document'],
                    'description' => 'Positioning, audience and tone for {client}. Use the kick-off notes.'], 160, 380],
    'stratOk'  => ['approval', 'Creative Head approves', ['approver_role' => 'creative_head'], 160, 510],
    'isEc'     => ['condition', 'E-commerce client?', ['field' => 'client.type', 'op' => 'is', 'value' => 'ecommerce'], -40, 640],
    'store'    => ['task', 'Store setup and website checklist', ['team_id' => $teamId['tech'], 'assignee' => 'client_lead', 'due_days' => 5, 'asset_format_id' => $formatId['Website Check List']], -190, 770],
    'storeOk'  => ['approval', 'Tech Lead approves', ['approver_role' => 'tech_lead'], -190, 900],
    'landing'  => ['task', 'Landing page and lead tracking', ['team_id' => $teamId['tech'], 'assignee' => 'client_lead', 'due_days' => 5,
                    'description' => 'Landing page, form and conversion tracking for {client}.'], 110, 770],
    'landOk'   => ['approval', 'Tech Lead approves', ['approver_role' => 'tech_lead'], 110, 900],
    'siteDone' => ['notify', 'Website ready for {client}', ['to' => 'team', 'team_id' => $teamId['digital'], 'message' => 'Tech has finished. The content calendar starts once the shoot plan is approved too.'], -40, 1030],
    'shoot'    => ['task', 'Shoot plan', ['team_id' => $teamId['shoot'], 'assignee' => 'client_lead', 'due_days' => 4, 'asset_format_id' => $formatId['Shoot Requirements']], 360, 640],
    'shootOk'  => ['approval', 'Creative Head approves', ['approver_role' => 'creative_head'], 360, 770],
    'calendar' => ['task', 'First month content calendar', ['team_id' => $teamId['digital'], 'assignee' => 'client_lead', 'due_days' => 5, 'join' => 'all',
                    'asset_format_id' => $formatId['Content Calendar'], 'description' => 'Plan the first month using the strategy and the shoot plan.'], 160, 1160],
    'calOk'    => ['approval', 'Project Manager approves', ['approver_role' => 'project_manager'], 160, 1290],
    'tellPm'   => ['notify', '{client} is ready to go live', ['to' => 'role', 'role' => 'project_manager', 'message' => 'Every team has finished the handoff for {client}.', 'also_email' => true], 160, 1420],
    'mgmt'     => ['email', 'Handoff summary to management', ['to' => 'team', 'team_id' => $teamId['pm'], 'subject' => '{client}: handoff complete',
                    'body' => "Kick-off, strategy, website, shoot plan and the first content calendar for {client} are all approved.\n\nOpen the client: {link}"], 160, 1550],
], [
    ['start', 'kickoff', 'next'], ['kickoff', 'tellCr', 'next'], ['tellCr', 'strategy', 'next'], ['strategy', 'stratOk', 'next'],
    ['stratOk', 'isEc', 'next'], ['stratOk', 'shoot', 'next'],
    ['isEc', 'store', 'yes'], ['isEc', 'landing', 'no'],
    ['store', 'storeOk', 'next'], ['landing', 'landOk', 'next'], ['storeOk', 'siteDone', 'next'], ['landOk', 'siteDone', 'next'],
    ['shoot', 'shootOk', 'next'],
    ['siteDone', 'calendar', 'next'], ['shootOk', 'calendar', 'next'],
    ['calendar', 'calOk', 'next'], ['calOk', 'tellPm', 'next'], ['tellPm', 'mgmt', 'next'],
], [
    ['name' => 'When a client is added', 'type' => 'event', 'event' => 'client.added'],
]);

// 2. Monthly content cycle for retainer clients.
$monthly = $wf('Monthly content cycle', 'Plan, shoot, write and schedule each month’s content for retainer clients', true, [
    'cal'      => ['task', 'Plan the content calendar', ['team_id' => $teamId['creative'], 'assignee' => 'client_lead', 'due_days' => 3, 'asset_format_id' => $formatId['Content Calendar'],
                    'description' => 'Plan {period} posts for {client}. Fill in the Content Calendar format.'], 160, 120],
    'calOk'    => ['approval', 'Creative Head approves', ['approver_role' => 'creative_head'], 160, 250],
    'shoot'    => ['task', 'Shoot requirements', ['team_id' => $teamId['shoot'], 'assignee' => 'client_lead', 'due_days' => 4, 'asset_format_id' => $formatId['Shoot Requirements'],
                    'description' => 'Brief for the {period} shoot.'], -40, 400],
    'shootOk'  => ['approval', 'Creative Head approves', ['approver_role' => 'creative_head'], -40, 530],
    'wait'     => ['wait', 'Give the shoot team time', ['amount' => 2, 'unit' => 'days'], -40, 660],
    'deliver'  => ['task', 'Shoot delivery', ['team_id' => $teamId['shoot'], 'assignee' => 'client_lead', 'due_days' => 5, 'asset_format_id' => $formatId['Shoot Delivery']], -40, 790],
    'captions' => ['task', 'Write the captions', ['team_id' => $teamId['digital'], 'assignee' => 'client_lead', 'due_days' => 5,
                    'description' => 'Captions and hashtags for every post in the {period} calendar.'], 360, 400],
    'capOk'    => ['approval', 'Creative Head approves', ['approver_role' => 'creative_head'], 360, 530],
    'schedule' => ['task', 'Schedule the posts', ['team_id' => $teamId['digital'], 'assignee' => 'client_lead', 'due_days' => 2, 'join' => 'all'], 160, 940],
    'pmOk'     => ['approval', 'Project Manager approves', ['approver_role' => 'project_manager'], 160, 1070],
    'done'     => ['notify', '{period} content scheduled for {client}', ['to' => 'role', 'role' => 'project_manager', 'message' => 'Everything for {period} is approved and scheduled.', 'also_email' => true], 160, 1200],
    'wa'       => ['whatsapp', 'WhatsApp the client’s PM', ['to' => 'client_lead', 'team_id' => $teamId['pm'], 'message' => '{client}: {period} content is approved and scheduled.'], 160, 1330],
], [
    ['start', 'cal', 'next'], ['cal', 'calOk', 'next'], ['calOk', 'shoot', 'next'], ['calOk', 'captions', 'next'],
    ['shoot', 'shootOk', 'next'], ['shootOk', 'wait', 'next'], ['wait', 'deliver', 'next'], ['deliver', 'schedule', 'next'],
    ['captions', 'capOk', 'next'], ['capOk', 'schedule', 'next'],
    ['schedule', 'pmOk', 'next'], ['pmOk', 'done', 'next'], ['done', 'wa', 'next'],
], [
    ['name' => 'On the 1st of every month', 'type' => 'schedule', 'frequency' => 'monthly', 'month_day' => 1, 'at_time' => '09:00', 'client_status' => 'retainer'],
]);

// 3. Website launch checks, run by hand.
$wf('Website launch', 'Checks before an e-commerce store goes live, then start the monthly cycle', false, [
    'isEc'    => ['condition', 'E-commerce client?', ['field' => 'client.type', 'op' => 'is', 'value' => 'ecommerce'], 160, 120],
    'site'    => ['task', 'Website checklist', ['team_id' => $teamId['tech'], 'assignee' => 'client_lead', 'due_days' => 5, 'asset_format_id' => $formatId['Website Check List']], -40, 270],
    'siteOk'  => ['approval', 'Tech Lead approves', ['approver_role' => 'tech_lead'], -40, 400],
    'seo'     => ['task', 'SEO checklist', ['team_id' => $teamId['tech'], 'assignee' => 'least_busy', 'due_days' => 3, 'asset_format_id' => $formatId['Website SEO Check List']], -40, 530],
    'seoOk'   => ['approval', 'Tech Lead approves', ['approver_role' => 'tech_lead'], -40, 660],
    'digital' => ['notify', '{client} website is ready', ['to' => 'team', 'team_id' => $teamId['digital'], 'message' => 'The site passed both checklists. Start the launch campaign.'], -40, 790],
    'chain'   => ['start_workflow', 'Start the monthly cycle', ['workflow_id' => $monthly], -40, 920],
    'notEc'   => ['notify', 'Not an e-commerce client', ['to' => 'role', 'role' => 'project_manager', 'message' => '{client} is not an e-commerce client, so the website launch was skipped.'], 360, 270],
], [
    ['start', 'isEc', 'next'], ['isEc', 'site', 'yes'], ['isEc', 'notEc', 'no'],
    ['site', 'siteOk', 'next'], ['siteOk', 'seo', 'next'], ['seo', 'seoOk', 'next'], ['seoOk', 'digital', 'next'], ['digital', 'chain', 'next'],
], []);

// Runs in progress so the board shows handoffs: Lushra has team leads; Mooie has none, so its tasks go to the least busy person.
\App\Services\Workflows::start($monthly, $lushraClient, $userId['Arjun'], null, date('Y-m'));
\App\Services\Workflows::start($handoff, (int) Db::value("SELECT id FROM brands WHERE name = 'Mooie'"), $userId['Arjun']);
echo "Workflows created.\n\n";

echo "Done. Sign in with admin@brandos.local / password123.\n";
echo "Other people: arjun@ (Project Manager), nithya@ (Creative Head), priya@, sanjay@, karthik@, rahul@ (Tech Lead), meena@ — all @brandos.local.\n";
echo "Change every password before adding real client data.\n";
