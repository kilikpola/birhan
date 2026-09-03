import React, { useState, useEffect } from "react";
import { StyleSheet, View, ScrollView, TouchableOpacity, Pressable, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useApp } from "@/theme/context";
import { t } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { Cross } from "@/components/cross";
import { Icon } from "@/components/icon";
import { DeleteAccountModal, DeleteAccountRow } from '../components/settings/delete-account';
import { Logo } from "@/components/logo";
import { VerificationStatus } from "@/components/verification-status";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { radius, space, fonts } from "@/theme/tokens";
import { SectionBoundary } from "@/components/section-boundary";
import { reportError } from "@/lib/errors";
import Constants from "expo-constants";
import { UpdateSection } from "@/components/settings/update-section";
import { initOtaUpdateListener } from "@/lib/otaUpdates";

export default function MoreScreen() {
  const { c, night: isNight, setNight, lang: locale, setLang: setLocale } = useApp();
  const { profile, signOut, isSuperAdmin, resendVerificationEmail, syncVerification } = useAuth();
  const [showDelete, setShowDelete] = useState(false);

  const isAm = locale === "am";

  // Standing reminder for anyone who dismissed the post-signup verification
  // screen (or restarted the app) before confirming — that screen only shows
  // once, so this is the only other way back to "resend".
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const handleResendVerification = async () => {
    setResendState('sending');
    const res = await resendVerificationEmail();
    if (res.status === 'sent') {
      setResendState('sent');
    } else if (res.status === 'already_verified') {
      setResendState('sent');
      syncVerification().catch(() => {});
    } else {
      setResendState('error');
      reportError(new Error(res.message), 'Explore.resendVerification', locale, false);
    }
  };
  const toggleTheme = () => setNight(!isNight);

  // Seeded churches offline fallback lookup map
  const SEEDED_MAP: Record<string, { am: string; en: string }> = {
    'a0000000-0000-4000-8000-000000000001': { am: 'የኢትዮጵያ ወንጌላዊት ቤተ ክርስቲያን መካነ ኢየሱስ', en: 'Ethiopian Evangelical Church Mekane Yesus' },
    'a0000000-0000-4000-8000-000000000002': { am: 'የኢትዮጵያ ቃለ ሕይወት ቤተ ክርስቲያን', en: 'Ethiopian Kale Heywet Church' },
    'a0000000-0000-4000-8000-000000000003': { am: 'የኢትዮጵያ ሙሉ ወንጌል አማኞች ቤተ ክርስቲያን', en: "Ethiopian Full Gospel Believers' Church" },
    'a0000000-0000-4000-8000-000000000004': { am: 'መሠረተ ክርስቶስ ቤተ ክርስቲያን', en: 'Meserete Kristos Church' },
    'a0000000-0000-4000-8000-000000000005': { am: 'አማኑኤል ኅብረት ቤተ ክርስቲያን', en: 'Emmanuel United Church' },
    'a0000000-0000-4000-8000-000000000006': { am: 'ሕይወት ብርሃን ቤተ ክርስቲያን', en: 'Hiwot Berhan Church' },
    'a0000000-0000-4000-8000-000000000007': { am: 'የኢትዮጵያ ባፕቲስት አብያተ ክርስቲያናት', en: 'Ethiopian Baptist Churches' },
  };

  // Church Name States
  const [churchNameAm, setChurchNameAm] = useState("");
  const [churchNameEn, setChurchNameEn] = useState("");

  useEffect(() => {
    if (!profile?.church_id) {
      setChurchNameAm("");
      setChurchNameEn("");
      return;
    }

    // Clear and set initial cached/seeded values
    const seededChurch = SEEDED_MAP[profile.church_id];
    setChurchNameAm(profile.church_name_am || seededChurch?.am || "");
    setChurchNameEn(profile.church_name_en || seededChurch?.en || "");

    let active = true;
    // No single-church-by-id route exists — only list-all (GET /churches) and
    // branches-by-church. Fetching the full list is what's available; it's
    // public and small, but this re-downloads every church for one lookup.
    apiFetch<{ churches: any[] }>("/api/v1/churches", { auth: false })
      .then((res) => {
        if (!active) return;
        const data = res.churches.find((ch) => ch.id === profile.church_id);
        if (data) {
          setChurchNameAm(data.nameAm);
          setChurchNameEn(data.nameEn);
        }
      })
      .catch((err) => reportError(err, "Explore.loadChurch", "am", false));
    return () => { active = false; };
  }, [profile?.church_id, profile?.church_name_am, profile?.church_name_en]);

  const displayRole = () => {
    if (profile?.role === "super_admin") return isAm ? "ሱፐር አስተዳዳሪ" : "Super Admin";
    if (profile?.role === "pastor") return isAm ? "እረኛ (Pastor)" : "Pastor";
    if (profile?.role === "admin") return isAm ? "አስተዳዳሪ (Admin)" : "Admin";
    if (profile?.role === "pending_pastor") return isAm ? "በመጠባበቅ ላይ" : "Pending pastor";
    return isAm ? "አባል" : "Member";
  };

  useEffect(() => {
    // OTA (JS-only) patches, in the background. Fire-and-forget: nothing here
    // is awaited, so an unreachable update server cannot delay the screen.
    initOtaUpdateListener();
  }, []);

  const currentChurchDisplay = isAm ? (churchNameAm || churchNameEn) : (churchNameEn || churchNameAm);

  const appVersion = Constants.expoConfig?.version ? `v${Constants.expoConfig.version}` : 'v1.0.0';

  const settingsItems = [
    { l: isAm ? "ሙሉ ስም" : "Display Name", v: profile?.display_name || '—' },
    { l: isAm ? "ቤተ ክርስቲያኔ" : "My Church", v: (profile?.church_id ? currentChurchDisplay : '') || '—' },
    { l: isAm ? "ቅርንጫፍ" : "Branch", v: profile?.branch_name || '—' },
    { l: isAm ? "ድርሻ" : "Role", v: displayRole() },
    { l: isAm ? "የወረደ ዳታ" : "Offline Scripture Data", v: isAm ? "ተጭኗል (0 MB)" : "Bundled (0 MB)" },
    { l: isAm ? "ቋንቋ" : "Language", v: isAm ? "አማርኛ" : "English", action: () => setLocale(isAm ? "en" : "am") },
    { l: isAm ? "ስለ ብርሃን" : "About Birhan", v: appVersion },
  ];

  return (
    <SafeAreaView style={[styles.outer, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border, backgroundColor: c.bg }]}>
        <ThemedText type="title" colorType="text" isAmharic={isAm}>
          {t(locale, "more")}
        </ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Card */}
        <SectionBoundary name="Explore.Profile">
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderLit, flexDirection: "row", alignItems: "center", gap: 14 }]}>
            <View style={[styles.userAvatar, { backgroundColor: c.accentGlow, borderColor: c.accentDim }]}>
              <Icon name="user" size={22} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="subtitle" colorType="text" style={{ fontSize: 16, fontWeight: "600" }}>
                {profile?.display_name || (isAm ? "አባል" : "Member")}
              </ThemedText>
              <ThemedText type="small" colorType="textFaint" style={{ marginTop: 2 }}>
                {profile?.church_id
                  ? (currentChurchDisplay ? currentChurchDisplay + (profile.branch_name ? ` - ${profile.branch_name}` : "") : (isAm ? "ቤተ ክርስቲያን" : "Church"))
                  : (isAm ? "ቤተ ክርስቲያን አልተመረጠም" : "No church selected")}
              </ThemedText>
            </View>
            <View style={[styles.chip, { borderColor: c.accentDim, backgroundColor: c.accentGlow }]}>
              <Cross size={8} color={c.accent} />
              <ThemedText type="smallBold" colorType="accent" style={{ fontSize: 9.5, marginLeft: 4 }}>
                {displayRole()}
              </ThemedText>
            </View>
          </View>
        </SectionBoundary>

        {/* Standing email-verification reminder — see resendState above */}
        {!!profile?.email && !profile.email_verified && (
          <SectionBoundary name="Explore.VerificationReminder">
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, marginTop: 12 }]}>
              <VerificationStatus
                c={c}
                state={resendState === 'sending' ? 'sending' : resendState === 'sent' ? 'sent' : 'unverified'}
                title={t(locale, 'notVerifiedStatus')}
                note={resendState === 'sent' ? t(locale, 'resendSentConfirm') : profile.email}
                actionLabel={resendState === 'sending' ? undefined : t(locale, 'btnResendEmail')}
                onAction={resendState === 'sending' ? undefined : handleResendVerification}
              />
            </View>
          </SectionBoundary>
        )}

        {/* Section Header */}
        <View style={styles.sectionHeader}>
          <ThemedText type="smallBold" colorType="textFaint" style={styles.sectionTitle}>
            {isAm ? "ቅንብሮች" : "Settings"}
          </ThemedText>
        </View>

        {/* Settings Rows & Theme Toggle */}
        <SectionBoundary name="Explore.Settings">
          {settingsItems.map((i) => (
            <Pressable
              key={i.l}
              onPress={i.action}
              style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <ThemedText type="default" colorType="text" isAmharic={isAm} style={{ flex: 1, fontSize: 14.5, fontWeight: "500" }}>
                {i.l}
              </ThemedText>
              <ThemedText type="small" colorType="textFaint" style={{ marginRight: 6 }}>
                {i.v}
              </ThemedText>
              <Icon name="chev" size={15} color={c.textFaint} />
            </Pressable>
          ))}

          {/* Night Reading Toggle */}
          <Pressable
            onPress={toggleTheme}
            style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <ThemedText type="default" colorType="text" isAmharic={isAm} style={{ flex: 1, fontSize: 14.5, fontWeight: "500" }}>
              {isAm ? "የሌሊት ንባብ" : "Night reading"}
            </ThemedText>
            <View style={[styles.chip, {
              borderColor: isNight ? c.accentDim : c.border,
              backgroundColor: isNight ? c.accentGlow : "transparent"
            }]}>
              <ThemedText type="smallBold" style={{ color: isNight ? c.accent : c.textFaint }}>
                {isNight ? "ON" : "OFF"}
              </ThemedText>
            </View>
          </Pressable>

          {/* Updates — installed version, a check button that ignores the
              throttle, when it last really checked, and Wi-Fi-only. */}
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold" colorType="textFaint" style={styles.sectionTitle}>
              {isAm ? "ማሻሻያዎች" : "Updates"}
            </ThemedText>
          </View>
          <UpdateSection c={c} lang={locale} />

          {/* About / credits */}
          <Pressable
            onPress={() => router.push('/about' as Href)}
            style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <ThemedText type="default" colorType="text" isAmharic={isAm} style={{ flex: 1, fontSize: 14.5, fontWeight: "500" }}>
              {t(locale, 'about')}
            </ThemedText>
            <Icon name="chev" size={15} color={c.textFaint} />
          </Pressable>
        </SectionBoundary>

        {/* Super-admin: pastor verification queue (Stage 3) */}
        {isSuperAdmin && (
          <SectionBoundary name="Explore.Verification">
            <Pressable
              onPress={() => router.push('/verification' as Href)}
              style={[styles.row, { backgroundColor: c.surface, borderColor: c.accentDim, marginTop: 8 }]}
            >
              <ThemedText type="default" colorType="accent" isAmharic={isAm} style={{ flex: 1, fontSize: 14.5, fontWeight: "600" }}>
                {t(locale, "verificationQueue")}
              </ThemedText>
              <Icon name="chev" size={15} color={c.accent} />
            </Pressable>
          </SectionBoundary>
        )}

        {/* Inspirational Verse / Blessing Card */}
        <SectionBoundary name="Explore.Blessing" fallback={null}>
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, marginTop: 24, alignItems: "center", padding: 24 }]}>
            <Cross size={22} color={c.accent} />
            <ThemedText type="verse" colorType="text" isAmharic={true} style={{ fontSize: 15, marginTop: 12, lineHeight: 28, textAlign: "center" }}>
              ሁልጊዜ በጌታ ደስ ይበላችሁ
            </ThemedText>
            <ThemedText type="small" colorType="textFaint" style={{ marginTop: 6, textAlign: "center" }}>
              Rejoice in the Lord always — Philippians 4:4
            </ThemedText>
          </View>
        </SectionBoundary>

        {/* Delete Account — sits with the other account-level actions rather
            than among the display preferences above. */}
        <SectionBoundary name="Explore.DeleteAccount" fallback={null}>
          <DeleteAccountRow c={c} lang={locale} onPress={() => setShowDelete(true)} />
        </SectionBoundary>

        {/* Sign Out Button */}
        <SectionBoundary name="Explore.SignOut" fallback={null}>
          <TouchableOpacity
            onPress={signOut}
            style={[styles.signOutBtn, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <Icon name="gear" size={16} color={c.textFaint} />
            <ThemedText type="default" colorType="textFaint" style={{ marginLeft: 8, fontWeight: '600' }}>
              {isAm ? "ውጣ (Sign Out)" : "Sign Out"}
            </ThemedText>
          </TouchableOpacity>
        </SectionBoundary>

        {/* Brand Footer */}
        <View style={styles.brandFoot}>
          <Logo size={64} />
          <ThemedText type="small" colorType="textFaint" style={{ marginTop: 8 }}>
            Birhan · v0.4
          </ThemedText>
        </View>
      </ScrollView>

      <DeleteAccountModal
        visible={showDelete}
        c={c}
        lang={locale}
        onClose={() => setShowDelete(false)}
        // The token has already been revoked server-side by this point; this
        // clears the one on disk so the app returns to the login screen.
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 60,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    marginTop: 4,
  },
  userAvatar: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  sectionHeader: {
    marginTop: 22,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 14,
    marginTop: 24,
  },
  brandFoot: {
    alignItems: 'center',
    marginTop: 28,
  },
});
