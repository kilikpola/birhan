import { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  useWindowDimensions,
  StyleSheet,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/icon';
import { Logo } from '@/components/logo';
import { Cross } from '@/components/cross';
import { radius, space, fonts } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';

/**
 * The first thing a new person sees, before they are asked to sign in.
 *
 * Someone deciding whether to make an account should first know what the app
 * is — that it is a Bible that works with no signal, that it carries their
 * church, that it is free. So this sits ahead of Auth in the gate, shows once,
 * and records that it has been seen; it never appears again, and it never
 * blocks a returning user, because a returning user has a session and never
 * reaches this branch.
 *
 * It is skippable from the first slide. Nothing here is a gate — it is an
 * introduction, and an introduction you cannot leave is an obstacle.
 */

type Slide = {
  key: string;
  icon: IconName;
  title: keyof typeof import('@/i18n').am;
  body: keyof typeof import('@/i18n').am;
};

const SLIDES: Slide[] = [
  { key: 'welcome', icon: 'church', title: 'obWelcomeTitle', body: 'obWelcomeBody' },
  { key: 'offline', icon: 'book', title: 'obOfflineTitle', body: 'obOfflineBody' },
  { key: 'study', icon: 'search', title: 'obStudyTitle', body: 'obStudyBody' },
  { key: 'church', icon: 'user', title: 'obChurchTitle', body: 'obChurchBody' },
];

export function Onboarding({
  c,
  lang,
  onDone,
}: {
  c: Palette;
  lang: Lang;
  /** Called on Skip or after the last slide's Get started. */
  onDone: () => void;
}) {
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const isAm = lang === 'am';
  const last = index === SLIDES.length - 1;

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
    scroller.current?.scrollTo({ x: clamped * width, animated: true });
    setIndex(clamped);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
      {/* Skip is always reachable, and never on the last slide where Get
          started already means the same thing. */}
      <View style={styles.top}>
        <Logo size={30} />
        {!last ? (
          <Pressable onPress={onDone} hitSlop={12} accessibilityRole="button">
            <Text style={[styles.skip, { color: c.textFaint }, isAm && styles.amMuted]}>
              {t(lang, 'obSkip')}
            </Text>
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={{ flex: 1 }}
      >
        {SLIDES.map((s) => (
          <View key={s.key} style={[styles.slide, { width }]}>
            <View style={[styles.badge, { backgroundColor: c.accentGlow, borderColor: c.accentDim }]}>
              <Icon name={s.icon} size={40} color={c.accent} />
            </View>
            <Text style={[styles.title, { color: c.text }, isAm && styles.amTitle]}>
              {t(lang, s.title)}
            </Text>
            <Text style={[styles.body, { color: c.textSoft }, isAm && styles.amBody]}>
              {t(lang, s.body)}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* dots */}
      <View style={styles.dots} accessibilityRole="tablist">
        {SLIDES.map((s, i) => {
          const active = i === index;
          return (
            <Pressable
              key={s.key}
              onPress={() => goTo(i)}
              hitSlop={10}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View
                style={[
                  styles.dot,
                  {
                    width: active ? 22 : 8,
                    backgroundColor: active ? c.accent : c.border,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {/* controls */}
      <View style={styles.controls}>
        {index > 0 ? (
          <Pressable onPress={() => goTo(index - 1)} style={styles.back} accessibilityRole="button">
            <Icon name="back" size={16} color={c.textSoft} />
            <Text style={[styles.backTxt, { color: c.textSoft }, isAm && styles.amMuted]}>
              {t(lang, 'obBack')}
            </Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        <Pressable
          onPress={() => (last ? onDone() : goTo(index + 1))}
          style={[styles.cta, { backgroundColor: c.accent }]}
          accessibilityRole="button"
        >
          {last ? <Cross size={14} color={c.bg} /> : null}
          <Text style={[styles.ctaTxt, { color: c.bg }, isAm && styles.amCta]}>
            {t(lang, last ? 'obStart' : 'obNext')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  skip: { fontSize: 14.5, fontWeight: '600' },
  amMuted: { fontFamily: fonts.am },

  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.lg,
  },
  badge: {
    width: 108,
    height: 108,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', lineHeight: 32 },
  amTitle: { fontFamily: fonts.amBold, lineHeight: 42 },
  body: { fontSize: 15.5, lineHeight: 25, textAlign: 'center', maxWidth: 340 },
  // Ge'ez needs the taller line box — ~1.9x, per the project's own rule.
  amBody: { fontFamily: fonts.am, lineHeight: 31 },

  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingVertical: space.lg },
  dot: { height: 8, borderRadius: radius.pill },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    paddingTop: space.xs,
    gap: space.md,
  },
  back: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48 },
  backTxt: { fontSize: 14.5, fontWeight: '600' },
  cta: {
    minHeight: 52,
    minWidth: 150,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  ctaTxt: { fontSize: 15.5, fontWeight: '700' },
  amCta: { fontFamily: fonts.amBold },
});
