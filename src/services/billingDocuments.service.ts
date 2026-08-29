// backend/src/services/billingDocuments.service.ts
// Shared invoice document rendering for PDF download links and email receipts.

import { env } from '../config/env';

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
  planName?: string | null;
  planSlug?: string | null;
  subscriptionId?: string | null;
  transactionId?: string | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  providerSubscriptionId?: string | null;
  autoRenew?: boolean | null;
  billingInterval?: string | null;
}

export function getInvoicePdfPath(invoiceId: string): string {
  return `/api/billing/invoices/${invoiceId}/pdf`;
}

export function getInvoicePdfUrl(invoiceId: string): string {
  return `${env.BACKEND_URL}${getInvoicePdfPath(invoiceId)}`;
}

function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);
}

function normalizePdfText(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '?');
}

function escapePdfText(value: string): string {
  return normalizePdfText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapLine(value: string, maxLength: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    const next = `${current} ${word}`;
    if (next.length > maxLength) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function buildPdfObject(content: string, objectId: number): string {
  return `${objectId} 0 obj\n${content}\nendobj\n`;
}

export function buildInvoicePdfBuffer(doc: BillingInvoiceDocument): Buffer {
  const issuedAt = doc.invoice.issuedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const paidAt = doc.invoice.paidAt ? doc.invoice.paidAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Pending';
  const dueAt = doc.invoice.dueAt ? doc.invoice.dueAt.toLocaleDateString('en-IN') : 'Not set';
  const planLabel = doc.planName || doc.planSlug || 'Plan purchase';
  const lines = [
    'Finamite Billing Invoice',
    `Invoice #: ${doc.invoice.invoiceNumber}`,
    `Status: ${doc.invoice.status}`,
    `Issued: ${issuedAt}`,
    `Paid: ${paidAt}`,
    `Due: ${dueAt}`,
    `Customer: ${doc.user.name || 'Customer'} <${doc.user.email}>`,
    `Plan: ${planLabel}${doc.billingInterval ? ` (${doc.billingInterval})` : ''}`,
    `Subscription: ${doc.subscriptionId || 'N/A'}`,
    `Provider payment: ${doc.providerPaymentId || 'N/A'}`,
    `Provider order: ${doc.providerOrderId || 'N/A'}`,
    `Provider subscription: ${doc.providerSubscriptionId || 'N/A'}`,
    `Subtotal: ${formatMoney(doc.invoice.subtotalCents, doc.invoice.currency)}`,
    `Discount: -${formatMoney(doc.invoice.discountCents, doc.invoice.currency)}`,
    `Tax: ${formatMoney(doc.invoice.taxCents, doc.invoice.currency)}`,
    `Total: ${formatMoney(doc.invoice.totalCents, doc.invoice.currency)}`,
    `Auto-pay: ${doc.autoRenew ? 'Enabled' : 'Disabled'}`,
    `PDF link: ${doc.invoice.pdfUrl || getInvoicePdfUrl(doc.invoice.id)}`,
  ];

  const wrappedLines = lines.flatMap((line) => wrapLine(line, 88));
  const contentLines = wrappedLines.map((line, index) => {
    const y = 780 - index * 18;
    return `BT /F1 11 Tf 50 ${y} Td (${escapePdfText(line)}) Tj ET`;
  });

  const contentStream = contentLines.join('\n');
  const objects: string[] = [];

  objects.push(buildPdfObject('<< /Type /Catalog /Pages 2 0 R >>', 1));
  objects.push(buildPdfObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 2));
  objects.push(
    buildPdfObject(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      3
    )
  );
  objects.push(buildPdfObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 4));
  objects.push(
    buildPdfObject(
      `<< /Length ${Buffer.byteLength(contentStream, 'ascii')} >>\nstream\n${contentStream}\nendstream`,
      5
    )
  );

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += obj;
  }

  const xrefStart = Buffer.byteLength(pdf, 'ascii');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf + xref + trailer, 'ascii');
}

export function buildInvoiceEmailHtml(doc: BillingInvoiceDocument): string {
  const link = doc.invoice.pdfUrl || getInvoicePdfUrl(doc.invoice.id);
  const planLabel = doc.planName || doc.planSlug || 'your plan';
  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#ffffff;color:#111827">
      <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2">Invoice ${doc.invoice.invoiceNumber}</h1>
      <p style="margin:0 0 16px;color:#4b5563">Thanks for your payment. Your receipt is ready to view or download.</p>
      <div style="padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#f9fafb">
        <p style="margin:0 0 8px"><strong>Plan:</strong> ${planLabel}</p>
        <p style="margin:0 0 8px"><strong>Amount:</strong> ${formatMoney(doc.invoice.totalCents, doc.invoice.currency)}</p>
        <p style="margin:0 0 8px"><strong>Status:</strong> ${doc.invoice.status}</p>
        <p style="margin:0"><strong>Paid at:</strong> ${doc.invoice.paidAt ? doc.invoice.paidAt.toLocaleString('en-IN') : 'Pending'}</p>
      </div>
      <p style="margin:20px 0 0">
        <a href="${link}" style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700">View invoice PDF</a>
      </p>
      <p style="margin:16px 0 0;color:#6b7280;font-size:12px">If the button does not work, copy this link: ${link}</p>
    </div>
  `;
}
