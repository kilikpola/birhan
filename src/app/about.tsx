import { View, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '@/theme/context';
import { t } from '@/i18n';
import { radius, space } from '@/theme/tokens';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { reportError } from '@/lib/errors';

type Credit = {
  nameKey: 'creditsKjvName' | 'creditsCrossRefsName' | 'creditsStrongsName' | 'creditsMhcName' | 'creditsPatristicName';
  licenseKey: 'creditsKjvLicense' | 'creditsCrossRefsLicense' | 'creditsStrongsLicense' | 'creditsMhcLicense' | 'creditsPatristicLicense';
  licenseUrl: string;
};

/**
 * Kept in step with the credits on birhan.online — the website repeats this
 * list, and a licence acknowledgement that appears in one place and not the
 * other is worse than useless.
 *
 * The English Bible text itself belongs here and was missing: the app ships the
 * KJV, and an attribution list that credits the cross-references but not the
 * translation they point into is incomplete.
 */
const CREDITS: Credit[] = [
  {
    nameKey: 'creditsKjvName',
    licenseKey: 'creditsKjvLicense',
    licenseUrl: 'https://en.wikipedia.org/wiki/King_James_Version#Copyright_status',
  },
  {
    nameKey: 'creditsCrossRefsName',
    licenseKey: 'creditsCrossRefsLicense',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    nameKey: 'creditsStrongsName',
    licenseKey: 'creditsStrongsLicense',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
  },
  {
    nameKey: 'creditsMhcName',
    licenseKey: 'creditsMhcLicense',
    licenseUrl: 'https://crosswire.org/sword/modules/ModInfo.jsp?modName=MHCC',
  },
  {
    nameKey: 'creditsPatristicName',
    licenseKey: 'creditsPatristicLicense',
    licenseUrl: 'https://github.com/HistoricalChristianFaith/Commentaries-Database',
  },
];

export default function AboutScreen() {
  const { c, lang } = useApp();
  const isAm = lang === 'am';

  const openLicense = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (err) {
      reportError(err, 'About.openLicense', lang, false);
    }
  };

  return (
    <SafeAreaView style={[styles.outer, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <Icon name="chev" size={18} color={c.textSoft} />
          </View>
        </Pressable>
        <ThemedText type="subtitle" colorType="text">
          {t(lang, 'about')}
        </ThemedText>
        <View style={{ width: 18 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <ThemedText type="subtitle" colorType="text" style={{ marginBottom: space.sm }}>
          {t(lang, 'creditsTitle')}
        </ThemedText>
        <ThemedText type="default" colorType="textSoft" isAmharic={isAm} style={styles.intro}>
          {t(lang, 'creditsIntro')}
        </ThemedText>

        {CREDITS.map((credit) => (
          <View key={credit.nameKey} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <ThemedText type="default" colorType="text" style={styles.creditName}>
              {t(lang, credit.nameKey)}
            </ThemedText>
            <View style={styles.row}>
              <View style={[styles.badge, { borderColor: c.accentDim, backgroundColor: c.accentGlow }]}>
                <ThemedText type="smallBold" colorType="accent">{t(lang, credit.licenseKey)}</ThemedText>
              </View>
              <Pressable onPress={() => openLicense(credit.licenseUrl)} hitSlop={8}>
                <ThemedText type="link" colorType="lapis">{t(lang, 'creditsViewLicense')}</ThemedText>
              </Pressable>
            </View>
          </View>
        ))}
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
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  body: { padding: space.lg, paddingBottom: 40 },
  intro: { marginBottom: space.lg, lineHeight: 22 },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.md,
  },
  creditName: { fontSize: 14.5, fontWeight: '600', marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
