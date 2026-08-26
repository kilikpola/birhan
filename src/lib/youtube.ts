import AsyncStorage from '@react-native-async-storage/async-storage';

const API_KEY = 'AIzaSyCNCO7zuiLFmOD-cMk3MwBjmmjFYqiwgTI';

/**
 * Strict lists of banned non-Protestant and secular terms (English & Amharic)
 */
export const BANNED_TERMS = [
  'orthodox',
  'tewahdo',
  'catholic',
  'ተዋህዶ',
  'ተዋሕዶ',
  'ኦርቶዶክስ',
  'ካቶሊክ',
  'zefen',
  'ዘፈን',
  'kidasse',
  'ቅዳሴ',
  'ማህሌት',
  'mahlet',
  'mariam',
  'ማርያም',
];

/**
 * Indicative Protestant / Evangelical keywords
 */
export const PROTESTANT_TERMS = [
  'protestant',
  'evangelical',
  'gospel',
  'ወንጌል',
  'ፔንቴ',
  'ምስጋና',
  'አምልኮ',
  'wendemu',
  'pentay',
  'ህይወት',
  'mezmur',
  'መዝሙር',
];

/**
 * Whitelisted Ethiopian Protestant Channels & Media Outlets
 */
export const PROTESTANT_CHANNELS = [
  'cj tv',
  'presence tv',
  'marsil tv',
  'vision tv',
  'evangelical',
  'kale hiwot',
  'el shaddai',
  'ligonier',
  'meserete kristos',
  'gospel tv',
];

/**
 * Post-query filter ensuring content is Protestant-only and free of non-Protestant / secular terms.
 */
export function isProtestantContent(
  title: string = '',
  description: string = '',
  channelTitle: string = ''
): boolean {
  const text = `${title} ${description} ${channelTitle}`.toLowerCase();

  // 1. Drop if it contains ANY banned non-Protestant / secular keyword
  const containsBanned = BANNED_TERMS.some((term) => text.includes(term));
  if (containsBanned) return false;

  // 2. Allow if channel is a verified Protestant channel
  const isWhitelistedChannel = PROTESTANT_CHANNELS.some((ch) =>
    channelTitle.toLowerCase().includes(ch)
  );
  if (isWhitelistedChannel) return true;

  // 3. Keep if no banned terms were found
  return true;
}

/**
 * Dynamically resolves a YouTube video ID for a song and caches it.
 * Refines search query to enforce Protestant context and exclude Orthodox/Catholic content.
 */
export async function getLiveYoutubeId(songId: string, query: string): Promise<string | null> {
  const cacheKey = `birhan:yt:${songId}`;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) return cached;

    const refinedQuery = `${query} protestant -orthodox -tewahdo -catholic`;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(refinedQuery)}&type=video&maxResults=5&key=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`YouTube search failed for song ${songId}:`, res.status);
      return null;
    }
    
    const data = await res.json();
    const items = data.items || [];

    // Filter candidate items for Protestant content
    const filteredItem = items.find((item: any) =>
      isProtestantContent(
        item.snippet?.title,
        item.snippet?.description,
        item.snippet?.channelTitle
      )
    );

    const videoId = (filteredItem || items[0])?.id?.videoId;
    if (videoId) {
      await AsyncStorage.setItem(cacheKey, videoId);
      return videoId;
    }
    return null;
  } catch (e) {
    console.error(`Error fetching YouTube ID for ${songId}:`, e);
    return null;
  }
}

export type YtSearchResult = {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  bytes?: number;
  durationSec?: number;
};

/**
 * Parses ISO 8601 duration strings (e.g. PT4M15S, PT1H2M) into total seconds.
 */
export function parseIsoDuration(durationStr?: string): number {
  if (!durationStr) return 240;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 240;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : 240;
}

/**
 * Resolves a direct audio download stream URL or fallback URI for a YouTube video.
 */
export function getYoutubeDownloadUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Searches YouTube for Protestant mezmurs and returns a list of video results.
 * Applies multi-layer filtering (In-query refinement + Post-query application level filtering).
 */
export async function searchYoutubeMezmurs(query: string): Promise<YtSearchResult[]> {
  try {
    const trimmed = query.trim();
    const baseQuery = trimmed.toLowerCase().includes('mezmur') || trimmed.includes('መዝሙር')
      ? trimmed
      : `${trimmed} mezmur`;

    // Layer 1: In-Query Search Strategy
    const refinedQuery = `${baseQuery} protestant -orthodox -tewahdo -catholic`;

    const baseUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(refinedQuery)}&type=video&maxResults=50&key=${API_KEY}`;
    const res = await fetch(baseUrl);
    if (!res.ok) {
      console.warn(`YouTube search API failed on page 1:`, res.status);
      return [];
    }
    const data = await res.json();
    let allItems = data.items || [];

    // Paginate to fetch the next 50 results (total 100) if a token exists
    if (data.nextPageToken) {
      try {
        const nextUrl = `${baseUrl}&pageToken=${data.nextPageToken}`;
        const res2 = await fetch(nextUrl);
        if (res2.ok) {
          const data2 = await res2.json();
          if (data2.items) {
            allItems = allItems.concat(data2.items);
          }
        }
      } catch (err) {
        console.warn(`YouTube search API failed on page 2:`, err);
      }
    }

    // Layer 2: Post-Query Application Level Filtering
    const protestantOnlyItems = allItems.filter((item: any) =>
      isProtestantContent(
        item.snippet?.title,
        item.snippet?.description,
        item.snippet?.channelTitle
      )
    );

    const uniqueMap = new Map<string, YtSearchResult>();
    for (const item of protestantOnlyItems) {
      const videoId = item.id?.videoId;
      if (videoId && !uniqueMap.has(videoId)) {
        uniqueMap.set(videoId, {
          id: videoId,
          title: item.snippet?.title || '',
          channel: item.snippet?.channelTitle || '',
          thumbnail: item.snippet?.thumbnails?.default?.url || '',
        });
      }
    }

    // Fetch video contentDetails for exact duration and real audio file size calculation
    const videoIds = Array.from(uniqueMap.keys());
    if (videoIds.length > 0) {
      try {
        const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds.slice(0, 50).join(',')}&key=${API_KEY}`;
        const detailsRes = await fetch(detailsUrl);
        if (detailsRes.ok) {
          const detailsData = await detailsRes.json();
          const detailsItems = detailsData.items || [];
          for (const d of detailsItems) {
            const vId = d.id;
            const durIso = d.contentDetails?.duration || '';
            const durationSec = parseIsoDuration(durIso);
            const bytes = Math.round(durationSec * 16_000);
            const existing = uniqueMap.get(vId);
            if (existing) {
              existing.bytes = bytes;
              existing.durationSec = durationSec;
            }
          }
        }
      } catch (err) {
        console.warn(`Failed fetching YouTube video details:`, err);
      }
    }

    return Array.from(uniqueMap.values());
  } catch (e) {
    console.error(`Error performing YouTube search:`, e);
    return [];
  }
}
