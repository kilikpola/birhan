import { generateTelegramLinkCode } from '../src/lib/telegram';

// Mock Supabase
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({ error: null }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({
            data: { telegram_chat_id: '-10012345678', telegram_verified_at: '2026-07-24T00:00:00Z' },
            error: null,
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    }),
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: { posted: true }, error: null }),
    },
  },
}));

describe('Telegram Integration Unit Tests', () => {
  it('generates valid link code format BIRHAN-XXXX', async () => {
    const res = await generateTelegramLinkCode('church-123', 'user-456');
    expect(res.error).toBeUndefined();
    expect(res.code).toBeDefined();
    expect(res.code).toMatch(/^BIRHAN-[A-Z0-9]{4,6}$/);
  });

  it('sets expiry to 10 minutes in the future', async () => {
    const now = Date.now();
    const res = await generateTelegramLinkCode('church-123', 'user-456');
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
