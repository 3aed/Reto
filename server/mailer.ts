import nodemailer from 'nodemailer';
import type { AppConfig } from './config.ts';
import { getMissingSmtpVars } from './config.ts';

export class EmailNotConfiguredError extends Error {
  missingVars: string[];
  constructor(missingVars: string[]) {
    super(
      `Email delivery service is not configured. Missing environment variables: ${missingVars.join(', ')}`
    );
    this.name = 'EmailNotConfiguredError';
    this.missingVars = missingVars;
  }
}

export function isEmailConfigured(cfg: AppConfig): boolean {
  return getMissingSmtpVars(cfg).length === 0;
}

function createTransporter(cfg: AppConfig) {
  const missing = getMissingSmtpVars(cfg);
  if (missing.length > 0) {
    throw new EmailNotConfiguredError(missing);
  }
  return nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: {
      user: cfg.smtp.user,
      pass: cfg.smtp.pass,
    },
  });
}

export async function sendAdminPasswordResetEmail(
  cfg: AppConfig,
  recipientEmail: string,
  resetUrl: string,
  expiresMinutes: number
): Promise<void> {
  const transporter = createTransporter(cfg);
  await transporter.sendMail({
    from: cfg.smtp.from,
    to: recipientEmail,
    subject: 'RetroMarket Administrator Password Reset',
    text: [
      'A password reset was requested for your RetroMarket administrator account.',
      '',
      `Reset link (valid for ${expiresMinutes} minutes, single-use):`,
      resetUrl,
      '',
      'If you did not request this reset, you can safely ignore this email and review your audit logs.',
    ].join('\n'),
  });
}

export async function sendSellerInquiryEmail(
  cfg: AppConfig,
  params: {
    to: string;
    replyTo: string;
    inquiryRef: string;
    recipientLabel: string;
    guestName: string;
    orderNumber?: string;
    productLabel?: string;
    message: string;
  }
): Promise<boolean> {
  if (!isEmailConfigured(cfg) || !params.to) {
    return false;
  }

  const transporter = createTransporter(cfg);
  await transporter.sendMail({
    from: cfg.smtp.from,
    to: params.to,
    replyTo: params.replyTo,
    subject: `[RetroMarket ${params.inquiryRef}] Customer Inquiry for ${params.recipientLabel}`,
    text: [
      `Inquiry Reference: ${params.inquiryRef}`,
      `From: ${params.guestName} <${params.replyTo}>`,
      params.productLabel ? `Product: ${params.productLabel}` : '',
      params.orderNumber ? `Order Reference: ${params.orderNumber}` : '',
      '',
      'Message:',
      params.message,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  return true;
}
