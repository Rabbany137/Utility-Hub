import { isValidAppsScriptUrl } from './googleSheets';

const GMAIL_SEND_ENDPOINT =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailAuthError';
  }
}

export interface DailyMailSchedulePayload {
  uid: string;
  name: string;
  email: string;
  time: string; // HH:mm
  companies: string[];
  allowedUtilities: string[];
}

function toBase64UrlUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeMimeSubject(subject: string): string {
  const clean = subject.replace(/[\r\n]+/g, ' ').trim();
  const hasNonAscii = /[^\x20-\x7E]/.test(clean);
  if (!hasNonAscii) return clean;
  const bytes = new TextEncoder().encode(clean);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function sanitizeHeaderEmail(raw: string): string {
  return raw.replace(/[\r\n<>]/g, '').trim();
}

export function isValidEmailAddress(email: string): boolean {
  const clean = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) && clean.length <= 150;
}

export async function sendReportViaGmail(params: {
  accessToken: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}): Promise<{ id?: string }> {
  const cleanTo = sanitizeHeaderEmail(params.to);
  if (!isValidEmailAddress(cleanTo)) {
    throw new Error('Please provide a valid recipient email address.');
  }

  const boundary = `utilityhub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mimeParts = [
    `To: ${cleanTo}`,
    `Subject: ${encodeMimeSubject(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(params.textBody))),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(params.htmlBody))),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const raw = toBase64UrlUtf8(mimeParts);

  const res = await fetch(GMAIL_SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (res.status === 401 || res.status === 403) {
    const errBody = await res.json().catch(() => ({}));
    const msg =
      errBody?.error?.message ||
      'Gmail authorization expired or missing gmail.send permission. Please reconnect Google.';
    throw new GmailAuthError(msg);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || `Gmail API error (${res.status}).`
    );
  }

  return res.json() as Promise<{ id?: string }>;
}

export async function sendReportViaAppsScript(params: {
  webhookUrl: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}): Promise<void> {
  const trimmed = params.webhookUrl.trim();
  if (!isValidAppsScriptUrl(trimmed)) {
    throw new Error(
      'Invalid Google Apps Script Web App URL. It must end with /exec.'
    );
  }

  const cleanTo = sanitizeHeaderEmail(params.to);
  if (!isValidEmailAddress(cleanTo)) {
    throw new Error('Please provide a valid recipient email address.');
  }

  const res = await fetch(trimmed, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      action: 'sendDailyReport',
      to: cleanTo,
      subject: params.subject,
      htmlBody: params.htmlBody,
      textBody: params.textBody,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Apps Script email dispatch failed (${res.status}). Ensure latest script is deployed.`
    );
  }

  const payload = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;

  if (payload && payload.ok === false) {
    throw new Error(payload.error || 'Apps Script returned an error while sending mail.');
  }
}

export async function syncMailSchedulesViaAppsScript(params: {
  webhookUrl: string;
  schedules: DailyMailSchedulePayload[];
}): Promise<void> {
  const trimmed = params.webhookUrl.trim();
  if (!isValidAppsScriptUrl(trimmed)) {
    throw new Error(
      'Invalid Google Apps Script Web App URL. It must end with /exec.'
    );
  }

  const res = await fetch(trimmed, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      action: 'saveMailSchedules',
      schedules: params.schedules,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Failed to sync mail schedules (${res.status}). Redeploy Apps Script Web App as a New version.`
    );
  }

  const payload = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;

  if (payload && payload.ok === false) {
    throw new Error(payload.error || 'Apps Script failed to save mail schedules.');
  }
}
