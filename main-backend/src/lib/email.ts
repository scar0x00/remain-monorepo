import { type Bindings } from "../types";

/**
 * The one sender address. The zone `scar0x00.click` is onboarded to Cloudflare Email Service; if it
 * turns out not to accept a subdomain sender, change this to `no-reply@scar0x00.click`.
 */
export const EMAIL_SENDER = { name: "Remain", email: "no-reply@remain.scar0x00.click" };

type Mail = { to: string; subject: string; html: string; text: string };

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

// One plain layout for every message: a heading, a paragraph, then either a button with the link as
// text (some clients block buttons) or a one-time code in large type.
type Content = { heading: string; body: string; footer: string } & (
  | { action: string; url: string; code?: never }
  | { code: string; action?: never; url?: never }
);

function layout({ heading, body, footer, ...content }: Content) {
  let middle: string;
  if (content.code !== undefined) {
    middle = `<p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(content.code)}</p>`;
  } else {
    const link = escapeHtml(content.url);
    middle = `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#e0a526;color:#2b2620;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">${escapeHtml(content.action)}</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b6258">Or open this link:</p>
    <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${link}" style="color:#6b6258">${link}</a></p>`;
  }
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f3ee;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#2b2620">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(heading)}</h1>
    <p style="margin:0 0 24px;line-height:1.5">${escapeHtml(body)}</p>
    ${middle}
    <p style="margin:0;font-size:13px;color:#6b6258">${escapeHtml(footer)}</p>
  </div>
</body></html>`;
}

const greeting = (name: string) => (name ? `Hi ${name},` : "Hi,");

export function verificationEmail(user: { email: string; name: string }, url: string): Mail {
  const body = `${greeting(user.name)} confirm that this is your email address to finish setting up your Remain account.`;
  const footer = "The link expires in one hour. If you didn't sign up for Remain, ignore this email.";
  return {
    to: user.email,
    subject: "Verify your email for Remain",
    html: layout({ heading: "Verify your email", body, action: "Verify email", url, footer }),
    text: `${body}\n\n${url}\n\n${footer}\n`,
  };
}

export function resetPasswordEmail(user: { email: string; name: string }, url: string): Mail {
  const body = `${greeting(user.name)} someone asked to reset the password of your Remain account. Choose a new one with the link below.`;
  const footer = "The link expires in one hour. If you didn't ask for this, ignore this email: your password stays the same.";
  return {
    to: user.email,
    subject: "Reset your Remain password",
    html: layout({ heading: "Reset your password", body, action: "Choose a new password", url, footer }),
    text: `${body}\n\n${url}\n\n${footer}\n`,
  };
}

/** How long an emailed two-factor code works. Shared with the twoFactor plugin's `otpOptions.period`. */
export const TWO_FACTOR_CODE_MINUTES = 5;

export function twoFactorCodeEmail(user: { email: string; name: string }, code: string): Mail {
  const body = `${greeting(user.name)} here is your Remain verification code.`;
  const footer = `The code expires in ${TWO_FACTOR_CODE_MINUTES} minutes. If you didn't just sign in or change your security settings, someone may know your password: change it.`;
  return {
    to: user.email,
    // Not in the subject: failed sends log the subject.
    subject: "Your Remain verification code",
    html: layout({ heading: "Your verification code", body, code, footer }),
    text: `${body}\n\n${code}\n\n${footer}\n`,
  };
}

/**
 * Sends through the Cloudflare Email Service binding. `wrangler dev` simulates the binding (nothing
 * is sent). With `DEV_LOG_EMAILS=true` (local dev, e2e) or without a binding at all (bun tests), the
 * message is logged here instead, so the link can be followed from the log.
 */
export async function sendMail(env: Pick<Bindings, "EMAIL" | "DEV_LOG_EMAILS">, mail: Mail) {
  if (!env.EMAIL || env.DEV_LOG_EMAILS === "true") {
    console.log(`[email] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return;
  }

  try {
    await env.EMAIL.send({ from: EMAIL_SENDER, ...mail });
  } catch (error) {
    // Never log the message: it holds a sign-in capable link.
    const code = (error as { code?: string }).code ?? "unknown";
    console.error(`[email] "${mail.subject}" to ${mail.to} failed: ${code}`);
    throw error;
  }
}
