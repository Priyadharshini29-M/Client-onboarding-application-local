<?php
declare(strict_types=1);

namespace App\Services;

/**
 * The two kinds of client we take on. Each type decides the intake form, the project flow
 * and which details we keep on the client's profile.
 */
class ClientTypes
{
    public const TYPES = ['ecommerce', 'lead_gen'];

    /** Profile fields allowed per type (the frontend decides how each is shown). */
    public const PROFILE_KEYS = [
        'ecommerce' => [
            'store_url', 'platform', 'category', 'sku_count', 'avg_order_value', 'monthly_orders',
            'marketplaces', 'payment_gateway', 'shipping_partner', 'instagram', 'gst_number', 'monthly_ad_budget',
        ],
        'lead_gen' => [
            'services', 'service_areas', 'monthly_lead_target', 'target_cpl', 'monthly_ad_budget',
            'lead_destination', 'crm', 'landing_page_url', 'sales_team_size', 'instagram', 'facebook_page', 'gst_number',
        ],
    ];

    /** Keeps only known keys for the type, trimmed and length-limited. */
    public static function cleanProfile(string $type, array $profile): array
    {
        $out = [];
        foreach (self::PROFILE_KEYS[$type] ?? [] as $key) {
            if (!array_key_exists($key, $profile)) continue;
            $v = $profile[$key];
            if (is_array($v)) $v = implode(', ', array_map('strval', $v));
            $v = mb_substr(trim((string) $v), 0, 500);
            if ($v !== '') $out[$key] = $v;
        }
        return $out;
    }
}
