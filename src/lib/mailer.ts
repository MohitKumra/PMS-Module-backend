// backend/src/lib/mailer.ts
// Nodemailer wrapper with pluggable transport.
// Configure via SMTP_* env vars. Falls back to Ethereal (preview) in development
// when SMTP_HOST is not set — emails are logged as preview URLs to the console.

import nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { env } from '../config/env';

let _transporter: nodemailer.Transporter | null = null;

function sanitizeSmtpSecret(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
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
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.SMTP_USER.trim(), pass: sanitizeSmtpSecret(env.SMTP_PASS) },
    });
  } else {
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

// ─── App URL helpers ───────────────────────────────────────────

function getAppUrls() {
  const base = env.FRONTEND_URL;
  return {
    app: {
      habitUrl: `${base}/habits`,
      taskUrl: `${base}/tasks`,
      projectUrl: `${base}/projects`,
      preferencesUrl: `${base}/settings`,
    },
  };
}

// ─── Template engine ───────────────────────────────────────────

const TEMPLATE_DIR = path.join(__dirname, '..', 'email-template');
const templateCache = new Map<string, string>();

function loadTemplate(name: string): string {
  if (templateCache.has(name)) return templateCache.get(name)!;
  const filePath = path.join(TEMPLATE_DIR, `${name}.html`);
  const content = fs.readFileSync(filePath, 'utf-8');
  templateCache.set(name, content);
  return content;
}

function renderTemplate(templateName: string, variables: Record<string, any>): string {
  let html = loadTemplate(templateName);
  const appUrls = getAppUrls();
  const ctx = { ...variables, ...appUrls };

  // Handle {{#if var}}...{{/if}} conditionals
  html = html.replace(/\{\{#if\s+([\w.]+)\}\}(.*?)\{\{\/if\}\}/gs, (_, key, content) => {
    const value = resolveNested(ctx, key.trim());
    if (value && value !== 'false' && value !== '') {
      return resolveVariables(content, ctx);
    }
    return '';
  });

  html = resolveVariables(html, ctx);
  return html;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '\x26amp;').replace(/</g, '\x26lt;').replace(/>/g, '\x26gt;').replace(/"/g, '\x26quot;');
}

function resolveVariables(template: string, ctx: Record<string, any>): string {
  // Unescaped {{{var}}} for URLs etc.
  template = template.replace(/\{\{\{([\w.]+)\}\}\}/g, (_, key) => {
    const value = resolveNested(ctx, key.trim());
    return value != null ? String(value) : '';
  });
  // Escaped {{var}}
  template = template.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const value = resolveNested(ctx, key.trim());
    if (value == null) return '';
    return escapeHtml(String(value));
  });
  return template;
}

function resolveNested(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, part) => (acc != null ? acc[part] : undefined), obj as any);
}

// ─── Template API ──────────────────────────────────────────────

export function renderHabitReminder(vars: {
  reminderTitle: string;
  habit: { title: string; reminderTime: string };
}): string {
  return renderTemplate('habit-reminder-playful', vars);
}

export function renderTaskDue(vars: {
  task: { title: string; description?: string | null; dueDate: string; priority: string };
}): string {
  return renderTemplate('task-due-playful', vars);
}

export function renderProjectDeadline(vars: {
  project: { name: string; description?: string | null; dueDate: string };
}): string {
  return renderTemplate('project-deadline-playful', vars);
}

export function renderPasswordReset(vars: { resetUrl: string }): string {
  return renderTemplate('password-reset', vars);
}

export function renderRecoveryByEmail(vars: { resetUrl: string; primaryEmail: string }): string {
  return renderTemplate('recovery-by-email', vars);
}

export function renderAdminOtp(vars: { otp: string }): string {
  return renderTemplate('admin-otp', vars);
}

// ─── Legacy helper functions ────────────────────────────────────

export function passwordResetEmail(resetUrl: string): string {
  return renderPasswordReset({ resetUrl });
}

export function recoveryByEmailEmail(resetUrl: string, primaryEmail: string): string {
  return renderRecoveryByEmail({ resetUrl, primaryEmail });
}

export function adminOtpEmail(otp: string): string {
  return renderAdminOtp({ otp });
}

