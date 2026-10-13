<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;

/**
 * "Fill from a document": turns the text of a client's brief into answers for an intake form.
 * The browser extracts the text (PDF, Word, text); this class matches it to the form's questions.
 * Answers are found by matching the document's labels to the question names (no AI).
 * Nothing is saved here: the answers go back to the form, where the person checks them.
 */
class Autofill
{
    public const MAX_CHARS = 150000;
    private const STOP = ['the', 'a', 'an', 'of', 'your', 'our', 'you', 'we', 'is', 'are', 'what', 'which', 'who', 'do', 'does', 'please',
        'and', 'or', 'if', 'any', 'to', 'for', 'in', 'on', 'with', 'this', 'that', 'it', 'its', 'my', 'me', 'us', 'be', 'have', 'has', 'e', 'g', 'eg'];

    /** @return array{values: array<int,string>} */
    public static function suggest(array $template, string $text): array
    {
        $text = trim(mb_substr(str_replace("\r", '', $text), 0, self::MAX_CHARS));
        if (mb_strlen($text) < 10) {
            throw new HttpException(422, 'We could not read any text in that document. If it is a scanned image, please type the answers instead.');
        }
        $fields = [];
        foreach ($template['sections'] as $s) {
            foreach ($s['fields'] as $f) {
                if (in_array($f['type'], ['file', 'secret'], true)) continue;
                $f['section'] = $s['title'];
                $fields[(int) $f['id']] = $f;
            }
        }
        if (!$fields) return ['values' => []];

        return ['values' => self::clean($fields, self::match($fields, $text))];
    }

    // ------------------------------------------------------------------------------ label matching

    /**
     * Finds "Label: value" lines, labels on their own line followed by the answer, and tab-separated
     * table rows, then pairs each question with the most similar label. Emails, phones and links
     * that are left over go to the first empty question of that type.
     * @return array<int,string>
     */
    public static function match(array $fields, string $text): array
    {
        $pairs = self::pairs($text);
        $scores = [];
        foreach ($fields as $id => $f) {
            $want = self::words($f['label']);
            if (!$want) continue;
            foreach ($pairs as $i => [$label, $value]) {
                $s = self::similar($want, self::words($label), $f['label'], $label);
                if ($s >= 0.6) $scores[] = [$s, $id, $i];
            }
        }
        usort($scores, fn($a, $b) => $b[0] <=> $a[0]);
        $values = [];
        $usedPair = [];
        foreach ($scores as [$s, $id, $i]) {
            if (isset($values[$id]) || isset($usedPair[$i])) continue;
            $values[$id] = $pairs[$i][1];
            $usedPair[$i] = true;
        }

        // Leftover contact details
        $found = [
            'email' => preg_match_all('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', $text, $m) ? $m[0] : [],
            'url' => preg_match_all('#\b(?:https?://|www\.)[^\s,;)<>"]+#i', $text, $m) ? $m[0] : [],
            'phone' => preg_match_all('/(?<![\w])\+?\d[\d\s().-]{8,}\d(?![\w])/', $text, $m) ? $m[0] : [],
        ];
        foreach ($fields as $id => $f) {
            if (isset($values[$id]) || !isset($found[$f['type']])) continue;
            foreach ($found[$f['type']] as $k => $v) {
                if (in_array($v, $values, true)) continue;
                $values[$id] = trim($v);
                unset($found[$f['type']][$k]);
                break;
            }
        }
        return $values;
    }

    /** @return array<int, array{0: string, 1: string}> */
    private static function pairs(string $text): array
    {
        $lines = array_map(fn($l) => trim(preg_replace('/[ \x{00A0}]+/u', ' ', $l)), explode("\n", $text));
        $isLabel = fn(string $l) => $l !== '' && mb_strlen($l) <= 90 && (preg_match('/[:?]$/u', $l) === 1);
        $pairs = [];
        $n = count($lines);
        for ($i = 0; $i < $n; $i++) {
            $line = $lines[$i];
            if ($line === '') continue;
            // Table row or "Label: value" / "Label - value" on one line
            if (preg_match('/^([^\t]{2,90})\t+(.+)$/u', $line, $m)
                || preg_match('/^([^:]{2,90}?)\s*[:：]\s*(.+)$/u', $line, $m)
                || preg_match('/^([^–—-]{2,60}?)\s+[–—-]\s+(.+)$/u', $line, $m)
                || preg_match('/^([^?]{3,90}\?)\s+([^?]{1,200})$/u', $line, $m)) {
                $label = trim($m[1]);
                if (!preg_match('#^https?$#i', $label)) {
                    $pairs[] = [$label, trim(str_replace("\t", ' ', $m[2]))];
                    continue;
                }
            }
            // A label on its own line; the answer is the following lines until a blank line or the next label
            if ($isLabel($line)) {
                $answer = [];
                for ($j = $i + 1; $j < $n && $lines[$j] !== '' && !$isLabel($lines[$j]) && count($answer) < 40; $j++) {
                    if (preg_match('/^[^:]{2,60}:\s*\S/u', $lines[$j]) && $answer) break;
                    $answer[] = $lines[$j];
                }
                if ($answer) {
                    $pairs[] = [rtrim($line, ':? '), implode("\n", $answer)];
                    $i = $j - 1;
                }
            }
        }
        return $pairs;
    }

    /** @return string[] */
    private static function words(string $s): array
    {
        $s = mb_strtolower(preg_replace('/\(.*?\)/u', ' ', $s));
        $w = preg_split('/[^\p{L}\p{N}]+/u', $s, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $w = array_map(fn($x) => preg_replace('/(ies|es|s)$/u', '', $x) ?: $x, $w);
        return array_values(array_unique(array_diff($w, self::STOP)));
    }

    private static function similar(array $a, array $b, string $rawA, string $rawB): float
    {
        if (!$b) return 0.0;
        $common = count(array_intersect($a, $b));
        $overlap = $common / min(count($a), count($b));
        $cover = $common / max(count($a), count($b));
        similar_text(implode(' ', $a), implode(' ', $b), $pct);
        $score = max($overlap * 0.6 + $cover * 0.4, $pct / 100);
        if (mb_strtolower(trim($rawA, " :?")) === mb_strtolower(trim($rawB, " :?"))) $score = 1.0;
        return $score;
    }

    // ------------------------------------------------------------------------------------ clean up

    /** Keeps only answers that fit the question type, in the form the form expects. */
    private static function clean(array $fields, array $values): array
    {
        $out = [];
        foreach ($values as $id => $v) {
            $id = (int) $id;
            if (!isset($fields[$id])) continue;
            $f = $fields[$id];
            $v = trim(preg_replace("/[ \t]+/", ' ', (string) $v));
            if ($v === '' || in_array(mb_strtolower($v), ['n/a', 'na', '-', 'none', 'null', 'not provided'], true)) continue;
            switch ($f['type']) {
                case 'email':
                    if (!preg_match('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', $v, $m)) continue 2;
                    $v = $m[0];
                    break;
                case 'url':
                    if (!preg_match('#(?:https?://|www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:/[^\s]*)?#i', $v, $m)) continue 2;
                    $v = preg_match('#^https?://#i', $m[0]) ? $m[0] : 'https://' . $m[0];
                    break;
                case 'phone':
                    if (!preg_match('/\+?\d[\d\s().-]{5,}\d/', $v, $m)) continue 2;
                    $v = trim($m[0]);
                    break;
                case 'number':
                    if (!preg_match('/-?\d[\d,]*(?:\.\d+)?/', $v, $m)) continue 2;
                    $v = str_replace(',', '', $m[0]);
                    break;
                case 'date':
                    $t = strtotime($v);
                    if ($t === false) continue 2;
                    $v = date('Y-m-d', $t);
                    break;
                case 'select':
                    $pick = null;
                    foreach ($f['options'] as $o) if (mb_strtolower($o) === mb_strtolower($v)) $pick = $o;
                    if ($pick === null) foreach ($f['options'] as $o) if (mb_stripos($v, $o) !== false || mb_stripos($o, $v) !== false) { $pick = $o; break; }
                    if ($pick === null) {
                        $best = 0.0;
                        foreach ($f['options'] as $o) {
                            $s = self::similar(self::words($o), self::words($v), $o, $v);
                            if ($s > $best && $s >= 0.75) [$best, $pick] = [$s, $o];
                        }
                    }
                    if ($pick === null) continue 2;
                    $v = $pick;
                    break;
                case 'textarea':
                    break;
                default:
                    $v = mb_substr(str_replace("\n", ' ', $v), 0, 1000);
            }
            $out[$id] = mb_substr($v, 0, 20000);
        }
        return $out;
    }
}
