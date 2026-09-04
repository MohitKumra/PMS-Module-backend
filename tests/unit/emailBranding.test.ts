import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import {
  renderSubscriptionUpgraded,
  renderSubscriptionCancelled,
  renderInvoiceReceipt,
  renderCustomPlanAdminNotify,
  resolveLogoPath,
} from '../../src/lib/mailer';
import { loadSystemSettings } from '../../src/services/systemSettings.service';

describe('Email Branding & Logo Integration', () => {
  beforeAll(async () => {
    await loadSystemSettings();
  });

  it('resolves a valid, existing logo.png on disk', () => {
    const logoPath = resolveLogoPath();
    expect(logoPath).not.toBeNull();
    expect(fs.existsSync(logoPath!)).toBe(true);
    const stat = fs.statSync(logoPath!);
    expect(stat.size).toBeGreaterThan(1000); // Verify it's a real non-empty PNG
  });

  it('renders email templates with cid:brand-logo and website name in header', () => {
    const html = renderSubscriptionUpgraded({
      planName: 'Pro Monthly',
      amountPaid: '₹1,999',
      periodEnd: '3 Oct 2026',
    });

    expect(html).toContain('cid:brand-logo');
    expect(html).toContain('finamite.in');
    expect(html).toContain('https://finamite.in');
    // Ensure the header does NOT render the raw legal entity LLP name
    expect(html).not.toContain('<span style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;color:#1A1A18;vertical-align:middle;padding-left:9px;">FINAMITE SOLUTIONS LLP</span>');
  });

  it('renders invoice receipt with brand logo, website link, and legal company in footer', () => {
    const html = renderInvoiceReceipt({
      invoiceNumber: 'INV-2026-001',
      invoiceDate: '03 Sep 2026',
      amount: '₹1,999',
      planName: 'Pro Monthly',
      billingPeriod: '03 Sep 2026 – 03 Oct 2026',
      viewUrl: 'https://finamite.in/settings?tab=billing',
    });

    expect(html).toContain('cid:brand-logo');
    expect(html).toContain('finamite.in');
  });

  it('renders custom plan admin notify template correctly with all fields', () => {
    const html = renderCustomPlanAdminNotify({
      requestId: 'req_12345',
      customerName: 'Alice Smith',
      customerEmail: 'alice@example.com',
      limitsSummary: '50 projects, 100GB storage',
      featuresSummary: 'Dedicated support, API access',
      requirements: 'Must comply with SOC2 requirements',
      adminUrl: 'https://finamite.in/admin/custom-plans',
    });

    expect(html).toContain('New custom plan request');
    expect(html).toContain('#req_12345');
    expect(html).toContain('Alice Smith');
    expect(html).toContain('alice@example.com');
    expect(html).toContain('50 projects, 100GB storage');
    expect(html).toContain('Dedicated support, API access');
    expect(html).toContain('Must comply with SOC2 requirements');
    expect(html).toContain('https://finamite.in/admin/custom-plans');
    // Ensure no unrendered {{#if}} or {{/if}} tags remain
    expect(html).not.toContain('{{#if');
    expect(html).not.toContain('{{/if}}');
  });

  it('renders custom plan admin notify template correctly when optional fields are omitted', () => {
    const html = renderCustomPlanAdminNotify({
      requestId: 'req_67890',
      customerName: 'Bob Jones',
      customerEmail: 'bob@example.com',
      limitsSummary: '',
      featuresSummary: '',
      requirements: '',
      adminUrl: 'https://finamite.in/admin/custom-plans',
    });

    expect(html).toContain('New custom plan request');
    expect(html).toContain('#req_67890');
    expect(html).toContain('Bob Jones');
    expect(html).toContain('bob@example.com');
    expect(html).not.toContain('Requested limits');
    expect(html).not.toContain('Requested features');
    expect(html).not.toContain('Requirements');
    expect(html).not.toContain('{{#if');
    expect(html).not.toContain('{{/if}}');
  });
});
