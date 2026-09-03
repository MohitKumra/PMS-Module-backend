// backend/src/services/billingDocuments.service.ts
// Shared invoice document rendering for PDF download links and email receipts.

import { env } from '../config/env';
import { renderInvoiceReceipt } from '../lib/mailer';
import { getCachedInvoiceSettings } from './systemSettings.service';

export interface BillingInvoiceDocument {
  userId: string;
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    currency: string;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    cgstCents: number;
    sgstCents: number;
    igstCents: number;
    sac?: string | null;
    placeOfSupply?: string | null;
    totalCents: number;
    issuedAt: Date;
    paidAt?: Date | null;
    dueAt?: Date | null;
    pdfUrl?: string | null;
  };
  user: {
    email: string;
    name?: string | null;
  };
  billingProfile?: BillingCustomerProfile | null;
  planName?: string | null;
  planSlug?: string | null;
  subscriptionId?: string | null;
  transactionId?: string | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  providerSubscriptionId?: string | null;
  autoRenew?: boolean | null;
  billingInterval?: string | null;
  planEnd?: Date | null;
}

export interface BillingCompanyProfile {
  name: string;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  sac: string | null;
  notes: string;
  addressLines: string[];
  placeOfSupply: string | null;
}

export interface BillingCustomerProfile {
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  cityState: string | null;
  postalCode: string | null;
  addressLines: string[];
  country: string | null;
}

export function getBillingCompanyProfile(): BillingCompanyProfile {
  // Admin-overridable invoice settings (DB-backed, loaded at bootstrap). Company
  // identity, SAC, contact + place of supply fall back to env when not configured
  // by an admin via Admin → Billing → Invoice Settings.
  const invSettings = getCachedInvoiceSettings();

  const addressLines = [
    invSettings.addressLine1?.trim() || env.COMPANY_ADDRESS_LINE1,
    invSettings.addressLine2?.trim() || env.COMPANY_ADDRESS_LINE2,
    `${invSettings.cityState?.trim() || env.COMPANY_CITY_STATE}, ${invSettings.pincode?.trim() || env.COMPANY_PINCODE}`,
  ].filter(Boolean);

  return {
    name: invSettings.companyName?.trim() || env.COMPANY_NAME || 'Finamite Solutions LLP',
    gstin: invSettings.gstin?.trim() || env.COMPANY_GSTIN?.trim() || null,
    email: invSettings.supportEmail?.trim() || env.COMPANY_EMAIL?.trim() || null,
    phone: env.COMPANY_PHONE?.trim() || null,
    website: env.COMPANY_WEBSITE?.trim() || null,
    sac: invSettings.sac?.trim() || env.COMPANY_SAC?.trim() || null,
    notes: invSettings.notes?.trim() || 'All monthly and usage payments are non-refundable.',
    addressLines,
    placeOfSupply: invSettings.placeOfSupply?.trim() || env.COMPANY_PLACE_OF_SUPPLY?.trim() || null,
  };
}

/** Resolve CGST / SGST / IGST split for an invoice from its persisted breakdown.
 *  Falls back to the legacy 50/50 CGST+SGST split only for pre-migration invoices
 *  that have tax but no persisted breakdown — it never re-derives from the current
 *  customer profile (historical invoices stay stable). */
export function resolveInvoiceTaxBreakdown(invoice: {
  taxCents: number;
  cgstCents?: number;
  sgstCents?: number;
  igstCents?: number;
}): { cgst: number; sgst: number; igst: number } {
  const hasBreakdown =
    (invoice.cgstCents || 0) > 0 ||
    (invoice.sgstCents || 0) > 0 ||
    (invoice.igstCents || 0) > 0;

  if (hasBreakdown) {
    return {
      cgst: invoice.cgstCents || 0,
      sgst: invoice.sgstCents || 0,
      igst: invoice.igstCents || 0,
    };
  }

  // Legacy pre-migration invoice: keep the old 50/50 CGST+SGST split.
  const cgst = Math.floor(invoice.taxCents / 2);
  return { cgst, sgst: invoice.taxCents - cgst, igst: 0 };
}

// Indian state names → 2-digit GST state codes (POS codes). Used to decide
// intra-state (CGST+SGST) vs inter-state (IGST) supply.
const INDIAN_STATE_CODES: Record<string, string> = {
  'andaman and nicobar islands': '35',
  'andhra pradesh': '37',
  'arunachal pradesh': '12',
  assam: '18',
  bihar: '10',
  chandigarh: '04',
  chhattisgarh: '22',
  dadraAndNagarHaveliAnddamananddiu: '26',
  delhi: '07',
  goa: '30',
  gujarat: '24',
  haryana: '06',
  'himachal pradesh': '02',
  'jammu and kashmir': '01',
  jharkhand: '20',
  karnataka: '29',
  kerala: '32',
  ladakh: '38',
  'lakshadweep islands': '31',
  'madhya pradesh': '23',
  maharashtra: '27',
  manipur: '14',
  meghalaya: '17',
  mizoram: '15',
  nagaland: '13',
  'odisha': '21',
  puducherry: '34',
  punjab: '03',
  rajasthan: '08',
  sikkim: '11',
  'tamil nadu': '33',
  telangana: '36',
  tripura: '16',
  'uttar pradesh': '09',
  uttarakhand: '05',
  'west bengal': '19',
  'andaman & nicobar islands': '35',
  'dadra & nagar haveli and daman & diu': '26',
  'jammu & kashmir': '01',
};

/** Normalize a state/place-of-supply string to its 2-digit GST code, or null. */
export function resolveStateCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Already a bare 2-digit code.
  if (/^\d{2}$/.test(trimmed)) return trimmed;
  // Extract a parenthesised code, e.g. "Punjab (03)".
  const paren = trimmed.match(/\((\d{2})\)/);
  if (paren) return paren[1];
  const normalized = trimmed.replace(/[^a-z]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return INDIAN_STATE_CODES[normalized] || null;
}

/** Decide the GST tax split for a fresh transaction from the supplier's place of
 *  supply and the buyer's billing location. Buyer state resolution follows the
 *  supplier state when the buyer's location is unavailable (intra-state by
 *  default), and falls back to IGST when we know the states differ or the buyer
 *  is outside India. */
export function resolveGstBreakdownForNewInvoice(params: {
  taxCents: number;
  supplierPlaceOfSupply?: string | null;
  buyerCityState?: string | null;
  buyerGstin?: string | null;
  buyerCountry?: string | null;
}): { cgstCents: number; sgstCents: number; igstCents: number } {
  const { taxCents, buyerCountry } = params;
  const isIndia = !buyerCountry || /india/i.test(buyerCountry);

  if (!isIndia) {
    // Inter-state (export/foreign) → full IGST.
    return { cgstCents: 0, sgstCents: 0, igstCents: taxCents };
  }

  const supplierCode = resolveStateCode(params.supplierPlaceOfSupply);
  // Buyer state from GSTIN (first two digits) is the most reliable signal.
  const gstinCode = params.buyerGstin ? /^(\d{2})/.exec(params.buyerGstin.trim())?.[1] || null : null;
  const cityStateCode = resolveStateCode(params.buyerCityState);
  const buyerCode = gstinCode || cityStateCode;

  // Unknown buyer state → default to intra-state (supplier-state fallback).
  if (!buyerCode || !supplierCode) {
    const cgst = Math.floor(taxCents / 2);
    return { cgstCents: cgst, sgstCents: taxCents - cgst, igstCents: 0 };
  }

  if (buyerCode === supplierCode) {
    const cgst = Math.floor(taxCents / 2);
    return { cgstCents: cgst, sgstCents: taxCents - cgst, igstCents: 0 };
  }

  // Different states → inter-state.
  return { cgstCents: 0, sgstCents: 0, igstCents: taxCents };
}

export function getInvoicePdfPath(invoiceId: string): string {
  return `/api/billing/invoices/${invoiceId}/pdf`;
}

export function getInvoiceFrontendUrl(invoiceId?: string): string {
  return `${env.FRONTEND_URL}/settings?tab=billing${invoiceId ? `&invoiceId=${invoiceId}` : ''}`;
}

export function getInvoicePdfUrl(invoiceId: string): string {
  return `${env.BACKEND_URL}/api/billing/invoices/${invoiceId}/pdf`;
}

function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);
}

function moneyWords(amountCents: number): string {
  const rupees = Math.max(0, Math.floor(amountCents / 100));
  if (rupees === 0) return 'Rupees Zero Only';
  const words: string[] = [];
  const scales = [
    { value: 10000000, label: 'Crore' },
    { value: 100000, label: 'Lakh' },
    { value: 1000, label: 'Thousand' },
    { value: 100, label: 'Hundred' },
  ];
  const ones = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function belowHundred(n: number): string {
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return `${tens[t]}${o ? ` ${ones[o]}` : ''}`;
  }
  function belowThousand(n: number): string {
    if (n < 100) return belowHundred(n);
    const h = Math.floor(n / 100);
    const r = n % 100;
    return `${ones[h]} Hundred${r ? ` ${belowHundred(r)}` : ''}`;
  }
  let remaining = rupees;
  for (const scale of scales) {
    if (remaining >= scale.value) {
      const q = Math.floor(remaining / scale.value);
      words.push(`${belowThousand(q)} ${scale.label}`);
      remaining %= scale.value;
    }
  }
  if (remaining > 0) words.push(belowThousand(remaining));
  return `Rupees ${words.join(' ')} Only`;
}

export function buildBillingCustomerProfile(input: {
  name?: string | null;
  email?: string | null;
  billingCompanyName?: string | null;
  billingEmail?: string | null;
  billingPhone?: string | null;
  billingAddressLine1?: string | null;
  billingCityState?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;
  billingGstin?: string | null;
}): BillingCustomerProfile {
  const addressLines = [
    input.billingAddressLine1,
    [input.billingCityState, input.billingPostalCode].filter(Boolean).join(' ').trim(),
  ].filter((line): line is string => Boolean(line && line.trim()));

  return {
    companyName: input.billingCompanyName?.trim() || null,
    contactName: input.name?.trim() || null,
    email: input.billingEmail?.trim() || input.email?.trim() || null,
    phone: input.billingPhone?.trim() || null,
    gstin: input.billingGstin?.trim() || null,
    cityState: input.billingCityState?.trim() || null,
    postalCode: input.billingPostalCode?.trim() || null,
    addressLines,
    country: input.billingCountry?.trim() || null,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function moneyText(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);
}

function renderHtmlLines(lines: Array<string | null | undefined>): string {
  return lines
    .filter((line): line is string => Boolean(line && line.trim()))
    .map((line) => escapeHtml(line))
    .map((line) => `<div class="line">${line}</div>`)
    .join('\n');
}

export function buildInvoiceHtml(doc: BillingInvoiceDocument): string {
  const companyProfile = getBillingCompanyProfile();
  const billToProfile = doc.billingProfile || buildBillingCustomerProfile(doc.user);
  const invoiceIssuedAt = doc.invoice.issuedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const nextInvoiceAt = doc.planEnd
    ? doc.planEnd.toLocaleDateString('en-IN', { dateStyle: 'medium' })
    : doc.invoice.dueAt
      ? doc.invoice.dueAt.toLocaleDateString('en-IN', { dateStyle: 'medium' })
      : 'Not set';
  const billToName = billToProfile.companyName || doc.user.name || doc.user.email.split('@')[0] || 'Customer';
  const billToAddressLines = Array.isArray(billToProfile.addressLines)
    ? billToProfile.addressLines
    : [];
  const billToLines = [
    billToProfile.email || doc.user.email,
    ...billToAddressLines,
    [billToProfile.postalCode, billToProfile.country].filter(Boolean).join(', ') || null,
    billToProfile.gstin ? `GSTIN: ${billToProfile.gstin}` : null,
  ];
  const shipToLines = [
    ...billToAddressLines,
    [billToProfile.postalCode, billToProfile.country].filter(Boolean).join(', ') || null,
    billToProfile.gstin ? `GSTIN: ${billToProfile.gstin}` : null,
  ];
  const itemAmount = moneyText(doc.invoice.totalCents, doc.invoice.currency);
  const subtotal = moneyText(doc.invoice.subtotalCents, doc.invoice.currency);
  const tax = resolveInvoiceTaxBreakdown(doc.invoice);
  const cgst = moneyText(tax.cgst, doc.invoice.currency);
  const sgst = moneyText(tax.sgst, doc.invoice.currency);
  const igst = moneyText(tax.igst, doc.invoice.currency);
  const discount = moneyText(doc.invoice.discountCents, doc.invoice.currency);
  const paymentMode = doc.autoRenew ? 'Auto-pay' : 'No payment required';
  const itemName = doc.planName || doc.planSlug || 'Plan purchase';
  const subscriptionRef = doc.subscriptionId || '-';
  // Unless a specific SAC was snapshotted on this invoice, fall back to the
  // configured default (admin Invoice Settings → env).
  const sac = doc.invoice.sac?.trim() || companyProfile.sac?.trim() || '—';
  const notesText = companyProfile.notes || 'All monthly and usage payments are non-refundable.';
  const supportEmail = companyProfile.email || 'billing@finamite.in';

  // Only render the tax rows that actually apply (CGST+SGST intra-state, IGST inter-state).
  const summaryTaxRows =
    (tax.cgst > 0 ? `<div class="row"><span>CGST</span><span class="amount">${escapeHtml(cgst)}</span></div>` : '') +
    (tax.sgst > 0 ? `<div class="row"><span>SGST</span><span class="amount">${escapeHtml(sgst)}</span></div>` : '') +
    (tax.igst > 0 ? `<div class="row"><span>IGST</span><span class="amount">${escapeHtml(igst)}</span></div>` : '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Tax Invoice ${escapeHtml(doc.invoice.invoiceNumber)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #1e293b;
    margin: 0;
    padding: 24px;
    background: #f6f8fc;
  }
  .invoice {
    max-width: 900px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e2e8f0;
  }
  .top-bar { height: 6px; background: linear-gradient(90deg, #6c63ff, #4a43cc); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding: 26px 40px 18px 40px; }
  .brand h1 { margin: 0; font-size: 28px; color: #6c63ff; letter-spacing: 0.5px; }
  .brand .sub { margin-top: 5px; font-size: 12px; letter-spacing: 3px; color: #94a3b8; text-transform: uppercase; }
  .invoice-meta { text-align: right; }
  .invoice-meta .tag { font-size: 11px; letter-spacing: 2px; color: #94a3b8; text-transform: uppercase; margin-bottom: 5px; }
  .invoice-meta .inv-no { font-size: 21px; font-weight: 700; color: #111827; }
  .invoice-meta .status { font-size: 12px; color: #475569; margin-top: 3px; }
  .invoice-meta .status .dot { color: #6c63ff; font-weight: 700; }
  .invoice-meta .sub-id { font-size: 12px; color: #94a3b8; }
  hr.divider { border: none; border-top: 1px solid #e2e8f0; margin: 0 40px; }
  .parties { display: flex; justify-content: space-between; padding: 20px 40px; gap: 40px; }
  .party { flex: 1; }
  .party .heading { font-size: 11px; letter-spacing: 1.5px; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; }
  .party.right .heading { text-align: right; }
  .party .name { font-weight: 700; font-size: 14px; color: #111827; margin-bottom: 5px; }
  .party.right .name { text-align: right; }
  .party .line { font-size: 12px; color: #475569; line-height: 1.55; }
  .party.right .line { text-align: right; }
  .party .line b { color: #334155; }
  .ship-to { margin-top: 14px; }
  .info-strip { display: flex; justify-content: space-between; padding: 14px 40px; background: #f8fafc; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
  .info-strip .item .label { font-size: 10px; letter-spacing: 1.5px; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px; }
  .info-strip .item .value { font-size: 13px; font-weight: 600; color: #111827; }
  table.items { width: 100%; border-collapse: collapse; margin: 20px 0 0 0; }
  table.items th { text-align: left; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; padding: 0 40px 8px 40px; border-bottom: 1px solid #e2e8f0; }
  table.items th.num, table.items td.num { text-align: right; }
  table.items td { padding: 10px 40px; font-size: 13px; color: #1e293b; border-bottom: 1px solid #f1f5f9; }
  table.items td.item-name { font-weight: 600; }
  table.items td.total-cell { font-weight: 700; }
  .summary-row { display: flex; gap: 20px; padding: 20px 40px 6px 40px; }
  .summary-box { flex: 1; background: #f8fafc; border-radius: 10px; padding: 16px 20px; }
  .summary-box .heading { font-size: 10.5px; letter-spacing: 1.5px; color: #94a3b8; text-transform: uppercase; margin-bottom: 10px; }
  .summary-box .row { display: flex; justify-content: space-between; font-size: 13px; color: #475569; padding: 4px 0; }
  .summary-box .row.discount .amount { color: #dc2626; }
  .summary-box .row.total { border-top: 2px solid #111827; margin-top: 6px; padding-top: 9px; font-weight: 700; font-size: 14px; color: #111827; }
  .summary-box .row.total .amount { color: #6c63ff; }
  .payment-box + .words-box { margin-top: 14px; }
  .words-box .heading { font-size: 10.5px; letter-spacing: 1.5px; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; }
  .words-box .amount-text { font-weight: 700; font-size: 13px; color: #111827; }
  .footer-notes { padding: 16px 40px 10px 40px; font-size: 12px; color: #475569; line-height: 1.6; }
  .footer-notes b { color: #334155; }
  .footer-bar { text-align: center; padding: 13px; font-size: 11px; color: #6c63ff; font-weight: 600; border-top: 1px solid #e2e8f0; background: #f8fafc; }
  @media print {
    body { background: #ffffff; padding: 0; }
    .invoice { border: none; border-radius: 0; }
  }
</style>
</head>
<body>
  <div class="invoice">
    <div class="top-bar"></div>
    <div class="header">
      <div class="brand">
        <h1>${escapeHtml(companyProfile.name)}</h1>
        <div class="sub">Subscription Invoice</div>
      </div>
      <div class="invoice-meta">
        <div class="tag">Tax Invoice</div>
        <div class="inv-no">${escapeHtml(doc.invoice.invoiceNumber)}</div>
        <div class="status"><span class="dot">●</span> Status: ${escapeHtml(doc.invoice.status)}</div>
        <div class="sub-id">Subscription: ${escapeHtml(subscriptionRef)}</div>
      </div>
    </div>
    <hr class="divider">
    <div class="parties">
      <div class="party">
        <div class="heading">Supplier</div>
        <div class="name">${escapeHtml(companyProfile.name.toUpperCase())}</div>
        <div class="line"><b>GSTIN:</b> ${escapeHtml(companyProfile.gstin || '-')}</div>
        <div class="line"><b>Address:</b> ${escapeHtml(companyProfile.addressLines.join(', '))}</div>
        <div class="line"><b>Place of Supply:</b> ${escapeHtml(companyProfile.placeOfSupply || '-')}</div>
      </div>
      <div class="party right">
        <div class="heading">Bill To</div>
        <div class="name">${escapeHtml(billToName)}</div>
        <div class="line">${renderHtmlLines(billToLines)}</div>
        <div class="ship-to">
          <div class="heading">Ship To</div>
          <div class="name">${escapeHtml(billToName)}</div>
          <div class="line">${renderHtmlLines(shipToLines)}</div>
        </div>
      </div>
    </div>
    <div class="info-strip">
      <div class="item"><div class="label">Invoice No.</div><div class="value">${escapeHtml(doc.invoice.invoiceNumber)}</div></div>
      <div class="item"><div class="label">Purchase Date</div><div class="value">${escapeHtml(invoiceIssuedAt)}</div></div>
      <div class="item"><div class="label">Next Invoice</div><div class="value">${escapeHtml(nextInvoiceAt)}</div></div>
      <div class="item"><div class="label">Status</div><div class="value">${escapeHtml(doc.invoice.status)}</div></div>
    </div>
    <table class="items">
      <thead>
        <tr>
          <th>Sr.No</th>
          <th>Item</th>
          <th>SAC</th>
          <th class="num">Qty</th>
          <th class="num">Taxable</th>
          <th class="num">CGST</th>
          <th class="num">SGST</th>
          <th class="num">IGST</th>
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td class="item-name">${escapeHtml(itemName)}</td>
          <td>${escapeHtml(sac)}</td>
          <td class="num">1</td>
          <td class="num">${escapeHtml(subtotal)}</td>
          <td class="num">${escapeHtml(cgst)}</td>
          <td class="num">${escapeHtml(sgst)}</td>
          <td class="num">${escapeHtml(igst)}</td>
          <td class="num total-cell">${escapeHtml(itemAmount)}</td>
        </tr>
      </tbody>
    </table>
    <div class="summary-row">
      <div class="summary-box">
        <div class="heading">Charges Summary</div>
        <div class="row"><span>Sub total</span><span class="amount">${escapeHtml(subtotal)}</span></div>
        ${summaryTaxRows}
        <div class="row discount"><span>Discount</span><span class="amount">-${escapeHtml(discount)}</span></div>
        <div class="row total"><span>Total</span><span class="amount">${escapeHtml(itemAmount)}</span></div>
      </div>
      <div class="summary-box">
        <div class="payment-box">
          <div class="heading">Payment</div>
          <div class="row"><span>Payment mode</span><span class="amount">${escapeHtml(paymentMode)}</span></div>
          <div class="row"><span>Due amount</span><span class="amount">${escapeHtml(itemAmount)}</span></div>
        </div>
        <div class="words-box">
          <div class="heading">Amount in Words</div>
          <div class="amount-text">${escapeHtml(moneyWords(doc.invoice.totalCents))}</div>
        </div>
      </div>
    </div>
    <div class="footer-notes">
      <div><b>Payment ref:</b> ${escapeHtml(doc.providerPaymentId || 'NA')}</div>
      <div style="margin-top:6px;"><b>Notes:</b> ${escapeHtml(notesText)} For any query, contact ${escapeHtml(supportEmail)}.</div>
    </div>
    <div class="footer-bar">Powered by ${escapeHtml(companyProfile.name)}</div>
  </div>
</body>
</html>`;
}

export async function buildInvoicePdfBuffer(doc: BillingInvoiceDocument): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
    await page.setContent(buildInvoiceHtml(doc), { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export function buildInvoiceEmailHtml(doc: BillingInvoiceDocument): string {
  const company = getBillingCompanyProfile();
  const link = getInvoiceFrontendUrl(doc.invoice.id);
  const planLabel = doc.planName || doc.planSlug || 'your plan';
  return renderInvoiceReceipt({
    companyName: company.name,
    invoiceNumber: doc.invoice.invoiceNumber,
    planLabel,
    amount: formatMoney(doc.invoice.totalCents, doc.invoice.currency),
    status: doc.invoice.status,
    paidAtText: doc.invoice.paidAt ? doc.invoice.paidAt.toLocaleString('en-IN') : 'Pending',
    pdfLink: link,
  });
}
