// backend/src/lib/mailer.ts
// Nodemailer wrapper with pluggable transport.
// Configure via SMTP_* env vars. Falls back to Ethereal (preview) in development
// when SMTP_HOST is not set — emails are logged as preview URLs to the console.

import nodemailer from 'nodemailer';
import { env } from '../config/env';

let _transporter: nodemailer.Transporter | null = null;

function sanitizeSmtpSecret(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  // Gmail app passwords are often copied with spaces for readability.
  // Nodemailer/SMTP auth expects the raw secret string, so strip whitespace.
  return trimmed.replace(/\s+/g, '');
}

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (_transporter) return _transporter;

  if (env.SMTP_HOST) {
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT ?? '587'),
      auth: { user: env.SMTP_USER?.trim(), pass: sanitizeSmtpSecret(env.SMTP_PASS) },
    });
  } else if (env.SMTP_USER && env.SMTP_PASS) {
    // Gmail convenience path: allow a direct Gmail app-password setup without
    // requiring a separate SMTP_HOST entry.
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.SMTP_USER.trim(), pass: sanitizeSmtpSecret(env.SMTP_PASS) },
    });
  } else {
    // Dev fallback: Ethereal test account (emails viewable at ethereal.email)
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST || 'smtp.ethereal.email',
      port: parseInt(env.SMTP_PORT ?? '587'),
      auth: { user: env.SMTP_USER || testAccount.user, pass: env.SMTP_PASS || testAccount.pass },
    });
    console.info('📧  Mailer: using Ethereal test account', testAccount.user);
  }

  return _transporter;
}

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

/** Send an email. Logs a preview URL in dev when using Ethereal. */
export async function sendMail(opts: MailOptions): Promise<void> {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: env.EMAIL_FROM,
    ...opts,
  });

  if (process.env.NODE_ENV !== 'production') {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) console.info('📧  Email preview:', previewUrl);
  }
}

// ─── Template helpers ─────────────────────────────────────────────────────────

export function passwordResetEmail(resetUrl: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#7c6ef5">Reset your password</h2>
      <p>Click the button below to reset your password. This link expires in 1 hour.</p>
      <a href="${resetUrl}"
         style="display:inline-block;margin-top:16px;padding:12px 24px;
                background:#7c6ef5;color:#fff;border-radius:8px;text-decoration:none">
        Reset Password
      </a>
      <p style="margin-top:24px;color:#888;font-size:13px">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;
}
