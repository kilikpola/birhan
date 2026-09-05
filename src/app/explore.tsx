import { useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useApp } from '@/theme/context';
import { t } from '@/i18n';
import { ThemedText } from '@/components/themed-text';
import { Cross } from '@/components/cross';
import { Icon } from '@/components/icon';
import { Logo } from '@/components/logo';
import { VerificationStatus } from '@/components/verification-status';
import { SectionBoundary } from '@/components/section-boundary';
import { useAuth } from '@/lib/auth';
import { reportError } from '@/lib/errors';
import { radius, space } from '@/theme/tokens';

import { Section, Card, Row, SubLabel, ChoiceRows } from '@/components/settings/rows';
import { AccountSection } from '@/components/settings/account-section';
import { DataSection } from '@/components/settings/data-section';
import { UpdateSection } from '@/components/settings/update-section';
import { DeleteAccountModal } from '@/components/settings/delete-account';
import { getCurrentVersionName, getCurrentVersionCode } from '@/lib/apkUpdates';
import type { ThemeMode, ReadingLang } from '@/theme/context';
import type { Lang } from '@/i18n';

const PRIVACY_URL = 'https://birhan.online/#privacy';
const CONTACT_EMAIL = 'mailto:hello@birhan.online';

/**
 * Settings.
 *
 * This screen used to be a single undifferentiated column: profile card,
 * then a dozen rows mixing "your church" with "night reading" with "allow
 * mobile data", then sign out. Nothing indicated which rows belonged
 * together, so finding anything meant reading all of it.
 *
 * It is now five groups, in the order someone is likely to want them —
 * who you are, how it looks, what it is using, whether it is current, and
 * what it is made of.
 */
export default function SettingsScreen() {
  const {
    c,
    lang,
    setLang,
    themeMode,
    setThemeMode,
    readingLang,
    setReadingLang,
  } = useApp();
  const { profile, signOut, isSuperAdmin, resendVerificationEmail, syncVerification } = useAuth();

  const [showDelete, setShowDelete] = useState(false);
  const isAm = lang === 'am';

  // Standing reminder for anyone who dismissed the post-signup verification
  // screen before confirming — that screen only shows once, so this is the
  // only other way back to "resend".
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const handleResend = async () => {
    setResendState('sending');
    const res = await resendVerificationEmail();
    if (res.status === 'sent') {
      setResendState('sent');
    } else if (res.status === 'already_verified') {
      setResendState('sent');
      syncVerification().catch(() => {});
    } else {
      setResendState('error');
      reportError(new Error(res.message), 'Settings.resendVerification', lang, false);
    }
  };

  const themeOptions: { value: ThemeMode; label: string; amharic?: boolean }[] = [
    { value: 'dark', label: t(lang, 'themeDark'), amharic: isAm },
    { value: 'light', label: t(lang, 'themeLight'), amharic: isAm },
    { value: 'system', label: t(lang, 'themeSystem'), amharic: isAm },
  ];

  const uiLangOptions: { value: Lang; label: string; amharic?: boolean }[] = [
    { value: 'am', label: 'አማርኛ', amharic: true },
    { value: 'en', label: 'English' },
  ];

  const readingOptions: { value: ReadingLang; label: string; amharic?: boolean }[] = [
    { value: 'am', label: 'አማርኛ', amharic: true },
    { value: 'en', label: 'English' },
    { value: 'both', label: t(lang, 'readingBoth'), amharic: isAm },
  ];

  return (
    <SafeAreaView style={[styles.outer, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomColor: c.border, backgroundColor: c.bg }]}>
        <ThemedText type="title" colorType="text" isAmharic={isAm}>
          {t(lang, 'settingsTitle')}
        </ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Who is signed in — kept above the groups because it answers
            "whose settings are these" before anything else. */}
        <SectionBoundary name="Settings.Profile">
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderLit }]}>
            <View style={[styles.avatar, { backgroundColor: c.accentGlow, borderColor: c.accentDim }]}>
              <Icon name="user" size={22} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="subtitle" colorType="text" style={styles.name}>
                {profile?.display_name || (isAm ? 'አባል' : 'Member')}
              </ThemedText>
              <ThemedText type="small" colorType="textFaint" style={{ marginTop: 2 }}>
                {profile?.email || profile?.phone || ''}
              </ThemedText>
            </View>
            <View style={[styles.chip, { borderColor: c.accentDim, backgroundColor: c.accentGlow }]}>
              <Cross size={8} color={c.accent} />
              <ThemedText type="smallBold" colorType="accent" style={styles.chipTxt}>
                {profile?.role === 'super_admin'
                  ? (isAm ? 'ሱፐር' : 'Super')
                  : profile?.role === 'pastor'
                    ? (isAm ? 'እረኛ' : 'Pastor')
                    : (isAm ? 'አባል' : 'Member')}
              </ThemedText>
            </View>
          </View>
        </SectionBoundary>

        {!!profile?.email && !profile.email_verified && (
          <SectionBoundary name="Settings.VerificationReminder">
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, marginTop: space.md }]}>
              <VerificationStatus
                c={c}
                state={resendState === 'sending' ? 'sending' : resendState === 'sent' ? 'sent' : 'unverified'}
                title={t(lang, 'notVerifiedStatus')}
                note={resendState === 'sent' ? t(lang, 'resendSentConfirm') : profile.email}
                actionLabel={resendState === 'sending' ? undefined : t(lang, 'btnResendEmail')}
                onAction={resendState === 'sending' ? undefined : handleResend}
              />
            </View>
          </SectionBoundary>
        )}

        {/* Super-admins get their queue near the top; it is work, not a setting. */}
        {isSuperAdmin && (
          <SectionBoundary name="Settings.Verification">
            <Pressable
              onPress={() => router.push('/verification' as Href)}
              style={[styles.adminRow, { backgroundColor: c.surface, borderColor: c.accentDim }]}
              accessibilityRole="button"
            >
              <ThemedText type="default" colorType="accent" isAmharic={isAm} style={styles.adminTxt}>
                {t(lang, 'verificationQueue')}
              </ThemedText>
              <Icon name="chev" size={15} color={c.accent} />
            </Pressable>
          </SectionBoundary>
        )}

        <SectionBoundary name="Settings.Account">
          <Section c={c} lang={lang} title={t(lang, 'accountSectionTitle')}>
            <AccountSection
              c={c}
              lang={lang}
              profile={profile}
              onSignOut={signOut}
              onDelete={() => setShowDelete(true)}
            />
          </Section>
        </SectionBoundary>

        <SectionBoundary name="Settings.Appearance">
          <Section c={c} lang={lang} title={t(lang, 'sectionAppearance')}>
            <Card c={c}>
              <SubLabel c={c} lang={lang} text={t(lang, 'themeLabel')} />
              <ChoiceRows c={c} lang={lang} selected={themeMode} options={themeOptions} onSelect={setThemeMode} />
            </Card>
            <View style={{ height: space.md }} />
            <Card c={c}>
              <SubLabel c={c} lang={lang} text={t(lang, 'interfaceLanguageLabel')} />
              <ChoiceRows c={c} lang={lang} selected={lang} options={uiLangOptions} onSelect={setLang} />
            </Card>
            <View style={{ height: space.md }} />
            <Card c={c}>
              <SubLabel c={c} lang={lang} text={t(lang, 'readingLanguageLabel')} />
              <ChoiceRows c={c} lang={lang} selected={readingLang} options={readingOptions} onSelect={setReadingLang} />
            </Card>
          </Section>
        </SectionBoundary>

        <SectionBoundary name="Settings.Data">
          <Section c={c} lang={lang} title={t(lang, 'sectionDataDownloads')}>
            <DataSection c={c} lang={lang} />
          </Section>
        </SectionBoundary>

        <SectionBoundary name="Settings.Updates">
          <Section c={c} lang={lang} title={t(lang, 'sectionUpdates')}>
            <UpdateSection c={c} lang={lang} />
          </Section>
        </SectionBoundary>

        <SectionBoundary name="Settings.About">
          <Section c={c} lang={lang} title={t(lang, 'sectionAbout')}>
            <Card c={c}>
              <Row c={c} lang={lang} label={t(lang, 'helpRow')} onPress={() => router.push('/help' as Href)} />
              <Row c={c} lang={lang} label={t(lang, 'about')} onPress={() => router.push('/about' as Href)} />
              <Row
                c={c}
                lang={lang}
                label={t(lang, 'privacyLabel')}
                onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL).catch(() => {})}
              />
              <Row
                c={c}
                lang={lang}
                label={t(lang, 'contactLabel')}
                // Linking, not WebBrowser: openBrowserAsync opens a Custom Tab,
                // which has no idea what to do with a mailto: URL. This hands it
                // to whatever mail app the phone actually has.
                onPress={() => Linking.openURL(CONTACT_EMAIL).catch(() => {})}
              />
            </Card>
          </Section>
        </SectionBoundary>

        <View style={styles.foot}>
          <Logo size={56} />
          <ThemedText type="small" colorType="textFaint" style={{ marginTop: space.sm }}>
            Birhan · v{getCurrentVersionName()} ({getCurrentVersionCode()})
          </ThemedText>
        </View>
      </ScrollView>

      <DeleteAccountModal
        visible={showDelete}
        c={c}
        lang={lang}
        onClose={() => setShowDelete(false)}
        onDeleted={() => {
          setShowDelete(false);
          signOut();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  header: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
  },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: 64 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 16, fontWeight: '600' },
  chip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipTxt: { fontSize: 9.5, marginLeft: 4 },
  adminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    marginTop: space.md,
  },
  adminTxt: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  foot: { alignItems: 'center', marginTop: space.xxl },
});
