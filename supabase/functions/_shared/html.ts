// Minimal HTML escaping for Telegram's parse_mode:'HTML'. Only `&`, `<`, `>`
// are special there; escaping them prevents user text from breaking formatting
// or injecting markup. Extracted so it can be unit-tested (see html.test.ts).
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
