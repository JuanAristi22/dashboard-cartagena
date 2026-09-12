// Sends email via Resend's REST API directly (no SDK dependency needed).
// Requires RESEND_API_KEY. EMAIL_FROM defaults to Resend's shared testing address, which
// can only deliver to the email the Resend account itself was signed up with — verify a
// domain in Resend (dashboard -> Domains) once you want to send to other recipients.
export async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Missing RESEND_API_KEY env var');

  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
