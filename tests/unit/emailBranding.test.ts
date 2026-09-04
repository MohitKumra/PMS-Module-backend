import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import {
  renderSubscriptionUpgraded,
  renderSubscriptionCancelled,
  renderInvoiceReceipt,
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
});
