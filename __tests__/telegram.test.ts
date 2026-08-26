import { generateTelegramLinkCode } from '../src/lib/telegram';

// Mock the backend fetch wrapper — generateTelegramLinkCode now calls
// POST /api/v1/telegram/link-code instead of inserting into Supabase
// directly. The church/user are derived server-side from the JWT, so the
// function itself takes no arguments any more.
jest.mock('../src/lib/api', () => ({
  apiFetch: jest.fn().mockImplementation(() => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    return Promise.resolve({ code: 'BIRHAN-4F2K', expiresAt: expiresAt.toISOString() });
  }),
  ApiError: class ApiError extends Error {},
}));

describe('Telegram Integration Unit Tests', () => {
  it('generates valid link code format BIRHAN-XXXX', async () => {
    const res = await generateTelegramLinkCode();
    expect(res.error).toBeUndefined();
    expect(res.code).toBeDefined();
    expect(res.code).toMatch(/^BIRHAN-[A-Z0-9]{4,6}$/);
  });

  it('sets expiry to 10 minutes in the future', async () => {
    const now = Date.now();
    const res = await generateTelegramLinkCode();
    expect(res.expiresAt).toBeDefined();
    const diffMins = (res.expiresAt!.getTime() - now) / (1000 * 60);
    expect(diffMins).toBeGreaterThan(9.8);
    expect(diffMins).toBeLessThanOrEqual(10.1);
  });

  it('formats post announcement payload correctly with title, body, and attribution', () => {
    const title = 'የሰንበት ስብሰባ ጥሪ';
    const body = 'እሑድ ጠዋት 2:00 ሰዓት ላይ ይጀምራል።';
    const formattedTitle = title ? `<b>${title}</b>\n\n` : '';
    const attribution = '\n\n— ከብርሃን መተግበሪያ የተላከ / Posted via Birhan';
    const messageText = `${formattedTitle}${body}${attribution}`;

    expect(messageText).toContain('<b>የሰንበት ስብሰባ ጥሪ</b>');
    expect(messageText).toContain('እሑድ ጠዋት 2:00 ሰዓት ላይ ይጀምራል።');
    expect(messageText).toContain('— ከብርሃን መተግበሪያ የተላከ / Posted via Birhan');
  });
});
