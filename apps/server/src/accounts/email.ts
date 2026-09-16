/**
 * Transactional email for the account layer (magic links). Two providers:
 *   - resend:  HTTPS API (RESEND_API_KEY, EMAIL_FROM). No SDK; one fetch.
 *   - console: logs the message (dev / demo). The magic-link route also echoes the
 *              link in its JSON response in demo mode so local testing needs no inbox.
 * No secret ever appears in a log line other than the link itself in console mode.
 */
import type { Logger } from "@shopmanagerai/shared";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  readonly kind: "resend" | "console";
  send(mail: OutboundEmail): Promise<{ ok: boolean; id?: string; error?: string }>;
}

export class ConsoleEmailSender implements EmailSender {
  readonly kind = "console" as const;
  constructor(private readonly log: Logger) {}
  async send(mail: OutboundEmail) {
    this.log.info("email (console provider)", { to: mail.to, subject: mail.subject, text: mail.text });
    return { ok: true, id: `console_${Date.now()}` };
  }
}

export class ResendEmailSender implements EmailSender {
  readonly kind = "resend" as const;
  constructor(
    private readonly opts: { apiKey: string; from: string; fetchImpl?: typeof fetch; log: Logger },
  ) {}
  async send(mail: OutboundEmail) {
    const f = this.opts.fetchImpl ?? fetch;
    try {
      const res = await f("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.opts.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        this.opts.log.warn("resend: send failed", { status: res.status, body: body.slice(0, 200) });
        return { ok: false, error: `Email provider returned ${res.status}.` };
      }
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: json.id };
    } catch (e) {
      this.opts.log.warn("resend: network error", { error: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: "Email provider unreachable." };
    }
  }
}

export function magicLinkEmail(opts: { brand: string; link: string; minutes: number }): Pick<OutboundEmail, "subject" | "text" | "html"> {
  const { brand, link, minutes } = opts;
  return {
    subject: `Your ${brand} sign-in link`,
    text: `Sign in to ${brand}:\n\n${link}\n\nThis link works once and expires in ${minutes} minutes. If you did not request it, ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
<tr><td style="font-size:14px;color:#6b7280;padding-bottom:16px">${brand}</td></tr>
<tr><td style="font-size:22px;font-weight:600;padding-bottom:12px">Sign in to ${brand}</td></tr>
<tr><td style="font-size:15px;line-height:22px;color:#374151;padding-bottom:24px">Click the button below to sign in. This link works once and expires in ${minutes} minutes.</td></tr>
<tr><td style="padding-bottom:24px"><a href="${link}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">Sign in</a></td></tr>
<tr><td style="font-size:13px;line-height:20px;color:#6b7280">Or paste this link into your browser:<br><a href="${link}" style="color:#2563eb;word-break:break-all">${link}</a></td></tr>
<tr><td style="font-size:12px;color:#9ca3af;padding-top:24px">If you did not request this email, you can ignore it.</td></tr>
</table></td></tr></table></body></html>`,
  };
}

export function verifyEmailTemplate(opts: { brand: string; link: string }): Pick<OutboundEmail, "subject" | "text" | "html"> {
  const { brand, link } = opts;
  return {
    subject: `Confirm your ${brand} email`,
    text: `Welcome to ${brand}. Confirm your email:\n\n${link}\n\nIf you did not create an account, ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
<tr><td style="font-size:14px;color:#6b7280;padding-bottom:16px">${brand}</td></tr>
<tr><td style="font-size:22px;font-weight:600;padding-bottom:12px">Confirm your email</td></tr>
<tr><td style="font-size:15px;line-height:22px;color:#374151;padding-bottom:24px">Thanks for creating an account. Click below to confirm this address.</td></tr>
<tr><td style="padding-bottom:24px"><a href="${link}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">Confirm email</a></td></tr>
<tr><td style="font-size:13px;line-height:20px;color:#6b7280">Or paste this link into your browser:<br><a href="${link}" style="color:#2563eb;word-break:break-all">${link}</a></td></tr>
</table></td></tr></table></body></html>`,
  };
}

export function resetPasswordTemplate(opts: { brand: string; link: string; minutes: number }): Pick<OutboundEmail, "subject" | "text" | "html"> {
  const { brand, link, minutes } = opts;
  return {
    subject: `Reset your ${brand} password`,
    text: `Reset your password:\n\n${link}\n\nThis link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
<tr><td style="font-size:14px;color:#6b7280;padding-bottom:16px">${brand}</td></tr>
<tr><td style="font-size:22px;font-weight:600;padding-bottom:12px">Reset your password</td></tr>
<tr><td style="font-size:15px;line-height:22px;color:#374151;padding-bottom:24px">Click below to choose a new password. The link works once and expires in ${minutes} minutes.</td></tr>
<tr><td style="padding-bottom:24px"><a href="${link}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">Choose a new password</a></td></tr>
<tr><td style="font-size:13px;line-height:20px;color:#6b7280">Or paste this link into your browser:<br><a href="${link}" style="color:#2563eb;word-break:break-all">${link}</a></td></tr>
<tr><td style="font-size:12px;color:#9ca3af;padding-top:24px">If you did not ask for this, you can ignore it. Your password stays the same.</td></tr>
</table></td></tr></table></body></html>`,
  };
}
