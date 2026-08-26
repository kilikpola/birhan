import { isProtestantContent, BANNED_TERMS, PROTESTANT_TERMS } from './youtube';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('YouTube Protestant Filtering System', () => {
  it('identifies banned Orthodox / Catholic / Secular titles and returns false', () => {
    expect(isProtestantContent('Ethiopian Orthodox Mezmur Kidasse')).toBe(false);
    expect(isProtestantContent('የኢትዮጵያ ኦርቶዶክስ ተዋህዶ መዝሙር')).toBe(false);
    expect(isProtestantContent('Catholic Hymn Mass')).toBe(false);
    expect(isProtestantContent('Amharic Zefen 2026')).toBe(false);
    expect(isProtestantContent('የአማርኛ ዘፈን')).toBe(false);
  });

  it('allows Protestant mezmur content', () => {
    expect(isProtestantContent('Yohannes Girma Amharic Protestant Mezmur', 'Gospel singer Yohannes Girma worship')).toBe(true);
    expect(isProtestantContent('የፕራይስ አምልኮ መዝሙር', 'የወንጌል አምልኮ')).toBe(true);
    expect(isProtestantContent('Aster Abebe New Gospel Song', '', 'CJ TV')).toBe(true);
  });

  it('allows content from whitelisted Protestant channels', () => {
    expect(isProtestantContent('Worship Song 2026', '', 'Presence TV Channel')).toBe(true);
  });
});
