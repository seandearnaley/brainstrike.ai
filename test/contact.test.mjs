// Run with: npm test
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { handle, validate } from '../api/contact.js';

const ENV = { RESEND_API_KEY: 're_test' };
const GOOD = { email: 'ada@example.com', message: 'Hello there, this is a test.', name: 'Ada' };

function post(body, { json = true, origin = 'https://brainstrike.ai' } = {}) {
  const headers = { origin };
  if (json) {
    headers.accept = 'application/json';
    headers['content-type'] = 'application/json';
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  return new Request('https://brainstrike.ai/api/contact', {
    body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
    headers,
    method: 'POST',
  });
}

afterEach(() => mock.restoreAll());

describe('validate', () => {
  it('accepts a complete message and flattens line breaks in the name', () => {
    assert.deepEqual(validate({ ...GOOD, name: 'Ada\r\nBcc: x@y.z' }), { ...GOOD, name: 'Ada Bcc: x@y.z' });
  });
  it('rejects a bad email, a short message and a missing name', () => {
    assert.ok(validate({ ...GOOD, email: 'nope' }).error);
    assert.ok(validate({ ...GOOD, message: 'short' }).error);
    assert.ok(validate({ ...GOOD, name: '  ' }).error);
  });
});

describe('handle', () => {
  it('sends a plain-text email through Resend with Reply-To set', async () => {
    const send = mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
    const response = await handle(post(GOOD), ENV);
    assert.equal(response.status, 200);
    const [url, init] = send.mock.calls[0].arguments;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(init.headers.Authorization, 'Bearer re_test');
    const sent = JSON.parse(init.body);
    assert.equal(sent.reply_to, GOOD.email);
    assert.deepEqual(sent.to, ['seandearnaley@outlook.com']);
    assert.ok(sent.text.includes(GOOD.message));
    assert.equal(sent.html, undefined);
  });
  it('sends to CONTACT_TO when it is set', async () => {
    const send = mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
    await handle(post(GOOD), { ...ENV, CONTACT_TO: 'inbox@example.com' });
    assert.deepEqual(JSON.parse(send.mock.calls[0].arguments[1].body).to, ['inbox@example.com']);
  });
  it('redirects a form post without JavaScript to the thank-you page', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
    const response = await handle(post(GOOD, { json: false }), ENV);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/contact/sent');
  });
  it('answers 400 with the reason for invalid input and sends nothing', async () => {
    const send = mock.method(globalThis, 'fetch', async () => new Response('{}'));
    const response = await handle(post({ ...GOOD, email: 'nope' }), ENV);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /email/u);
    assert.equal(send.mock.callCount(), 0);
  });
  it('pretends to succeed for a bot that fills the hidden field', async () => {
    const send = mock.method(globalThis, 'fetch', async () => new Response('{}'));
    const response = await handle(post({ ...GOOD, company: 'Spam Inc' }), ENV);
    assert.equal(response.status, 200);
    assert.equal(send.mock.callCount(), 0);
  });
  it('answers 503 without an API key', async () => {
    mock.method(console, 'error', () => {});
    assert.equal((await handle(post(GOOD), {})).status, 503);
  });
  it('answers 502 when Resend refuses', async () => {
    mock.method(console, 'error', () => {});
    mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 422 }));
    assert.equal((await handle(post(GOOD), ENV)).status, 502);
  });
  it('refuses other sites and other methods', async () => {
    assert.equal((await handle(post(GOOD, { origin: 'https://evil.example' }), ENV)).status, 403);
    const get = new Request('https://brainstrike.ai/api/contact');
    assert.equal((await handle(get, ENV)).status, 405);
  });
});
