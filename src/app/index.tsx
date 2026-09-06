import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useRouter } from 'expo-router';

import * as Clipboard from 'expo-clipboard';

import { useApp } from '../theme/context';
import { t } from '../i18n';
import { displayAuthorName } from '../lib/account';
import { fonts, radius, space } from '../theme/tokens';
import { toEthiopian, formatEthiopian, toGeezNumeral, localeTag } from '../lib/ethiopian';
import { getLocalDb } from '../utils/db';
import { useToast } from '../components/toast';
import { useAuth } from '../lib/auth';
import {
  useAnnouncements,
  fetchReplies,
  queueReply,
  publishAnnouncement,
  toggleLock,
  Announcement,
  Reply,
} from '../lib/announcements';
import { getTelegramLinkStatus, postAnnouncementToTelegram } from '../lib/telegram';
import { getVerseOfDay, VerseOfDay } from '../lib/verseOfDay';
import { syncDailyVerseNotifications } from '../lib/dailyVerse';
import { searchBible, VerseResult } from '../utils/search';
import { Icon } from '../components/icon';
import { Cross } from '../components/cross';
import { reportError } from '../lib/errors';
import { TodaySkeleton } from '../components/skeletons/today-skeleton';
import { useSkeleton } from '../lib/use-skeleton';
import { SectionBoundary } from '../components/section-boundary';

export default function Today() {
  const { c, night, setNight, lang, setLang } = useApp();
  const { profile, isPastor } = useAuth();
  const { items: anns, online, reload } = useAnnouncements();
  const bibleDb = useSQLiteContext();
  const router = useRouter();

  const { showToast } = useToast();
  const [vod, setVod] = useState<VerseOfDay | null>(null);
  const [vodSettled, setVodSettled] = useState(false);
  const [lastRead, setLastRead] = useState<{
    name_am: string;
    name_en: string;
    chapters: number;
    chapter: number;
  } | null>(null);
  const [openAnnId, setOpenAnnId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [replyText, setReplyText] = useState('');
  const [repliesLoading, setRepliesLoading] = useState(false);

  // Search Modal
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VerseResult[]>([]);

  // Pastor Publish Form States
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Telegram Link States
  const [isTelegramLinked, setIsTelegramLinked] = useState(false);
  const [postToTelegram, setPostToTelegram] = useState(true);

  useEffect(() => {
    // `active` guards against a status request for a previous church resolving
    // last and applying its answer to the church now on screen.
    let active = true;
    const churchId = profile?.church_id;

    if (!churchId) {
      setIsTelegramLinked(false);
      setPostToTelegram(false);
      return;
    }

    getTelegramLinkStatus()
      .then((status) => {
        if (!active) return;
        setIsTelegramLinked(status.isLinked);
        setPostToTelegram(status.isLinked);
      })
      .catch((err) => {
        if (!active) return;
        setIsTelegramLinked(false);
        setPostToTelegram(false);
        reportError(err, 'Today.getTelegramLinkStatus', lang, false);
      });

    return () => { active = false; };
  }, [profile?.church_id, lang]);

  const am = lang === 'am';

  // Amharic screens render their numbers in Ge'ez, never mixed with Latin digits.
  const num = (n: number) => (am ? toGeezNumeral(n) : String(n));

  // Compute Ethiopian Date
  const ethDate = useMemo(() => formatEthiopian(toEthiopian(new Date()), lang), [lang]);

  // Load Verse of the Day
  useEffect(() => {
    let active = true;
    getVerseOfDay(bibleDb)
      .then((v) => { if (active) setVod(v); })
      .catch((err) => reportError(err, 'Today.getVerseOfDay', lang, false))
      // Mark settled even on failure so the skeleton clears instead of spinning
      // forever when the verse fails to load and there are no announcements.
      .finally(() => { if (active) setVodSettled(true); });
    return () => { active = false; };
  }, [bibleDb, lang]);

  // Keep the daily-verse reminders scheduled ahead. The Today screen is the
  // natural place: it opens on app launch and already holds the Bible db, so
  // every launch rolls the window forward with the correct verse per day.
  // Entirely local — a no-op in Expo Go or if the user turned it off.
  useEffect(() => {
    syncDailyVerseNotifications(bibleDb, lang);
  }, [bibleDb, lang]);

  // Load the real "continue reading" position saved by the Bible screen.
  useEffect(() => {
    (async () => {
      try {
        const localDb = await getLocalDb();
        const pos = await localDb.getFirstAsync<{ book: number; chapter: number }>(
          'SELECT book, chapter FROM reading_position ORDER BY updated_at DESC LIMIT 1',
        );
        if (!pos) return;
        const bk = await bibleDb.getFirstAsync<{ name_am: string; name_en: string; chapters: number }>(
          'SELECT name_am, name_en, chapters FROM books WHERE id = ?',
          [pos.book],
        );
        if (bk) setLastRead({ ...bk, chapter: pos.chapter });
      } catch (err) {
        reportError(err, 'Today.loadReadingPosition', lang, false);
      }
    })();
  }, [bibleDb, lang]);

  // Copy the verse of the day to the clipboard.
  const handleShareVerse = async () => {
    if (!vod) return;
    const ref = am ? vod.ref_am : vod.ref_en;
    const text = am ? vod.text_am : vod.text_en;
    try {
      // setStringAsync resolves false (not throws) when the write is refused,
      // e.g. on web without clipboard permission. Don't claim success then.
      const copied = await Clipboard.setStringAsync(`${text}\n— ${ref}`);
      if (copied) {
        showToast(am ? 'ተቀድቷል' : 'Copied to clipboard', 'success');
      } else {
        reportError(new Error('Clipboard write was refused'), 'Today.handleShareVerse', lang);
      }
    } catch (err) {
      reportError(err, 'Today.handleShareVerse', lang);
    }
  };

  // Load Replies for Open Announcement.
  // Every fetch takes a ticket; only the newest ticket may touch state, so a
  // slow fetch for a previously opened announcement can't overwrite the thread
  // now on screen (or clear its loading flag early).
  // The ticket alone isn't enough: handleSendReply holds the closure for the
  // announcement that was open when Send was pressed, so a refresh can start
  // *after* the user moved to another thread and would then take the newest
  // ticket. Both starting and committing are gated on the id still being open.
  const repliesReq = useRef(0);
  const openAnnIdRef = useRef<string | null>(openAnnId);
  openAnnIdRef.current = openAnnId;

  const loadReplies = useCallback(async () => {
    const annId = openAnnId;
    if (!annId || openAnnIdRef.current !== annId) return;
    const reqId = ++repliesReq.current;
    setRepliesLoading(true);
    try {
      const data = await fetchReplies(annId);
      if (repliesReq.current === reqId && openAnnIdRef.current === annId) setReplies(data);
    } catch (err) {
      reportError(err, 'Today.loadReplies', lang, false);
    } finally {
      if (repliesReq.current === reqId && openAnnIdRef.current === annId) setRepliesLoading(false);
    }
  }, [openAnnId, lang]);

  useEffect(() => {
    // Invalidate anything in flight for the previous announcement, and clear
    // the previous thread so switching never flashes the prior replies.
    repliesReq.current++;
    setReplies([]);
    setRepliesLoading(false);
    loadReplies();
  }, [loadReplies]);

  // Debounced search
  useEffect(() => {
    let active = true;

    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      searchBible(bibleDb, searchQuery)
        .then((res) => {
          // A query typed earlier must never replace the current query's hits.
          if (active) setSearchResults(res);
        })
        .catch((err) => {
          if (!active) return;
          setSearchResults([]);
          reportError(err, 'Today.searchBible', lang, false);
        });
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, bibleDb, lang]);

  const currentAnn = useMemo(() => {
    return anns.find((a) => a.id === openAnnId);
  }, [anns, openAnnId]);

  // Publish a new Announcement (Pastor only)
  const handlePublish = async () => {
    if (!newTitle.trim() || !newBody.trim() || !profile?.church_id || !profile?.id) return;
    setPublishing(true);
    setPublishError(null);
    const titleStr = newTitle.trim();
    const bodyStr = newBody.trim();
    const churchIdStr = profile.church_id;
    const shouldPostTelegram = isTelegramLinked && postToTelegram;

    try {
      const res = await publishAnnouncement({
        churchId: churchIdStr,
        authorId: profile.id,
        title: titleStr,
        body: bodyStr,
        postToTelegram: shouldPostTelegram,
      });
      if (res.error) {
        // reportError toasts and returns the localized message; keep it on the
        // form too so the pastor still sees why the post failed after the toast.
        setPublishError(reportError(res.error, 'Today.handlePublish', lang));
      } else {
        setNewTitle('');
        setNewBody('');
        reload();

        if (res.telegramSuccess === false && res.data?.id) {
          const createdAnnId = res.data.id;
          Alert.alert(
            am ? 'ማሳሰቢያ' : 'Telegram Notice',
            t(lang, 'telegramFailedRetryPrompt'),
            [
              { text: am ? 'ተው' : 'Dismiss', style: 'cancel' },
              {
                text: t(lang, 'btnRetryTelegram'),
                onPress: async () => {
                  // Alert callbacks are fire-and-forget: an uncaught rejection
                  // here would leave the pastor with no feedback at all.
                  try {
                    const retryRes = await postAnnouncementToTelegram({
                      announcementId: createdAnnId,
                      churchId: churchIdStr,
                      title: titleStr,
                      body: bodyStr,
                    });
                    if (retryRes.success) {
                      reload();
                    } else if (retryRes.error) {
                      reportError(retryRes.error, 'Today.retryTelegram', lang);
                    }
                  } catch (err) {
                    reportError(err, 'Today.retryTelegram', lang);
                  }
                },
              },
            ]
          );
        }
      }
    } catch (err) {
      setPublishError(reportError(err, 'Today.handlePublish', lang));
    } finally {
      // Always reset publishing state, even if the request threw.
      setPublishing(false);
    }
  };

  // Submit a reply (offline outbox-backed)
  const handleSendReply = async () => {
    if (!replyText.trim() || !openAnnId || !profile) return;
    const textToSend = replyText.trim();
    setReplyText('');
    try {
      await queueReply({
        announcementId: openAnnId,
        authorId: profile.id,
        authorName: profile.display_name,
        text: textToSend,
      });
      loadReplies();
    } catch (err) {
      // Don't swallow the user's message — put it back so they can retry.
      setReplyText(textToSend);
      reportError(err, 'Today.handleSendReply', lang);
    }
  };

  // Toggle thread lock (Pastor only)
  const handleToggleLock = async () => {
    if (!openAnnId || !currentAnn) return;
    const nextLockState = !currentAnn.locked;
    try {
      await toggleLock(openAnnId, nextLockState);
      // Only refresh once the lock actually changed, so a failed toggle can't
      // look like it succeeded.
      reload();
    } catch (err) {
      reportError(err, 'Today.handleToggleLock', lang);
    }
  };

  const { showSkeleton: showTodaySkeleton } = useSkeleton({
    // Once the verse load has settled (success OR failure), stop showing the
    // skeleton even if there's no data, so a failed load can't spin forever.
    loading: !vodSettled && anns.length === 0,
    hasData: vod !== null || anns.length > 0,
  });

  return (
    <SafeAreaView style={[s.wrap, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[s.top, { backgroundColor: c.bg }]}>
        <View style={{ flex: 1 }}>
          {currentAnn ? (
            <Pressable
              onPress={() => setOpenAnnId(null)}
              style={s.backBtn}
              hitSlop={12}
            >
              <Icon name="back" size={18} color={c.accent} />
              <Text style={[s.h1, { color: c.text, fontFamily: am ? fonts.amBold : undefined }]}>
                {t(lang, 'announcement')}
              </Text>
            </Pressable>
          ) : (
            <>
              <Text style={[s.h1, { color: c.text, fontFamily: am ? fonts.amBold : undefined }]}>
                {t(lang, 'today')}
              </Text>
              <Text style={[s.sub, { color: c.textFaint, fontFamily: am ? fonts.am : undefined }]}>
                {ethDate}
              </Text>
            </>
          )}
        </View>

        {!currentAnn && (
          <Pressable
            onPress={() => setSearchOpen(true)}
            style={[s.iconbtn, { borderColor: c.border, backgroundColor: c.surface }]}
            accessibilityRole="button"
            accessibilityLabel={t(lang, 'a11ySearch')}
          >
            <Icon name="search" size={18} color={c.textSoft} />
          </Pressable>
        )}

        <Pressable
          onPress={() => setNight(!night)}
          style={[s.iconbtn, { borderColor: c.border, backgroundColor: c.surface }]}
          accessibilityRole="switch"
          accessibilityLabel={t(lang, 'a11yNightMode')}
          accessibilityState={{ checked: night }}
        >
          <Icon name={night ? 'sun' : 'moon'} size={17} color={c.accent} />
        </Pressable>
      </View>

      {/* Offline Alert Bar */}
      {!online && (
        <View style={[s.offlineBar, { backgroundColor: c.lapis }]}>
          <Icon name="wifiOff" size={13} color="#FFFFFF" />
          <Text style={[s.offlineText, { fontFamily: am ? fonts.am : undefined }]}>
            {t(lang, 'noSignal')}
          </Text>
        </View>
      )}

      {/* Main Content Scroll */}
      {showTodaySkeleton ? (
        <TodaySkeleton />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
        {currentAnn ? (
          /* ANNOUNCEMENT DETAIL VIEW */
          <View>
            <SectionBoundary name="Today.AnnouncementDetail">
              <View style={[s.card, { backgroundColor: c.surface, borderColor: c.borderLit }]}>
                <View style={s.detailHeader}>
                  <Cross size={13} color={c.accent} />
                  <Text style={[s.eyebrow, { color: c.accent, marginLeft: 6 }]}>
                    {profile?.church_id ? (am ? 'ቤተ ክርስቲያን' : 'My Church') : 'Birhan'}
                  </Text>
                </View>
                <Text style={[s.detailTitle, { color: c.text, fontFamily: am ? fonts.amBold : undefined }]}>
                  {am ? currentAnn.title_am : currentAnn.title_en}
                </Text>
                <Text style={[s.detailBody, { color: c.textSoft, fontFamily: am ? fonts.am : undefined }]}>
                  {currentAnn.body}
                </Text>
                <View style={s.tagRow}>
                  <View style={[s.chip, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}>
                    <Icon name="check" size={10} color={c.textSoft} />
                    <Text style={[s.chipText, { color: c.textSoft }]}>{t(lang, 'onPhone')}</Text>
                  </View>
                  {currentAnn.posted_to_telegram && (
                    <View style={[s.chip, { borderColor: c.success, backgroundColor: 'rgba(95,167,113,0.12)' }]}>
                      <Text style={[s.chipText, { color: c.success }]}>Telegram Group</Text>
                    </View>
                  )}
                </View>
              </View>
            </SectionBoundary>

            {/* Replies Section */}
            <SectionBoundary name="Today.Replies" onRetry={loadReplies}>
              <View style={s.dividerContainer}>
                <Text style={[s.dividerLabel, { color: c.textFaint }]}>
                  {t(lang, 'replies')} ({replies.length})
                </Text>
                <View style={[s.dividerLine, { backgroundColor: c.border }]} />
                {isPastor && (
                  <Pressable
                    onPress={handleToggleLock}
                    style={[
                      s.chip,
                      { borderColor: currentAnn.locked ? c.danger : c.border, backgroundColor: c.surfaceAlt },
                    ]}
                  >
                    <Icon name="lock" size={10} color={currentAnn.locked ? c.danger : c.textSoft} />
                    <Text style={[s.chipText, { color: currentAnn.locked ? c.danger : c.textSoft }]}>
                      {currentAnn.locked ? (am ? 'ክፈት' : 'Unlock') : (am ? 'ዝጋ' : 'Lock')}
                    </Text>
                  </Pressable>
                )}
              </View>

              {repliesLoading && replies.length === 0 ? (
                <ActivityIndicator color={c.accent} style={{ marginVertical: space.md }} />
              ) : (
                replies.map((r) => (
                  <View key={r.id} style={[s.reply, { borderLeftColor: c.borderLit }]}>
                    <View style={s.replyHeader}>
                      <Text style={[s.replyAuthor, { color: r.pending ? c.textFaint : c.text }]}>
                        {displayAuthorName(r.author_name, lang)}
                      </Text>
                      {r.pending ? (
                        <Text style={[s.replyPendingText, { color: c.danger }]}>
                          {t(lang, 'pending')}
                        </Text>
                      ) : (
                        <Text style={[s.replyTime, { color: c.textFaint }]}>
                          {new Date(r.created_at).toLocaleTimeString(localeTag(lang), { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      )}
                    </View>
                    <Text style={[s.replyText, { color: c.textSoft, fontFamily: am ? fonts.am : undefined }]}>
                      {r.text}
                    </Text>
                  </View>
                ))
              )}

              {/* Reply Form / Lock Indicator */}
              {currentAnn.locked ? (
                <View style={[s.lockedContainer, { borderColor: c.border, backgroundColor: c.surface }]}>
                  <Icon name="lock" size={14} color={c.textFaint} />
                  <Text style={[s.lockedText, { color: c.textFaint, fontFamily: am ? fonts.am : undefined }]}>
                    {t(lang, 'locked')}
                  </Text>
                </View>
              ) : (
                <View style={s.replyForm}>
                  <TextInput
                    style={[s.textarea, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
                    multiline
                    numberOfLines={3}
                    value={replyText}
                    onChangeText={setReplyText}
                    placeholder={t(lang, 'writeReply')}
                    placeholderTextColor={c.textFaint}
                  />
                  <Pressable
                    style={[s.btn, { backgroundColor: c.accent }]}
                    onPress={handleSendReply}
                    disabled={!replyText.trim()}
                  >
                    <Icon name="send" size={14} color={c.bg} />
                    <Text style={[s.btnText, { color: c.bg }]}>
                      {online ? t(lang, 'send') : t(lang, 'pending')}
                    </Text>
                  </Pressable>
                </View>
              )}
            </SectionBoundary>

            <Text style={[s.note, { color: c.textFaint, fontFamily: am ? fonts.am : undefined }]}>
              {t(lang, 'threadNote')}
            </Text>
          </View>
        ) : (
          /* TODAY MAIN FEED VIEW */
          <View>
            {/* Signature Verse Card - Glows with accent light */}
            <SectionBoundary name="Today.VOD">
              <View style={[s.card, { backgroundColor: c.surface, borderColor: c.borderLit }]}>
                <View
                  style={{
                    position: 'absolute',
                    top: -60,
                    right: -40,
                    width: 180,
                    height: 180,
                    borderRadius: radius.pill,
                    backgroundColor: c.accentGlow,
                  }}
                />
                <View style={s.eyebrowRow}>
                  <Cross size={13} color={c.accent} />
                  <Text style={[s.eyebrow, { color: c.accent, marginLeft: 6 }]}>የዕለቱ ቃል</Text>
                </View>

                <Text
                  style={[
                    s.verse,
                    { color: c.text, fontFamily: am ? fonts.am : undefined },
                  ]}
                >
                  {vod ? (am ? vod.text_am : vod.text_en) : (am ? 'እግዚአብሔርም። ብርሃን ይሁን ኣለ፤ ብርሃንም ሆነ።' : 'And God said, Let there be light: and there was light.')}
                </Text>

                {am && (
                  <Text style={[s.gloss, { color: c.textSoft }]}>
                    {vod ? vod.text_en : 'And God said, Let there be light: and there was light.'}
                  </Text>
                )}

                <View style={s.verseFooter}>
                  <Text style={[s.ref, { color: c.accent, fontFamily: am ? fonts.amBold : undefined }]}>
                    {vod ? (am ? vod.ref_am : vod.ref_en) : (am ? 'ዘፍጥረት ፩፥፫' : 'Genesis 1:3')}
                  </Text>

                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable
                      onPress={handleShareVerse}
                      // The card falls back to a hardcoded verse when the load
                      // fails; without a real `vod` there is nothing to copy.
                      disabled={!vod}
                      accessibilityRole="button"
                      style={[
                        s.chip,
                        { borderColor: c.border, backgroundColor: c.surfaceAlt, opacity: vod ? 1 : 0.4 },
                      ]}
                    >
                      <Text style={[s.chipText, { color: c.textSoft }]}>{am ? 'አጋራ' : 'Share'}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </SectionBoundary>

            {/* Reading Progress Card */}
            <SectionBoundary name="Today.ContinueReading">
              <View style={s.sectionHeader}>
                <Text style={[s.sectionTitle, { color: c.textFaint }]}>ንባብ</Text>
              </View>

              <Pressable
                style={[s.row, { backgroundColor: c.surface, borderColor: c.border }]}
                onPress={() => router.push('/bible')}
              >
                <View style={[s.iconBox, { backgroundColor: c.accent }]}>
                  <Icon name="book" size={18} color={c.bg} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.rowTitle, { color: c.text, fontFamily: am ? fonts.amBold : undefined }]}>
                    {am ? 'ንባብ ቀጥል' : 'Continue reading'}
                  </Text>
                  <Text style={[s.rowSub, { color: c.textFaint }]}>
                    {lastRead
                      ? `${am ? lastRead.name_am : lastRead.name_en} ${num(lastRead.chapter)} · ${num(lastRead.chapter)} / ${num(lastRead.chapters)}`
                      : am ? 'ገና አልጀመሩም' : 'Not started yet'}
                  </Text>
                  {lastRead && (
                    <View style={[s.meter, { backgroundColor: c.border, marginTop: 8 }]}>
                      <View
                        style={[
                          s.meterFill,
                          {
                            width: `${lastRead.chapters > 0 ? Math.min(100, Math.round((lastRead.chapter / lastRead.chapters) * 100)) : 0}%`,
                            backgroundColor: c.accent,
                          },
                        ]}
                      />
                    </View>
                  )}
                </View>
                <View style={[s.chip, { borderColor: c.accentDim, backgroundColor: c.accentGlow }]}>
                  <Cross size={10} color={c.accent} />
                  <Text style={[s.chipText, { color: c.accent, marginLeft: 4 }]}>በስልክዎ</Text>
                </View>
              </Pressable>
            </SectionBoundary>

            {/* Pastor Admin Publish Box */}
            {isPastor && (
              <SectionBoundary name="Today.PastorPublish">
                <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border, marginTop: 16 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="gear" size={12} color={c.accent} />
                    <Text style={[s.eyebrow, { color: c.accent, marginLeft: 6, fontFamily: am ? fonts.amBold : undefined }]}>
                      {t(lang, 'newAnnouncement')}
                    </Text>
                  </View>

                  <TextInput
                    style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt }]}
                    placeholder={am ? 'ርዕስ' : 'Title'}
                    placeholderTextColor={c.textFaint}
                    value={newTitle}
                    onChangeText={setNewTitle}
                  />
                  <TextInput
                    style={[s.textarea, { color: c.text, borderColor: c.border, backgroundColor: c.surfaceAlt, height: 70 }]}
                    multiline
                    placeholder={am ? 'ዝርዝር' : 'Details'}
                    placeholderTextColor={c.textFaint}
                    value={newBody}
                    onChangeText={setNewBody}
                  />

                  {isTelegramLinked && (
                    <Pressable
                      style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}
                      onPress={() => setPostToTelegram(!postToTelegram)}
                    >
                      <View
                        style={[
                          s.checkbox,
                          {
                            borderColor: postToTelegram ? c.accent : c.border,
                            backgroundColor: postToTelegram ? c.accent : c.surface,
                          },
                        ]}
                      >
                        {postToTelegram && <Icon name="check" size={12} color={c.bg} />}
                      </View>
                      <Text style={[s.checkboxLabel, { color: c.text, fontFamily: am ? fonts.am : undefined, marginLeft: 8 }]}>
                        {t(lang, 'cbAlsoPostTelegram')}
                      </Text>
                    </Pressable>
                  )}

                  <Pressable
                    style={[s.btn, { backgroundColor: c.accent, marginTop: 12 }]}
                    onPress={handlePublish}
                    disabled={publishing || !newTitle.trim() || !newBody.trim()}
                  >
                    {publishing ? (
                      <ActivityIndicator color={c.bg} />
                    ) : (
                      <>
                        <Icon name="send" size={14} color={c.bg} />
                        <Text style={[s.btnText, { color: c.bg }]}>
                          {online ? (am ? 'ላክ' : 'Post') : t(lang, 'pending')}
                        </Text>
                      </>
                    )}
                  </Pressable>

                  {publishError && (
                    <Text style={[s.error, { fontFamily: am ? fonts.am : undefined }]}>
                      {publishError}
                    </Text>
                  )}
                </View>
              </SectionBoundary>
            )}

            {/* Announcements List Header & Boundary */}
            <SectionBoundary name="Today.Announcements" onRetry={reload}>
              <View style={s.sectionHeader}>
                <Text style={[s.sectionTitle, { color: c.textFaint }]}>ማስታወቂያ</Text>
                <View style={[s.chip, { borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: 6 }]}>
                  <Text style={[s.chipText, { color: c.textFaint }]}>{anns.length}</Text>
                </View>
              </View>

              {/* Announcements Items */}
              {anns.length === 0 ? (
                <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border, alignItems: 'center' }]}>
                  <Text style={[s.rowSub, { color: c.textFaint }]}>
                    {am ? 'ምንም ማስታወቂያ የለም' : 'No announcements posted.'}
                  </Text>
                </View>
              ) : (
                anns.map((a) => (
                  <Pressable
                    key={a.id}
                    style={[s.card, { backgroundColor: c.surface, borderColor: c.border, marginBottom: 8, padding: 16 }]}
                    onPress={() => setOpenAnnId(a.id)}
                  >
                    <Text style={[s.cardTitle, { color: c.text, fontFamily: am ? fonts.amBold : undefined }]}>
                      {am ? a.title_am : a.title_en}
                    </Text>
                    <Text style={[s.cardBody, { color: c.textSoft, fontFamily: am ? fonts.am : undefined }]} numberOfLines={2}>
                      {a.body}
                    </Text>
                    <View style={s.cardFooter}>
                      <Text style={[s.cardMeta, { color: c.textFaint }]}>
                        {new Date(a.created_at).toLocaleDateString(localeTag(lang), { month: 'short', day: 'numeric' })}
                      </Text>
                      <View style={[s.chip, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}>
                        <Text style={[s.chipText, { color: c.lapis }]}>
                          {a.reply_count ?? 0} መልሶች
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))
              )}
            </SectionBoundary>
          </View>
        )}
      </ScrollView>
      )}

      {/* Global Search Modal */}
      <Modal
        visible={searchOpen}
        animationType="fade"
        transparent={false}
        // Android routes hardware-back through this callback while a modal is
        // up; without it the back button does nothing on this screen.
        onRequestClose={() => {
          setSearchOpen(false);
          setSearchQuery('');
        }}
      >
        <SafeAreaView style={[s.wrap, { backgroundColor: c.bg }]}>
          <View style={[s.searchHeader, { borderBottomColor: c.border }]}>
            <View style={[s.searchBarContainer, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Icon name="search" size={16} color={c.textFaint} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={am ? "ቃል ይፈልጉ..." : "Search scripture..."}
                placeholderTextColor={c.textFaint}
                autoFocus={true}
                style={[s.searchInput, { color: c.text }]}
              />
            </View>
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setSearchQuery('');
              }}
              style={{ padding: 8 }}
            >
              <Text style={{ color: c.accent, fontWeight: '700' }}>{am ? "ዝጋ" : "Close"}</Text>
            </Pressable>
          </View>

          <SectionBoundary name="Today.Search">
            {searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                keyExtractor={(item, idx) => `${item.book}-${item.chapter}-${item.verse}-${idx}`}
                contentContainerStyle={{ padding: 16 }}
                renderItem={({ item }) => (
                  <Pressable
                    style={[s.searchItem, { borderBottomColor: c.border }]}
                    onPress={() => {
                      setSearchOpen(false);
                      router.push('/bible');
                    }}
                  >
                    <Text style={[s.searchRef, { color: c.accent }]}>
                      {am ? item.name_am : item.name_en} {item.chapter}:{item.verse}
                    </Text>
                    <Text style={[s.searchText, { color: c.text }]}>{item.text_am}</Text>
                    {item.text_en ? (
                      <Text style={[s.searchTextEn, { color: c.textFaint }]}>{item.text_en}</Text>
                    ) : null}
                  </Pressable>
                )}
              />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <Icon name="search" size={32} color={c.border} />
                <Text style={{ color: c.textFaint, marginTop: 12, textAlign: 'center' }}>
                  {searchQuery.trim()
                    ? (am ? "ምንም ውጤት አልተገኘም" : "No results found")
                    : (am ? "አማርኛ ወይም እንግሊዝኛ ቃላትን ያስገቡ" : "Search in Amharic or English")}
                </Text>
              </View>
            )}
          </SectionBoundary>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  h1: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  sub: { fontSize: 12, marginTop: 2 },
  topActs: { flexDirection: 'row', gap: 8 },
  iconbtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scroll: { paddingHorizontal: 16, paddingBottom: 100 },

  offlineBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  offlineText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },

  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 20,
    position: 'relative',
    overflow: 'hidden',
    marginTop: 4,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  verse: { fontSize: 19, lineHeight: 37, marginTop: 16, marginBottom: 12 },
  gloss: { fontSize: 14, lineHeight: 22 },
  verseFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  ref: { fontSize: 12.5, fontWeight: '700' },

  chip: {
    fontSize: 11,
    fontWeight: '600',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  chipText: { fontSize: 11, fontWeight: '600' },

  sectionHeader: {
    marginTop: 24,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    width: '100%',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 14.5, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 3 },
  meter: { height: 4, borderRadius: 99, overflow: 'hidden' },
  meterFill: { height: '100%' },

  cardTitle: { fontSize: 15, fontWeight: '600' },
  cardBody: { fontSize: 13.5, lineHeight: 22, marginTop: 6 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  cardMeta: { fontSize: 11.5 },

  detailHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  detailTitle: { fontSize: 20, fontWeight: '700', marginVertical: 8 },
  detailBody: { fontSize: 15, lineHeight: 24 },
  tagRow: { flexDirection: 'row', gap: 6, marginTop: 12 },

  dividerContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 20 },
  dividerLabel: { fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: '700' },
  dividerLine: { flex: 1, height: 1 },

  reply: {
    borderLeftWidth: 2,
    paddingLeft: 12,
    marginVertical: 8,
    paddingVertical: 4,
  },
  replyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  replyAuthor: { fontSize: 13, fontWeight: '700' },
  replyTime: { fontSize: 11 },
  replyPendingText: { fontSize: 11, fontWeight: '600', fontStyle: 'italic' },
  replyText: { fontSize: 13.5, lineHeight: 20 },

  lockedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 14,
    gap: 8,
    marginVertical: 14,
  },
  lockedText: { fontSize: 13, fontWeight: '600' },
  replyForm: { marginTop: 14 },
  textarea: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 10,
    fontSize: 14,
  },
  btn: {
    borderRadius: radius.md,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnText: { fontSize: 14, fontWeight: '600' },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  error: { color: '#D2564B', fontSize: 12, marginTop: 6 },
  note: { fontSize: 11.5, lineHeight: 18, marginTop: 14 },
  reflectionBody: { marginTop: 14, paddingTop: 14, borderTopWidth: 1 },
  reflectionText: { fontSize: 13.5, lineHeight: 21 },

  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  searchBarContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 10,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
    marginLeft: 8,
  },
  searchItem: { paddingVertical: 12, borderBottomWidth: 1 },
  searchRef: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  searchText: { fontSize: 15, lineHeight: 22 },
  searchTextEn: { fontSize: 13, marginTop: 2 },
});
