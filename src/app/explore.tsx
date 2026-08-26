import React, { useState, useEffect } from "react";
import { StyleSheet, View, ScrollView, TouchableOpacity, Pressable, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useApp } from "@/theme/context";
import { t } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { Cross } from "@/components/cross";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { radius, space, fonts } from "@/theme/tokens";
import { SectionBoundary } from "@/components/section-boundary";
import { reportError } from "@/lib/errors";
import Constants from "expo-constants";
import { fetchApkManifest, downloadAndVerifyApk, cancelApkDownload, launchApkInstaller, ApkUpdateInfo } from "@/lib/apkUpdates";
import { getAllowMobileData, setAllowMobileData, isNetworkAllowedForDownload, initOtaUpdateListener } from "@/lib/otaUpdates";

export default function MoreScreen() {
  const { c, night: isNight, setNight, lang: locale, setLang: setLocale } = useApp();
  const { profile, signOut, isSuperAdmin } = useAuth();

  const isAm = locale === "am";
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
    supabase
      .from("churches")
      .select("name_am, name_en")
      .eq("id", profile.church_id)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          reportError(error, "Explore.loadChurch", "am", false);
        } else if (data) {
          setChurchNameAm(data.name_am);
          setChurchNameEn(data.name_en);
        }
      });
    return () => { active = false; };
  }, [profile?.church_id, profile?.church_name_am, profile?.church_name_en]);

  const displayRole = () => {
    if (profile?.role === "super_admin") return isAm ? "ሱፐር አስተዳዳሪ" : "Super Admin";
    if (profile?.role === "pastor") return isAm ? "እረኛ (Pastor)" : "Pastor";
    if (profile?.role === "admin") return isAm ? "አስተዳዳሪ (Admin)" : "Admin";
    if (profile?.role === "pending_pastor") return isAm ? "በመጠባበቅ ላይ" : "Pending pastor";
    return isAm ? "አባል" : "Member";
  };

  // Update States
  const [apkUpdate, setApkUpdate] = useState<ApkUpdateInfo | null>(null);
  const [allowMobileData, setAllowMobileDataState] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedFileUri, setDownloadedFileUri] = useState<string | null>(null);

  useEffect(() => {
    getAllowMobileData().then(setAllowMobileDataState);

    // Lazily check for APK manifest (once per 24 hours)
    fetchApkManifest().then((info) => {
      if (info?.isUpdateAvailable) {
        setApkUpdate(info);
      }
    });

    // Path A: Check OTA JS updates in background
    initOtaUpdateListener();
  }, []);

  const handleToggleMobileData = async () => {
    const nextVal = !allowMobileData;
    setAllowMobileDataState(nextVal);
    await setAllowMobileData(nextVal);
  };

  const handleStartApkDownload = async () => {
    if (!apkUpdate?.manifest) return;

    // Mobile data warning check
    const isAllowed = await isNetworkAllowedForDownload();
    if (!isAllowed) {
      Alert.alert(
        isAm ? 'ማሳሰቢያ' : 'Notice',
        t(locale, 'mobileDataWarning').replace('%1', (apkUpdate.manifest.sizeBytes / (1024 * 1024)).toFixed(1)),
        [
          { text: isAm ? 'ሰርዝ' : 'Cancel', style: 'cancel' },
          {
            text: isAm ? 'ቀጥል' : 'Continue',
            onPress: () => {
              setAllowMobileData(true);
              setAllowMobileDataState(true);
              executeDownload();
            },
          },
        ]
      );
      return;
    }

    executeDownload();
  };

  const executeDownload = async () => {
    if (!apkUpdate?.manifest) return;
    setDownloading(true);
    setDownloadProgress(0);

    try {
      const res = await downloadAndVerifyApk(apkUpdate.manifest, (progress) => {
        setDownloadProgress(progress);
      });
      setDownloadedFileUri(res.fileUri);
      setDownloading(false);
      
      // Prompt user to launch Android installer
      Alert.alert(
        isAm ? 'ማሻሻያው ተዘጋጅቷል' : 'Update Ready',
        t(locale, 'installPermissionGuide'),
        [
          {
            text: t(locale, 'btnInstallApk'),
            onPress: () => launchApkInstaller(res.fileUri),
          },
        ]
      );
    } catch (err: any) {
      setDownloading(false);
      setDownloadProgress(0);
      reportError(err, 'Explore.downloadApk', 'am', false);
      Alert.alert(
        isAm ? 'ስህተት' : 'Error',
        err?.message?.includes('SHA-256') ? t(locale, 'errHashMismatch') : t(locale, 'errGeneric')
      );
    }
  };

  const handleCancelDownload = async () => {
    await cancelApkDownload();
    setDownloading(false);
    setDownloadProgress(0);
  };

  const handleInstallClick = () => {
    if (downloadedFileUri) {
      launchApkInstaller(downloadedFileUri);
    } else {
      handleStartApkDownload();
    }
  };

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

        {/* Path B: Native APK Update Card (if update available) */}
        {apkUpdate?.isUpdateAvailable && (
          <SectionBoundary name="Explore.UpdateCard">
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.accent, marginTop: 12, borderWidth: 1 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Cross size={14} color={c.accent} />
                <ThemedText type="subtitle" colorType="accent" style={{ marginLeft: 8, fontWeight: '700' }}>
                  {apkUpdate.isMandatory ? t(locale, 'updateRequired') : t(locale, 'updateAvailable')}
                </ThemedText>
              </View>

              <ThemedText type="small" colorType="text" style={{ marginTop: 4 }}>
                {t(locale, 'updateVersion')}: {apkUpdate.manifest.versionName} (v{apkUpdate.manifest.versionCode}) • {(apkUpdate.manifest.sizeBytes / (1024 * 1024)).toFixed(1)} MB
              </ThemedText>

              <ThemedText type="small" colorType="textFaint" style={{ marginTop: 6, fontStyle: 'italic' }}>
                {isAm ? apkUpdate.manifest.notes_am : apkUpdate.manifest.notes_en}
              </ThemedText>

              {downloading ? (
                <View style={{ marginTop: 12 }}>
                  <ThemedText type="smallBold" colorType="accent">
                    {t(locale, 'btnDownloading').replace('%1', downloadProgress.toString())}
                  </ThemedText>
                  <View style={{ height: 6, backgroundColor: c.border, borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
                    <View style={{ width: `${downloadProgress}%`, height: '100%', backgroundColor: c.accent }} />
                  </View>
                  <Pressable
                    onPress={handleCancelDownload}
                    style={{ marginTop: 10, alignSelf: 'flex-start' }}
                  >
                    <ThemedText type="smallBold" style={{ color: c.danger }}>
                      {t(locale, 'btnCancelDownload')}
                    </ThemedText>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={handleInstallClick}
                  style={{
                    backgroundColor: c.accent,
                    paddingVertical: 10,
                    paddingHorizontal: 16,
                    borderRadius: 6,
                    marginTop: 12,
                    alignItems: 'center',
                  }}
                >
                  <ThemedText type="smallBold" style={{ color: c.bg, fontWeight: '700' }}>
                    {downloadedFileUri ? t(locale, 'btnInstallApk') : t(locale, 'btnDownloadUpdate')}
                  </ThemedText>
                </Pressable>
              )}
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

          {/* Allow Mobile Data Downloads Toggle */}
          <Pressable
            onPress={handleToggleMobileData}
            style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <ThemedText type="default" colorType="text" isAmharic={isAm} style={{ flex: 1, fontSize: 14.5, fontWeight: "500" }}>
              {t(locale, 'allowMobileDataUpdates')}
            </ThemedText>
            <View style={[styles.chip, {
              borderColor: allowMobileData ? c.accentDim : c.border,
              backgroundColor: allowMobileData ? c.accentGlow : "transparent"
            }]}>
              <ThemedText type="smallBold" style={{ color: allowMobileData ? c.accent : c.textFaint }}>
                {allowMobileData ? "ON" : "OFF"}
              </ThemedText>
            </View>
          </Pressable>

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
