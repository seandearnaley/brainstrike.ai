// POST /api/contact: the site's contact form. Vercel deploys every file in api/
// as a function next to the static dist/ output.
//
// It validates the name, email and message, then emails them to us through
// Resend's HTTP API (no SDK, so the site keeps no dependencies), with the
// sender's address as Reply-To. The email is plain text only, so nothing a
// visitor types is rendered as HTML.
//
// The page posts JSON with Accept: application/json and shows the result
// inline. Without JavaScript the browser posts the form itself; success then
// redirects to /contact/sent and an error returns a short plain-text page.
//
// A filled-in hidden "company" field marks a bot: it gets the success answer
// and nothing is sent.
//
// Environment:
//
//   RESEND_API_KEY  required to send; without it the form answers 503.
//   CONTACT_TO      optional; the inbox that receives messages.

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_TO = 'seandearnaley@outlook.com';
// Resend's shared test sender, until brainstrike.ai is verified in Resend.
const FROM = 'Brainstrike site <onboarding@resend.dev>';
const MAX_BODY_BYTES = 16_384;
const LIMITS = { email: 320, message: 5000, name: 200 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function answer(request, status, message) {
  if ((request.headers.get('accept') ?? '').includes('application/json')) {
    return Response.json(status < 400 ? { message } : { error: message }, { status });
  }
  if (status < 400) {
    return new Response(null, { headers: { Location: '/contact/sent' }, status: 303 });
  }
  return new Response(`${message}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status,
  });
}

async function readFields(request) {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  }
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    return Object.fromEntries(await request.formData());
  }
  return null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validate(fields) {
  const name = text(fields.name).replaceAll(/[\r\n]+/gu, ' ');
  const email = text(fields.email);
  const message = text(fields.message);
  if (name.length < 1 || name.length > LIMITS.name) return { error: 'Please enter your name.' };
  if (email.length > LIMITS.email || !EMAIL.test(email)) {
    return { error: 'Please enter a valid email address.' };
  }
  if (message.length < 10) return { error: 'Please write a message of at least 10 characters.' };
  if (message.length > LIMITS.message) {
    return { error: `Please keep your message under ${LIMITS.message} characters.` };
  }
  return { email, message, name };
}

function sameSite(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function handle(request, env = process.env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed\n', { headers: { Allow: 'POST' }, status: 405 });
  }
  if (!sameSite(request)) return answer(request, 403, 'This form only accepts messages sent from brainstrike.ai.');
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return answer(request, 413, 'That message is too long.');
  }

  let fields;
  try {
    fields = await readFields(request);
  } catch {
    return answer(request, 400, 'The form could not be read. Please try again.');
  }
  if (!fields) return answer(request, 415, 'The form could not be read. Please try again.');
  if (text(fields.company)) return answer(request, 200, 'Thanks, your message is on its way.');

  const result = validate(fields);
  if (result.error) return answer(request, 400, result.error);

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('contact: RESEND_API_KEY is not set, so the message was not sent');
    return answer(request, 503, 'The contact form is not working right now. Please try again later.');
  }

  try {
    const response = await fetch(RESEND_URL, {
      body: JSON.stringify({
        from: FROM,
        reply_to: result.email,
        subject: `Brainstrike contact form: ${result.name}`,
        text: `Name: ${result.name}\nEmail: ${result.email}\n\n${result.message}\n`,
        to: [env.CONTACT_TO || DEFAULT_TO],
      }),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      console.error(`contact: Resend answered ${response.status}`);
      return answer(request, 502, 'Your message could not be sent. Please try again later.');
    }
  } catch (error) {
    console.error('contact: could not reach Resend', error);
    return answer(request, 502, 'Your message could not be sent. Please try again later.');
  }
  return answer(request, 200, 'Thanks, your message is on its way.');
}

export default {
  fetch(request) {
    return handle(request);
  },
};
