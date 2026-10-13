<?php
declare(strict_types=1);

namespace App\Core;

class HttpException extends \RuntimeException
{
    public int $status;
    public ?array $details;

    public function __construct(int $status, string $message, ?array $details = null)
    {
        parent::__construct($message);
        $this->status = $status;
        $this->details = $details;
    }

    public static function notFound(string $what = 'Resource'): self
    {
        return new self(404, "$what not found.");
    }

    public static function forbidden(string $message = 'You do not have permission to do this.'): self
    {
        return new self(403, $message);
    }

    public static function validation(array $errors): self
    {
        return new self(422, 'Please fix the highlighted fields.', $errors);
    }
}
