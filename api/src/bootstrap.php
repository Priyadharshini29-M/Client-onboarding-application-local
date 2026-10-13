<?php
declare(strict_types=1);

use App\Core\HttpException;
use App\Core\Response;

spl_autoload_register(function (string $class): void {
    if (strpos($class, 'App\\') !== 0) return;
    $path = __DIR__ . '/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($path)) require $path;
});

$configFile = __DIR__ . '/../config.php';
if (!is_file($configFile)) $configFile = __DIR__ . '/../config.example.php';
$GLOBALS['config'] = require $configFile;

// Never serve the app with the example settings: its app_key is public, so saved passwords and API keys could be decrypted.
$appKey = (string) ($GLOBALS['config']['app_key'] ?? '');
if (PHP_SAPI !== 'cli' && (basename($configFile) !== 'config.php' || strlen($appKey) < 32 || str_starts_with($appKey, 'change-me'))) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'The server is not set up yet. Copy api/config.example.php to api/config.php and set a long random app_key.']);
    exit;
}

function config(string $key, $default = null)
{
    $value = $GLOBALS['config'];
    foreach (explode('.', $key) as $part) {
        if (!is_array($value) || !array_key_exists($part, $value)) return $default;
        $value = $value[$part];
    }
    return $value;
}

date_default_timezone_set('Asia/Kolkata');
ini_set('display_errors', '0');

if (PHP_SAPI !== 'cli') {
    set_exception_handler(function (Throwable $e): void {
        if ($e instanceof HttpException) {
            Response::json(['error' => $e->getMessage(), 'details' => $e->details], $e->status);
            return;
        }
        error_log((string) $e);
        Response::json(['error' => 'Something went wrong on the server. Please try again.'], 500);
    });
}
