// Deno unit tests for the Telegram HTML escaper. Run: `deno test` (CI edge job).
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { escapeHtml } from './html.ts';

Deno.test('escapes the three Telegram-special characters', () => {
  assertEquals(escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
});

Deno.test('neutralises an injected tag', () => {
  assertEquals(
    escapeHtml('<b onclick="x">hi</b>'),
    '&lt;b onclick="x">hi&lt;/b>',
  );
});

Deno.test('escapes ampersand first so entities are not double-broken', () => {
  // A literal "&lt;" typed by a user must become "&amp;lt;", not "&lt;".
  assertEquals(escapeHtml('&lt;'), '&amp;lt;');
});

Deno.test('leaves plain text untouched', () => {
  assertEquals(escapeHtml('ሰላም ለዓለም'), 'ሰላም ለዓለም');
});
