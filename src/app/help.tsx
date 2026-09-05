import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '@/theme/context';
import { t, type Key } from '@/i18n';
import { radius, space } from '@/theme/tokens';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';

/**
 * "Tap this to do that." A plain guide to the app, reached from Settings.
 *
 * Deliberately not a marketing tour — it names the actual controls a person
 * sees (the book icon, the globe, the tabs along the bottom) and says, for
 * each, what tapping it does. Every instruction here corresponds to a real
 * control in the app; if one is renamed or moved, its line here has to move
 * with it, which is why they read as concrete gestures rather than features.
 */

type Item = { icon: IconName; text: Key };
type Group = { title: Key; items: Item[] };

const GROUPS: Group[] = [
  {
    title: 'helpTabsTitle',
    items: [
      { icon: 'quote', text: 'helpTabToday' },
      { icon: 'book', text: 'helpTabBible' },
      { icon: 'note', text: 'helpTabResources' },
      { icon: 'gear', text: 'helpTabSettings' },
    ],
  },
  {
    title: 'helpBibleTitle',
    items: [
      { icon: 'book', text: 'helpBibleBook' },
      { icon: 'search', text: 'helpBibleSearch' },
      { icon: 'globe', text: 'helpBibleGlobe' },
      { icon: 'note', text: 'helpBibleVerse' },
      { icon: 'chev', text: 'helpBibleChapter' },
    ],
  },
  {
    title: 'helpTodayTitle',
    items: [
      { icon: 'search', text: 'helpTodaySearch' },
      { icon: 'sun', text: 'helpTodayTheme' },
    ],
  },
  {
    title: 'helpAccountTitle',
    items: [{ icon: 'user', text: 'helpAccountBody' }],
  },
];

export default function Help() {
  const { c, lang } = useApp();
  const isAm = lang === 'am';

  return (
    <SafeAreaView style={[styles.outer, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <Icon name="chev" size={18} color={c.textSoft} />
          </View>
        </Pressable>
        <ThemedText type="subtitle" colorType="text" isAmharic={isAm}>
          {t(lang, 'helpTitle')}
        </ThemedText>
        <View style={{ width: 18 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <ThemedText type="default" colorType="textSoft" isAmharic={isAm} style={styles.intro}>
          {t(lang, 'helpIntro')}
        </ThemedText>

        {GROUPS.map((g) => (
          <View key={g.title} style={styles.group}>
            <ThemedText type="smallBold" colorType="textFaint" isAmharic={isAm} style={styles.groupTitle}>
              {t(lang, g.title)}
            </ThemedText>
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              {g.items.map((item, i) => (
                <View key={item.text}>
                  {i > 0 ? <View style={[styles.divider, { backgroundColor: c.border }]} /> : null}
                  <View style={styles.row}>
                    <View style={[styles.badge, { backgroundColor: c.accentGlow, borderColor: c.accentDim }]}>
                      <Icon name={item.icon} size={18} color={c.accent} />
                    </View>
                    <ThemedText
                      type="default"
                      colorType="textSoft"
                      isAmharic={isAm}
                      style={styles.rowText}
                    >
                      {t(lang, item.text)}
                    </ThemedText>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* The one thing worth saying twice: reading is offline, the rest isn't. */}
        <View style={[styles.note, { backgroundColor: c.accentGlow, borderColor: c.accentDim }]}>
          <Icon name="check" size={16} color={c.accent} />
          <ThemedText type="small" colorType="text" isAmharic={isAm} style={styles.noteText}>
            {t(lang, 'helpOfflineNote')}
          </ThemedText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
  },
  body: { padding: space.lg, paddingBottom: space.xxl, gap: space.lg },
  intro: { fontSize: 14.5, lineHeight: 24 },

  group: { gap: space.sm },
  groupTitle: { letterSpacing: 1, textTransform: 'uppercase', fontSize: 11.5 },
  card: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 60 },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 56 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowText: { flex: 1, fontSize: 14, lineHeight: 22 },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  noteText: { flex: 1, fontSize: 13.5, lineHeight: 22 },
});
