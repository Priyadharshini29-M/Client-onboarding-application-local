import type { BrandType } from './types'

export interface ProfileField {
  key: string
  label: string
  kind: 'text' | 'url' | 'number' | 'select' | 'money'
  options?: string[]
  placeholder?: string
  /** Asked for when the client is first added (the rest are in Edit details). */
  quick?: boolean
}

export interface ClientTypeDef {
  key: BrandType
  label: string
  short: string
  description: string
  industryHint: string
  fields: ProfileField[]
}

/** The two kinds of client. Each decides the intake form, the project flow and the details we keep. */
export const CLIENT_TYPES: Record<BrandType, ClientTypeDef> = {
  ecommerce: {
    key: 'ecommerce',
    label: 'E-commerce brand',
    short: 'E-commerce',
    description: 'Product brands selling online. Brand identity, product shoot, online store and launch.',
    industryHint: 'e.g. Skincare, Fashion, Food',
    fields: [
      { key: 'store_url', label: 'Store link', kind: 'url', placeholder: 'https://yourstore.com', quick: true },
      { key: 'platform', label: 'Store platform', kind: 'select', options: ['Shopify', 'WooCommerce', 'Custom website', 'Marketplaces only', 'Not built yet'], quick: true },
      { key: 'category', label: 'Main product category', kind: 'text', placeholder: 'e.g. Skincare, Ethnic wear', quick: true },
      { key: 'sku_count', label: 'Number of products (SKUs)', kind: 'number', placeholder: 'e.g. 40' },
      { key: 'avg_order_value', label: 'Average order value', kind: 'money', placeholder: 'e.g. 1200' },
      { key: 'monthly_orders', label: 'Orders per month', kind: 'number', placeholder: 'e.g. 800' },
      { key: 'marketplaces', label: 'Also sells on', kind: 'text', placeholder: 'e.g. Amazon, Flipkart, Myntra, Nykaa' },
      { key: 'payment_gateway', label: 'Payment gateway', kind: 'select', options: ['Razorpay', 'PhonePe', 'Cashfree', 'PayU', 'Shopify Payments', 'Not decided'] },
      { key: 'shipping_partner', label: 'Shipping partner', kind: 'text', placeholder: 'e.g. Shiprocket, Delhivery' },
      { key: 'monthly_ad_budget', label: 'Monthly ad budget', kind: 'money', placeholder: 'e.g. 100000', quick: true },
      { key: 'instagram', label: 'Instagram handle', kind: 'text', placeholder: '@brand' },
      { key: 'gst_number', label: 'GST number', kind: 'text', placeholder: '15-character GSTIN' },
    ],
  },
  lead_gen: {
    key: 'lead_gen',
    label: 'Lead generation',
    short: 'Lead gen',
    description: 'Service businesses that need enquiries. Offer, ad creatives, landing page, tracking and campaigns.',
    industryHint: 'e.g. Healthcare, Real estate, Education',
    fields: [
      { key: 'services', label: 'Services offered', kind: 'text', placeholder: 'e.g. Braces, implants, whitening', quick: true },
      { key: 'service_areas', label: 'Areas served', kind: 'text', placeholder: 'e.g. Chennai, Coimbatore', quick: true },
      { key: 'monthly_lead_target', label: 'Leads needed per month', kind: 'number', placeholder: 'e.g. 300', quick: true },
      { key: 'target_cpl', label: 'Target cost per lead', kind: 'money', placeholder: 'e.g. 150' },
      { key: 'monthly_ad_budget', label: 'Monthly ad budget', kind: 'money', placeholder: 'e.g. 60000', quick: true },
      { key: 'lead_destination', label: 'Where leads go', kind: 'select', options: ['WhatsApp', 'CRM', 'Google Sheet', 'Email'] },
      { key: 'crm', label: 'CRM', kind: 'text', placeholder: 'e.g. Zoho, LeadSquared, HubSpot' },
      { key: 'landing_page_url', label: 'Landing page / website', kind: 'url', placeholder: 'https://' },
      { key: 'sales_team_size', label: 'People following up on leads', kind: 'number', placeholder: 'e.g. 3' },
      { key: 'facebook_page', label: 'Facebook page', kind: 'url', placeholder: 'https://facebook.com/…' },
      { key: 'instagram', label: 'Instagram handle', kind: 'text', placeholder: '@business' },
      { key: 'gst_number', label: 'GST number', kind: 'text', placeholder: '15-character GSTIN' },
    ],
  },
}

export function formatProfileValue(f: ProfileField, v: string | undefined): string {
  if (!v) return '—'
  if (f.kind === 'money') return `₹${Number(v).toLocaleString('en-IN')}`
  if (f.kind === 'number') return Number(v).toLocaleString('en-IN')
  if (f.kind === 'url') return v.replace(/^https?:\/\//, '')
  return v
}
