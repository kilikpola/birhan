import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Slider,
} from 'react-native';
import { useApp } from '@/theme/context';
import { t } from '@/i18n';
import { space, radius, fonts, TARGET } from '@/theme/tokens';
import { Icon } from '@/components/icon';
import { formatTime, getState, subscribe, play, pause, seek, setPlaybackRate, setVolume, skipForward, skipBackward, getAvailableRates } from '@/lib/audioPlayer';

interface AudioPlayerOverlayProps {
  visible: boolean;
  onClose: () => void;
  onLoadChapter: (bookId: number, chapter: number) => Promise<void>;
  currentBook: number | null;
  currentChapter: number | null;
  books: { id: number; name_am: string; name_en: string; chapters: number }[];
}

export function AudioPlayerOverlay({
  visible,
  onClose,
  onLoadChapter,
  currentBook,
  currentChapter,
  books,
}: AudioPlayerOverlayProps) {
  const { c, lang } = useApp();
  const isAm = lang === 'am';
  const bookName = (b: { name_am: string; name_en: string }) => isAm ? b.name_am : b.name_en;
  const numeral = (n: number) => isAm ? toGeezNumeral(n) : String(n);
  
  const [playerState, setPlayerState] = React.useState(getState());
  const [expanded, setExpanded] = React.useState(false);
  const [showRatePicker, setShowRatePicker] = React.useState(false);
  const [volume, setVolumeState] = React.useState(playerState.volume);
  const slideAnim = useMemo(() => new Animated.Value(0), []);
  const fadeAnim = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const unsubscribe = subscribe(setPlayerState);
    if (visible) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      Animated.timing(slideAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      Animated.timing(slideAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start();
    }
    return unsubscribe;
  }, [visible, fadeAnim, slideAnim]);

  useEffect(() => {
    if (playerState.isLoaded && playerState.currentBook && playerState.currentChapter) {
      const book = books.find(b => b.id === playerState.currentBook);
      if (book && playerState.currentChapter !== currentChapter) {
        // Chapter changed externally, could auto-load next
      }
    }
  }, [currentBook, currentChapter, playerState.currentBook, playerState.currentChapter, playerState.isLoaded, books]);

  const handlePlayPause = async () => {
    if (playerState.isPlaying) {
      await pause();
    } else {
      await play();
    }
  };

  const handleSeek = async (value: number) => {
    await seek(value);
  };

  const handleRateChange = async (rate: number) => {
    await setPlaybackRate(rate);
    setShowRatePicker(false);
  };

  const handleVolumeChange = async (value: number) => {
    setVolumeState(value);
    await setVolume(value);
  };

  const handleNextChapter = async () => {
    if (!playerState.currentBook || !playerState.currentChapter) return;
    const book = books.find(b => b.id === playerState.currentBook);
    if (!book) return;
    
    if (playerState.currentChapter < book.chapters) {
      await onLoadChapter(playerState.currentBook, playerState.currentChapter + 1);
    } else {
      const bookIndex = books.findIndex(b => b.id === playerState.currentBook);
      if (bookIndex < books.length - 1) {
        const nextBook = books[bookIndex + 1];
        await onLoadChapter(nextBook.id, 1);
      }
    }
  };

  const handlePrevChapter = async () => {
    if (!playerState.currentBook || !playerState.currentChapter) return;
    
    if (playerState.currentChapter > 1) {
      await onLoadChapter(playerState.currentBook, playerState.currentChapter - 1);
    } else {
      const bookIndex = books.findIndex(b => b.id === playerState.currentBook);
      if (bookIndex > 0) {
        const prevBook = books[bookIndex - 1];
        await onLoadChapter(prevBook.id, prevBook.chapters);
      }
    }
  };

  if (!visible && fadeAnim._value === 0) return null;

  const currentBookObj = playerState.currentBook ? books.find(b => b.id === playerState.currentBook) : null;

  return (
    <Animated.View
      style={[
        styles.overlay,
        { backgroundColor: `rgba(0,0,0,${fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] })}` },
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Pressable onPress={onClose} style={styles.backdrop} />
      
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: c.surface, borderColor: c.border },
          { transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [300, 0] })}] },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: c.borderLit }]} />
        
        {!expanded ? (
          <View style={styles.compact}>
            <Pressable onPress={() => setExpanded(true)} style={styles.compactRow}>
              <View style={[styles.compactInfo, { flex: 1 }]}>
                <Text style={[styles.compactTitle, { color: c.text }]} numberOfLines={1}>
                  {currentBookObj ? `${bookName(currentBookObj)} ${numeral(playerState.currentChapter || 1)}` : t(lang, 'audioPlayer')}
                </Text>
                <View style={styles.compactProgress}>
                  <Animated.View
                    style={[
                      styles.progressBar,
                      { backgroundColor: c.border },
                      { width: `${(playerState.position / (playerState.duration || 1)) * 100}%` },
                    ]}
                  />
                </View>
              </View>
              <Pressable onPress={handlePlayPause} style={styles.compactPlayBtn} accessibilityRole="button">
                <Icon name={playerState.isPlaying ? 'pause' : 'play'} size={28} color={c.accent} />
              </Pressable>
            </Pressable>
          </View>
        ) : (
          <View style={styles.expanded}>
            <View style={styles.expandedHeader}>
              <Pressable onPress={() => setExpanded(false)} style={styles.textBtn} accessibilityRole="button">
                <Text style={[styles.textBtnTxt, { color: c.accent }]}>{t(lang, 'close')}</Text>
              </Pressable>
              <Text style={[styles.expandedTitle, { color: c.text }]}>{t(lang, 'audioPlayer')}</Text>
              <View style={{ width: 60 }} />
            </View>

            {currentBookObj && (
              <View style={styles.chapterInfo}>
                <Text style={[styles.chapterBook, { color: c.textSoft }]}>{bookName(currentBookObj)}</Text>
                <Text style={[styles.chapterNum, { color: c.accent, fontFamily: isAm ? fonts.amBold : fonts.serif }]}>
                  {numeral(playerState.currentChapter || 1)}
                </Text>
              </View>
            )}

            <View style={styles.progressSection}>
              <Text style={[styles.timeText, { color: c.textSoft }]}>{formatTime(playerState.position)}</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={playerState.duration || 1}
                value={playerState.position}
                onValueChange={handleSeek}
                onSlidingComplete={handleSeek}
                minimumTrackTintColor={c.accent}
                maximumTrackTintColor={c.border}
                thumbTintColor={c.accent}
              />
              <Text style={[styles.timeText, { color: c.textSoft }]}>{formatTime(playerState.duration)}</Text>
            </View>

            <View style={styles.controls}>
              <Pressable onPress={handlePrevChapter} style={styles.controlBtn} accessibilityRole="button" accessibilityLabel={t(lang, 'a11yPrevChapter')}>
                <Icon name="back" size={24} color={c.text} />
              </Pressable>
              <Pressable onPress={handlePlayPause} style={[styles.controlBtn, styles.controlBtnMain, { backgroundColor: c.accent }]} accessibilityRole="button" accessibilityLabel={playerState.isPlaying ? t(lang, 'pause') : t(lang, 'play')}>
                <Icon name={playerState.isPlaying ? 'pause' : 'play'} size={32} color={c.onAccent} />
              </Pressable>
              <Pressable onPress={handleNextChapter} style={styles.controlBtn} accessibilityRole="button" accessibilityLabel={t(lang, 'a11yNextChapter')}>
                <Icon name="chev" size={24} color={c.text} />
              </Pressable>
            </View>

            <View style={styles.secondaryControls}>
              <Pressable onPress={() => skipBackward(10)} style={styles.controlBtn} accessibilityRole="button" accessibilityLabel={`${t(lang, 'rewind')} 10s`}>
                <Icon name="rewind10" size={20} color={c.textSoft} />
              </Pressable>
              <Pressable onPress={() => skipForward(10)} style={styles.controlBtn} accessibilityRole="button" accessibilityLabel={`${t(lang, 'forward')} 10s`}>
                <Icon name="forward10" size={20} color={c.textSoft} />
              </Pressable>
              <Pressable onPress={() => setShowRatePicker(true)} style={styles.controlBtn} accessibilityRole="button" accessibilityLabel={t(lang, 'playbackSpeed')}>
                <Text style={[styles.rateBtn, { color: c.text }]}>{playerState.playbackRate.toFixed(2)}×</Text>
              </Pressable>
            </View>

            <View style={styles.volumeSection}>
              <Icon name="volume" size={20} color={c.textSoft} />
              <Slider
                style={styles.volumeSlider}
                minimumValue={0}
                maximumValue={1}
                value={volume}
                onValueChange={handleVolumeChange}
                minimumTrackTintColor={c.accent}
                maximumTrackTintColor={c.border}
                thumbTintColor={c.accent}
              />
              <Icon name="volumeUp" size={20} color={c.textSoft} />
            </View>
          </View>
        )}

        {showRatePicker && (
          <View style={[styles.ratePicker, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.ratePickerTitle, { color: c.text }]}>{t(lang, 'playbackSpeed')}</Text>
            <View style={styles.rateOptions}>
              {getAvailableRates().map(rate => (
                <Pressable
                  key={rate}
                  onPress={() => handleRateChange(rate)}
                  style={[
                    styles.rateOption,
                    rate === playerState.playbackRate && { backgroundColor: c.accentGlow, borderColor: c.accent },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: rate === playerState.playbackRate }}
                >
                  <Text style={[styles.rateOptionText, { color: rate === playerState.playbackRate ? c.accent : c.text }]}>
                    {rate.toFixed(2)}×
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
}

function toGeezNumeral(n: number): string {
  const geezDigits = ['፩', '፪', '፫', '፬', '፭', '፮', '፯', '፰', '፱', '፲'];
  return String(n).split('').map(d => geezDigits[parseInt(d)] || d).join('');
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    justifyContent: 'flex-end',
  },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: space.xxl,
    overflow: 'hidden',
  },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginTop: space.sm },
  compact: { paddingHorizontal: space.lg, paddingVertical: space.md },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  compactInfo: { minWidth: 0 },
  compactTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  compactProgress: { height: 3, borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: '100%', borderRadius: 2 },
  compactPlayBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#00000020', alignItems: 'center', justifyContent: 'center' },
  expandedHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#00000020' },
  expandedTitle: { fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  textBtn: { minHeight: TARGET, minWidth: TARGET, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  textBtnTxt: { fontSize: 16, fontWeight: '600' },
  chapterInfo: { alignItems: 'center', paddingVertical: space.lg },
  chapterBook: { fontSize: 15, marginBottom: 2 },
  chapterNum: { fontSize: 48, lineHeight: 60 },
  progressSection: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, marginBottom: space.lg },
  timeText: { fontSize: 13, fontFamily: fonts.am, width: 50, textAlign: 'center' },
  slider: { flex: 1, height: 40 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingHorizontal: space.lg, marginBottom: space.lg },
  controlBtn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000010' },
  controlBtnMain: { width: 72, height: 72, borderRadius: 36 },
  secondaryControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingHorizontal: space.lg, marginBottom: space.lg },
  rateBtn: { fontSize: 15, fontWeight: '600', paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: '#00000010' },
  volumeSection: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg },
  volumeSlider: { flex: 1, height: 40 },
  ratePicker: { padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#00000020' },
  ratePickerTitle: { fontSize: 16, fontWeight: '600', marginBottom: space.md },
  rateOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rateOption: {
    minWidth: 60,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateOptionText: { fontSize: 15, fontWeight: '600' },
});