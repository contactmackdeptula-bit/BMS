import type { Env } from "../env";

export type Email = { to: string; subject: string; text: string };

/** Emails "sent" in log mode, kept so tests can read the links in them. */
export const sentEmails: Email[] = [];

export async function sendEmail(env: Env, email: Email): Promise<void> {
  if (env.EMAIL_MODE !== "brevo") {
    sentEmails.push(email);
    console.log(`[email] to=${email.to} subject=${email.subject}\n${email.text}`);
    return;
  }
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) throw new Error("EMAIL_API_KEY and EMAIL_FROM must be set");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.EMAIL_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.EMAIL_FROM, name: env.PRODUCT_NAME },
      to: [{ email: email.to }],
      subject: email.subject,
      textContent: email.text,
    }),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status}`);
}
