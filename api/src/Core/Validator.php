<?php
declare(strict_types=1);

namespace App\Core;

class Validator
{
    /**
     * Rules (comma separated): required, email, int, max:N, in:a|b|c, date, bool, array.
     * Returns only the keys listed in $rules. With $partial, missing keys are skipped (for PATCH).
     */
    public static function validate(array $data, array $rules, bool $partial = false): array
    {
        $errors = [];
        $out = [];
        foreach ($rules as $key => $ruleString) {
            $rulesList = explode(',', $ruleString);
            $present = array_key_exists($key, $data);
            $value = $data[$key] ?? null;
            if (is_string($value)) $value = trim($value);
            $required = in_array('required', $rulesList, true);

            if (!$present) {
                if ($required && !$partial) $errors[$key] = 'This field is required.';
                continue;
            }
            if ($value === '' || $value === null) {
                if ($required) { $errors[$key] = 'This field is required.'; continue; }
                $out[$key] = null;
                continue;
            }
            foreach ($rulesList as $rule) {
                [$name, $arg] = array_pad(explode(':', $rule, 2), 2, null);
                switch ($name) {
                    case 'email':
                        if (!filter_var($value, FILTER_VALIDATE_EMAIL)) $errors[$key] = 'Enter a valid email address.';
                        break;
                    case 'int':
                        if (filter_var($value, FILTER_VALIDATE_INT) === false) $errors[$key] = 'Must be a whole number.';
                        else $value = (int) $value;
                        break;
                    case 'max':
                        if (is_string($value) && mb_strlen($value) > (int) $arg) $errors[$key] = "Keep this under $arg characters.";
                        break;
                    case 'in':
                        if (!in_array((string) $value, explode('|', (string) $arg), true)) $errors[$key] = 'Choose one of the allowed options.';
                        break;
                    case 'date':
                        $d = \DateTime::createFromFormat('Y-m-d', (string) $value);
                        if (!$d || $d->format('Y-m-d') !== $value) $errors[$key] = 'Use the format YYYY-MM-DD.';
                        break;
                    case 'bool':
                        $value = filter_var($value, FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
                        break;
                    case 'array':
                        if (!is_array($value)) $errors[$key] = 'Must be a list.';
                        break;
                }
            }
            $out[$key] = $value;
        }
        if ($errors) throw HttpException::validation($errors);
        return $out;
    }
}
