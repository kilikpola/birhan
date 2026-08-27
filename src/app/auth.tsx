import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  Pressable,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as DocumentPicker from 'expo-document-picker';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApp } from '../theme/context';
import { radius, type Palette } from '../theme/tokens';
import { Icon } from '../components/icon';
import { Cross } from '../components/cross';
import { Logo } from '../components/logo';
import { t, Lang } from '../i18n';
import { reportError } from '../lib/errors';
import {
  getAllRolesForDenomination,
  isClergyRole,
  RoleDefinition,
} from '../constants/roles';
import { PasswordField } from '../components/auth/password-field';
import { PasswordRequirements } from '../components/auth/password-requirements';
import { ConfirmPasswordStatus } from '../components/auth/confirm-password-status';
import { StepIndicator } from '../components/auth/step-indicator';
import { TelegramConnectStep } from '../components/auth/telegram-connect-step';
import {
  startTelegramRegistration,
  type PendingRegistration,
  type TelegramStatus,
} from '../lib/telegramSignup';

/** Same validation the backend applies server-side (backend/src/utils/phone.ts
 * uses the same library) — a phone that fails here would fail there too. */
function isValidPhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '+251') return false;
  const withCode = trimmed.startsWith('0') ? `+251${trimmed.slice(1)}` : trimmed;
  const parsed = parsePhoneNumberFromString(withCode);
  return !!parsed?.isValid();
}

// Sentinel church id for "my church isn't listed" → submits a review request.
const OTHER_CHURCH = '__other__';

/**
 * Auth screen — plain React Native + the app's own theme tokens (no Tamagui).
 * Features:
 * - 52px input & dropdown height for comfortable touch targets and Ge'ez text display.
 * - 3-step wizard for registration (Step 1: Account Info, Step 2: Church Info,
 *   Step 3: Connect Telegram). No account exists until step 3 is confirmed
 *   server-side — see src/lib/telegramSignup.ts.
 * - Full Step 1 validation gate before advancing to Step 2.
 * - Step 2 "Back" button preserves all entered Step 1 data.
 * - Zero auth user creation before final submit from Step 3.
 * - Intact EECMY Qes vs Pastor clergy KYC verification routing.
 */
export default function Auth() {
  const { signIn, signUp, refreshProfile } = useAuth();
  const { c, lang, setLang } = useApp();
  const [mode, setMode] = useState<'in' | 'up' | 'pastor'>('in');
  const [signupStep, setSignupStep] = useState<1 | 2 | 3>(1);

  // Step 3 — the Telegram handshake. `pending` is the registration the server
  // is holding; `telegramStatus` is the server's answer about it. Neither is
  // ever set from anything this screen decides on its own.
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [startingTelegram, setStartingTelegram] = useState(false);

  // Account Section States (Step 1)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+251 ');

  // Church Section States (Step 2)
  const [churches, setChurches] = useState<
    { id: string; name_am: string; name_en: string; denomination?: string | null }[]
  >([]);
  const [churchesLoading, setChurchesLoading] = useState(false);
  const [churchId, setChurchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<
    { id: string; name_am: string; name_en: string }[]
  >([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [churchRole, setChurchRole] = useState<string>('member');
  const [prefLang, setPrefLang] = useState<Lang>(lang);
  const [isMotherBranch, setIsMotherBranch] = useState(false);
  const [pastorBranchName, setPastorBranchName] = useState('');

  // "Other" church request (church not in the list yet)
  const [otherChurchName, setOtherChurchName] = useState('');
  const [otherChurchCity, setOtherChurchCity] = useState('');

  // File upload state for pastor KYC verification
  const [docFile, setDocFile] = useState<any>(null);

  // Form state & inline errors
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Bottom-sheet open states
  const [showChurchSheet, setShowChurchSheet] = useState(false);
  const [showBranchSheet, setShowBranchSheet] = useState(false);
  const [showRoleSheet, setShowRoleSheet] = useState(false);
  const [showClergyNoticeSheet, setShowClergyNoticeSheet] = useState(false);
  const [showSuccessScreen, setShowSuccessScreen] = useState(false);

  const isAm = lang === 'am';

  // Selected object references
  const selectedChurch = churches.find((ch) => ch.id === churchId);
  const selectedBranch = branches.find((b) => b.id === branchId);
  const isOther = churchId === OTHER_CHURCH;

  // Available roles based on selected church's denomination
  const availableRoles = getAllRolesForDenomination(selectedChurch?.denomination);
  const selectedRoleDef = availableRoles.find((r) => r.value === churchRole);

  // Fetch churches when in sign-up or pastor mode. Public route — no token
  // exists yet at this point in the flow.
  useEffect(() => {
    if (mode === 'up' || mode === 'pastor') {
      setChurchesLoading(true);
      apiFetch<{ churches: any[] }>('/api/v1/churches', { auth: false })
        .then((res) => {
          const sorted = [...res.churches].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
          setChurches(
            sorted.map((ch) => ({
              id: ch.id,
              name_am: ch.nameAm,
              name_en: ch.nameEn,
              denomination: ch.denomination,
            })),
          );
        })
        .catch((err) => reportError(err, 'Auth.loadChurches', lang, false))
        .finally(() => setChurchesLoading(false));
    }
  }, [mode, lang]);

  // Fetch branches dynamically based on selected church ID. Also public.
  useEffect(() => {
    if (churchId && churchId !== OTHER_CHURCH) {
      setLoadingBranches(true);
      apiFetch<{ branches: any[] }>(`/api/v1/churches/${churchId}/branches`, { auth: false })
        .then((res) => {
          setBranches(res.branches.map((b) => ({ id: b.id, name_am: b.nameAm, name_en: b.nameEn })));
        })
        .catch((err) => {
          reportError(err, 'Auth.loadBranches', lang, false);
          setBranches([]);
        })
        .finally(() => setLoadingBranches(false));
    } else {
      setBranches([]);
      setBranchId(null);
    }
  }, [churchId]);

  // Per-field inline validation
  // Only one of email/phone is required — never both. `contact` is a
  // pseudo-field: it doesn't belong to a single input, so its error renders
  // under the "how can we reach you" section instead of under either field.
  const hasEmail = !!email.trim();
  const hasPhone = !!phone.trim() && phone.trim() !== '+251';

  const validateField = useCallback(
    (field: string, value: any) => {
      let errorMsg = '';
      if (field === 'name') {
        if (!value || !String(value).trim()) errorMsg = t(lang, 'errNameRequired');
      } else if (field === 'email') {
        const trimmed = String(value).trim();
        if (trimmed) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(trimmed)) errorMsg = t(lang, 'errEmailInvalid');
        }
      } else if (field === 'phone') {
        const trimmed = String(value).trim();
        if (trimmed && trimmed !== '+251' && !isValidPhone(trimmed)) {
          errorMsg = t(lang, 'errInvalidPhone');
        }
      } else if (field === 'contact') {
        if (!hasEmail && !hasPhone) errorMsg = t(lang, 'errContactRequired');
      } else if (field === 'password') {
        if (!value || String(value).length < 8) errorMsg = t(lang, 'errPasswordShort');
      } else if (field === 'confirmPassword') {
        if (String(value) !== password) errorMsg = t(lang, 'pwdNotMatchYet');
      } else if (field === 'churchId') {
        if (!value) errorMsg = t(lang, 'errChurchRequired');
      } else if (field === 'branchId') {
        if (branches.length > 0 && !value) errorMsg = t(lang, 'errBranchRequired');
      } else if (field === 'churchRole') {
        if (!value) errorMsg = t(lang, 'errRoleRequired');
      }

      setFieldErrors((prev) => ({ ...prev, [field]: errorMsg }));
      return !errorMsg;
    },
    [lang, branches.length, hasEmail, hasPhone, password]
  );

  const handleBlur = (field: string, value: any) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    validateField(field, value);
  };

  // Validate Step 1 before advancing to Step 2
  const validateStep1 = () => {
    setTouched((prev) => ({
      ...prev,
      name: true,
      email: true,
      phone: true,
      contact: true,
      password: true,
      confirmPassword: true,
    }));

    const validName = validateField('name', name);
    const validEmail = validateField('email', email);
    const validPhone = validateField('phone', phone);
    const validContact = validateField('contact', null);
    const validPass = validateField('password', password);
    const validConfirm = validateField('confirmPassword', confirmPassword);

    return validName && validEmail && validPhone && validContact && validPass && validConfirm;
  };

  const handleNextStep1 = () => {
    if (validateStep1()) {
      setSignupStep(2);
    }
  };

  // Pick Document for Pastor KYC
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setDocFile(result.assets[0]);
      }
    } catch (ex) {
      reportError(ex, 'Auth.pickDocument', lang);
    }
  };

  // Select Role Handler — Intercept Clergy Roles
  const handleSelectRole = (roleDef: RoleDefinition) => {
    setChurchRole(roleDef.value);
    setShowRoleSheet(false);
    validateField('churchRole', roleDef.value);

    if (roleDef.isClergy || isClergyRole(roleDef.value)) {
      setShowClergyNoticeSheet(true);
    }
  };

  const handleProceedToClergyKYC = () => {
    setShowClergyNoticeSheet(false);
    setMode('pastor');
  };

  // Form Submit Handler
  const submit = async () => {
    setErr(null);

    // Pastor Registration / Verification Flow
    //
    // NOT MIGRATED — still calls the dead Supabase project below. Left in
    // place rather than deleted or half-rewritten, because the real backend
    // doesn't support this flow as a single submit:
    //   1. POST /api/v1/pastor-verification/upload-url and the submit route
    //      are both gated behind requireVerifiedEmail — a pastor applicant
    //      has to confirm their email (an out-of-band step, via the emailed
    //      link) before they can even request an S3 upload URL, let alone
    //      submit. This screen creates the account and submits the doc in one
    //      action; the backend now requires an interstitial "check your
    //      email" step in between that doesn't exist in this UI yet.
    //   2. Doc upload is a 3-step dance against the new backend (POST
    //      upload-url → PUT the file to the returned S3 URL → POST
    //      /api/v1/pastor-verification {docPath, branchName}), not a single
    //      supabase.storage.upload() call.
    // Rewriting this needs a product decision on the new flow shape, not a
    // mechanical call-site swap.
    if (mode === 'pastor') {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        setErr(
          isAm
            ? 'ኢንተርኔት የለም — እባክዎ ግንኙነትዎን ያረጋግጡ'
            : 'No connection — please check your internet connection.'
        );
        return;
      }

      if (!name.trim() || !email.trim() || !password.trim() || !churchId || !pastorBranchName.trim() || !docFile) {
        setErr(
          isAm
            ? 'እባክዎ ሁሉንም መስኮች (ሙሉ ስም፣ ኢሜይል፣ የይለፍ ቃል፣ ቤተ ክርስቲያን፣ የቅርንጫፍ ስም እና ሰነድ) ይሙሉ'
            : 'Please fill all required fields (Full Name, Email, Password, Church, Branch Name, and Document).'
        );
        return;
      }

      // Fails honestly rather than being built around — see the NOT MIGRATED
      // note above and docs/KNOWN_GAPS.md.
      setErr(
        isAm
          ? 'የፓስተር ምዝገባ አሁን ላይ አይገኝም። እባክዎ ቆይተው ይሞክሩ።'
          : 'Pastor registration is not available yet. Please try again later.'
      );
      return;
    }

    // Standard Sign In.
    // (Pastors reach the verification form through Create account → clergy role,
    //  not a hidden credential. No backdoor.)
    if (mode === 'in') {
      setBusy(true);
      const res = await signIn(email.trim(), password);
      setBusy(false);
      if (res.error) {
        setErr(
          res.code === 'UNAUTHENTICATED'
            ? t(lang, 'errWrongCredentials')
            : res.code === 'OFFLINE'
              ? t(lang, 'errCouldNotReachServer')
              : res.error,
        );
      }
      return;
    }

    // "Other" church → register with no church yet + file a review request.
    //
    // NOT MIGRATED — still calls the dead Supabase project below. The real
    // backend has admin.ts endpoints to LIST/approve/reject church_requests
    // (GET /admin/church-requests, POST .../approve, .../reject) but no route
    // for a regular signed-out user to CREATE one — nothing in backend/src
    // inserts into churchRequests except the (admin-only) approval flow
    // itself. This isn't a call-site mismatch to paper over; the endpoint
    // this screen needs doesn't exist yet.
    if (isOther) {
      setTouched((prev) => ({ ...prev, otherChurch: true, churchRole: true }));
      const nameOk = otherChurchName.trim().length > 0;
      setFieldErrors((prev) => ({
        ...prev,
        otherChurch: nameOk ? '' : isAm ? 'የቤተ ክርስቲያን ስም ያስፈልጋል' : 'Church name is required',
      }));
      const validRole = validateField('churchRole', churchRole);
      if (!nameOk || !validRole) return;

      // Fails honestly rather than being built around — see the NOT MIGRATED
      // note above and docs/KNOWN_GAPS.md.
      setErr(
        isAm
          ? 'ቤተ ክርስቲያንዎ ገና አልተጨመረም? ይህ ባህሪ አሁን ላይ አይገኝም። እባክዎ ቆይተው ይሞክሩ።'
          : "Registering with a church that isn't listed yet isn't available. Please try again later."
      );
      return;
    }

    // Step 3 final submission. Everything the account is made from was handed
    // over at the start of step 3 and has been sitting on the server since; all
    // this carries is the reference. The backend re-checks the Telegram half
    // itself — it does not take our word for it, and it should not.
    if (!pending) return;

    setBusy(true);
    const res = await signUp({ pendingRegistrationId: pending.pendingId });
    setBusy(false);

    if (res.error) {
      // FORBIDDEN here means the server disagrees that Telegram was confirmed —
      // the one case where the screen must not just show a generic failure,
      // because the fix is "go back and finish in Telegram".
      if (res.code === 'FORBIDDEN') {
        setTelegramStatus({ status: 'waiting', expiresAt: pending.expiresAt });
        setErr(t(lang, 'telegramConnectToContinue'));
        return;
      }
      if (res.code === 'REGISTRATION_EXPIRED') {
        setTelegramStatus({ status: 'expired' });
        setErr(t(lang, 'telegramSessionExpired'));
        return;
      }
      setErr(
        res.code === 'CONFLICT'
          ? hasEmail && !hasPhone
            ? t(lang, 'errAccountExists')
            : hasPhone && !hasEmail
              ? t(lang, 'errPhoneInUse')
              : res.error
          : res.code === 'OFFLINE'
            ? t(lang, 'errCouldNotReachServer')
            : res.code === 'VALIDATION_ERROR'
              ? res.error
              : t(lang, 'errCouldNotCreateAccount'),
      );
    }
    // No navigation on success — session is now set, and _layout.tsx's Gate
    // swaps this whole screen out on its own (for an email signup, into
    // EmailVerificationScreen first; this component simply unmounts either way).
  };

  /** Step 2's own gate, split out so both "Next" and a retry can use it. */
  const validateStep2 = () => {
    setTouched((prev) => ({ ...prev, churchId: true, branchId: true, churchRole: true }));
    const validChurch = validateField('churchId', churchId);
    const validBranch = validateField('branchId', branchId);
    const validRole = validateField('churchRole', churchRole);
    return validChurch && validBranch && validRole;
  };

  /**
   * Hands the details to the server and gets a deep link back.
   *
   * This is the only moment the password leaves the device, and it still does
   * not create an account — the server hashes it and holds it against a pending
   * registration that grants nothing until Telegram confirms.
   */
  const beginTelegram = useCallback(async () => {
    setErr(null);
    setStartingTelegram(true);
    setTelegramStatus(null);
    setPending(null);

    const res = await startTelegramRegistration({
      // Backend validates email with z.string().email() when present — an
      // empty string (the phone-only case) would fail that as a malformed
      // address rather than being treated as "not provided".
      email: hasEmail ? email.trim() : undefined,
      phone: hasPhone ? phone.trim() : undefined,
      password,
      displayName: name.trim(),
      churchId: churchId!,
      branchId,
      churchRole,
      language: prefLang,
    });
    setStartingTelegram(false);

    if (!res.ok) {
      setErr(
        res.code === 'CONFLICT'
          ? hasEmail && !hasPhone
            ? t(lang, 'errAccountExists')
            : hasPhone && !hasEmail
              ? t(lang, 'errPhoneInUse')
              : res.message
          : res.code === 'OFFLINE'
            ? t(lang, 'errCouldNotReachServer')
            : res.code === 'TELEGRAM_DISABLED'
              ? t(lang, 'telegramUnavailable')
              : res.code === 'VALIDATION_ERROR'
                ? res.message
                : t(lang, 'errCouldNotCreateAccount'),
      );
      return false;
    }

    setPending(res.pending);
    return true;
  }, [hasEmail, hasPhone, email, phone, password, name, churchId, branchId, churchRole, prefLang, lang]);

  /** Step 2 → step 3. Advances only once the server has issued a link. */
  const handleNextStep2 = async () => {
    if (!validateStep2()) return;
    // "Other church" has no backend route yet (see the NOT MIGRATED note in
    // submit); leave that path exactly where it was.
    if (isOther) {
      await submit();
      return;
    }
    if (await beginTelegram()) setSignupStep(3);
  };

  // Render Success Screen for Pastor Review
  if (showSuccessScreen) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: c.bg }]}>
        <View style={s.successWrap}>
          <Logo size={72} style={{ marginBottom: 12 }} />
          <View style={[s.successCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[s.successTitle, { color: c.text }]}>{t(lang, 'pastorUnderReview')}</Text>
            <Text style={[s.successNote, { color: c.textSoft }]}>{t(lang, 'pastorReviewNote')}</Text>
          </View>
          <PrimaryButton c={c} onPress={() => setShowSuccessScreen(false)} style={{ marginTop: 20 }}>
            {isAm ? 'ጨርስ' : 'Done'}
          </PrimaryButton>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={s.header}>
          <Logo size={96} rounded={radius.lg} style={{ marginBottom: 10 }} />
          <Text style={[s.appName, { color: c.text }]}>{t(lang, 'appName')}</Text>
          <Text style={[s.brandSub, { color: c.textFaint }]}>Birhan</Text>
        </View>

        {/* Mode Selector Segment */}
        {mode !== 'pastor' ? (
          <View style={[s.segment, { borderColor: c.border, backgroundColor: c.surface }]}>
            <Pressable
              style={[s.segBtn, { backgroundColor: mode === 'in' ? c.text : 'transparent' }]}
              onPress={() => {
                setMode('in');
                setSignupStep(1);
              }}
            >
              <Text style={[s.segTxt, { color: mode === 'in' ? c.bg : c.textSoft }]}>
                {isAm ? 'ግቡ' : 'Sign in'}
              </Text>
            </Pressable>
            <Pressable
              style={[s.segBtn, { backgroundColor: mode === 'up' ? c.text : 'transparent' }]}
              onPress={() => setMode('up')}
            >
              <Text style={[s.segTxt, { color: mode === 'up' ? c.bg : c.textSoft }]}>
                {isAm ? 'አዲስ መለያ ይክፈቱ' : 'Create account'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={[s.pastorHead, { borderBottomColor: c.border }]}>
            <Text style={[s.pastorHeadTxt, { color: c.text }]}>{t(lang, 'pastorForm')}</Text>
          </View>
        )}

        {/* ===================== SIGN IN FORM ===================== */}
        {mode === 'in' && (
          <View style={{ gap: 16 }}>
            <Field
              c={c}
              label={`${t(lang, 'emailLabel')} *`}
              placeholder="name@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Field
              c={c}
              label={`${t(lang, 'passwordLabel')} *`}
              placeholder="••••••••"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>
        )}

        {/* ===================== 3-STEP SIGNUP WIZARD ===================== */}
        {mode === 'up' && (
          <View style={{ gap: 16 }}>
            {/* Step Progress Indicator */}
            <View style={[s.card, { borderColor: c.border, backgroundColor: c.surface }]}>
              <StepIndicator
                c={c}
                step={signupStep}
                labels={[
                  t(lang, 'stepAccount'),
                  t(lang, 'stepChurch'),
                  t(lang, 'stepTelegram'),
                ]}
              />
            </View>

            {/* STEP 1: ACCOUNT INFO */}
            {signupStep === 1 && (
              <View style={[s.card, { borderColor: c.border, backgroundColor: c.surface, gap: 16 }]}>
                <View>
                  <Field
                    c={c}
                    label={`${t(lang, 'fullNameLabel')} *`}
                    placeholder={isAm ? 'ሙሉ ስምዎን ያስገቡ' : 'Enter your full name'}
                    value={name}
                    onChangeText={setName}
                    onBlur={() => handleBlur('name', name)}
                    error={touched.name ? fieldErrors.name : undefined}
                  />
                  {!(touched.name && fieldErrors.name) && (
                    <Text style={[s.helperTxt, { color: c.textFaint }]}>
                      {t(lang, 'nameHelperText')}
                    </Text>
                  )}
                </View>

                {/* Contact — at least one of email/phone, never both required */}
                <View>
                  <Text style={[s.sectionLabel, { color: c.text }]}>{t(lang, 'contactMethodTitle')}</Text>
                  <Text style={[s.sectionHint, { color: c.textFaint }]}>{t(lang, 'contactMethodHint')}</Text>

                  <View style={{ marginTop: 12 }}>
                    <Field
                      c={c}
                      label={t(lang, 'emailLabel')}
                      placeholder="name@example.com"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      value={email}
                      onChangeText={setEmail}
                      onBlur={() => {
                        handleBlur('email', email);
                        validateField('contact', null);
                      }}
                      error={touched.email ? fieldErrors.email : undefined}
                    />
                    {touched.email && !fieldErrors.email && hasEmail && (
                      <Text style={[s.okTxt, { color: c.success }]}>✓ {t(lang, 'lookingGood')}</Text>
                    )}
                  </View>

                  <View style={s.orRow}>
                    <View style={[s.orLine, { backgroundColor: c.border }]} />
                    <Text style={[s.orTxt, { color: c.textFaint }]}>{t(lang, 'orLabel')}</Text>
                    <View style={[s.orLine, { backgroundColor: c.border }]} />
                  </View>

                  <View>
                    <Field
                      c={c}
                      label={t(lang, 'phoneLabel')}
                      placeholder="+251 911 000 000"
                      keyboardType="phone-pad"
                      value={phone}
                      onChangeText={setPhone}
                      onBlur={() => {
                        handleBlur('phone', phone);
                        validateField('contact', null);
                      }}
                      error={touched.phone ? fieldErrors.phone : undefined}
                    />
                    {touched.phone && !fieldErrors.phone && hasPhone && (
                      <Text style={[s.okTxt, { color: c.success }]}>✓ {t(lang, 'lookingGood')}</Text>
                    )}
                  </View>

                  {touched.contact && fieldErrors.contact ? (
                    <Text style={[s.fieldErr, { color: c.danger }]}>{fieldErrors.contact}</Text>
                  ) : null}
                </View>

                <View>
                  <PasswordField
                    c={c}
                    lang={lang}
                    label={`${t(lang, 'passwordLabel')} *`}
                    placeholder={isAm ? 'ቢያንስ 8 ፊደላት/ቁጥሮች' : 'At least 8 characters'}
                    value={password}
                    onChangeText={setPassword}
                    onBlur={() => handleBlur('password', password)}
                    error={touched.password ? fieldErrors.password : undefined}
                  />
                  <PasswordRequirements c={c} lang={lang} password={password} />
                </View>

                <View>
                  <PasswordField
                    c={c}
                    lang={lang}
                    label={`${t(lang, 'confirmPasswordLabel')} *`}
                    placeholder={isAm ? 'የይለፍ ቃል ይድገሙ' : 'Re-enter your password'}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    onBlur={() => handleBlur('confirmPassword', confirmPassword)}
                    error={touched.confirmPassword ? fieldErrors.confirmPassword : undefined}
                  />
                  {!(touched.confirmPassword && fieldErrors.confirmPassword) && (
                    <ConfirmPasswordStatus c={c} lang={lang} password={password} confirmPassword={confirmPassword} />
                  )}
                </View>

                <PrimaryButton c={c} onPress={handleNextStep1}>
                  {`${t(lang, 'btnContinue')} →`}
                </PrimaryButton>
              </View>
            )}

            {/* STEP 2: CHURCH INFO */}
            {signupStep === 2 && (
              <View style={[s.card, { borderColor: c.border, backgroundColor: c.surface, gap: 16 }]}>
                {/* Church Selector */}
                <View>
                  <Text style={[s.label, { color: c.text }]}>{`${t(lang, 'churchLabel')} *`}</Text>
                  {churchesLoading ? (
                    <View style={[s.dropdown, { backgroundColor: c.bg, borderColor: c.border }]}>
                      <ActivityIndicator size="small" color={c.accent} style={{ marginRight: 10 }} />
                      <Text style={[s.ddPlaceholder, { color: c.textFaint }]}>{t(lang, 'loadingChurches')}</Text>
                    </View>
                  ) : (
                  <Pressable onPress={() => setShowChurchSheet(true)}>
                    <View
                      style={[
                        s.dropdown,
                        { backgroundColor: c.bg, borderColor: touched.churchId && fieldErrors.churchId ? c.danger : c.border },
                      ]}
                    >
                      <View style={{ flex: 1, justifyContent: 'center' }}>
                        {isOther ? (
                          <Text style={[s.ddTitle, { color: c.text }]}>{isAm ? 'ሌላ (ዝርዝሩ ውስጥ የለም)' : 'Other (not listed)'}</Text>
                        ) : selectedChurch ? (
                          <>
                            <Text style={[s.ddTitle, { color: c.text }]} numberOfLines={1}>{selectedChurch.name_am}</Text>
                            <Text style={[s.ddSub, { color: c.textSoft }]} numberOfLines={1}>
                              {selectedChurch.name_en}
                              {selectedChurch.denomination ? ` (${selectedChurch.denomination})` : ''}
                            </Text>
                          </>
                        ) : (
                          <Text style={[s.ddPlaceholder, { color: c.textFaint }]}>{t(lang, 'selectChurch')}</Text>
                        )}
                      </View>
                      <Icon name="chevron" size={14} color={c.textFaint} />
                    </View>
                  </Pressable>
                  )}
                  {touched.churchId && fieldErrors.churchId ? (
                    <Text style={[s.fieldErr, { color: c.danger }]}>{fieldErrors.churchId}</Text>
                  ) : null}
                </View>

                {/* "Other" church request fields */}
                {isOther && (
                  <>
                    <Field
                      c={c}
                      label={isAm ? "የቤተ ክርስቲያንዎ ስም *" : "Your church's name *"}
                      placeholder={isAm ? 'ሙሉ ስም' : 'Full church name'}
                      value={otherChurchName}
                      onChangeText={setOtherChurchName}
                      error={touched.otherChurch ? fieldErrors.otherChurch : undefined}
                    />
                    <Field
                      c={c}
                      label={isAm ? 'ከተማ' : 'City'}
                      placeholder={isAm ? 'ለምሳሌ፦ አዲስ አበባ' : 'e.g. Addis Ababa'}
                      value={otherChurchCity}
                      onChangeText={setOtherChurchCity}
                    />
                  </>
                )}

                {/* Branch Selector */}
                {!isOther && (
                <View>
                  <Text style={[s.label, { color: c.text }]}>
                    {t(lang, 'branchLabel')}{branches.length > 0 ? ' *' : ''}
                  </Text>
                  {loadingBranches ? (
                    <ActivityIndicator size="small" color={c.accent} style={{ marginVertical: 8 }} />
                  ) : (
                    <Pressable
                      disabled={branches.length === 0}
                      onPress={() => {
                        if (branches.length > 0) setShowBranchSheet(true);
                      }}
                    >
                      <View
                        style={[
                          s.dropdown,
                          {
                            backgroundColor: c.bg,
                            borderColor: touched.branchId && fieldErrors.branchId ? c.danger : c.border,
                            opacity: branches.length === 0 ? 0.6 : 1,
                          },
                        ]}
                      >
                        <View style={{ flex: 1, justifyContent: 'center' }}>
                          {selectedBranch ? (
                            <>
                              <Text style={[s.ddTitle, { color: c.text }]} numberOfLines={1}>{selectedBranch.name_am}</Text>
                              <Text style={[s.ddSub, { color: c.textSoft }]} numberOfLines={1}>{selectedBranch.name_en}</Text>
                            </>
                          ) : (
                            <Text style={[s.ddPlaceholder, { color: c.textFaint }]}>
                              {branches.length > 0 ? t(lang, 'selectBranch') : t(lang, 'noBranches')}
                            </Text>
                          )}
                        </View>
                        {branches.length > 0 && <Icon name="chevron" size={14} color={c.textFaint} />}
                      </View>
                    </Pressable>
                  )}
                  {touched.branchId && fieldErrors.branchId ? (
                    <Text style={[s.fieldErr, { color: c.danger }]}>{fieldErrors.branchId}</Text>
                  ) : null}
                </View>
                )}

                {/* Denomination-Aware Role Selector */}
                <View>
                  <Text style={[s.label, { color: c.text }]}>{`${t(lang, 'roleLabel')} *`}</Text>
                  <Pressable onPress={() => setShowRoleSheet(true)}>
                    <View
                      style={[
                        s.dropdown,
                        { backgroundColor: c.bg, borderColor: touched.churchRole && fieldErrors.churchRole ? c.danger : c.border },
                      ]}
                    >
                      <View style={{ flex: 1, justifyContent: 'center' }}>
                        {selectedRoleDef ? (
                          <>
                            <Text style={[s.ddTitle, { color: c.text }]} numberOfLines={1}>{selectedRoleDef.am}</Text>
                            <Text style={[s.ddSub, { color: c.textSoft }]} numberOfLines={1}>{selectedRoleDef.en}</Text>
                          </>
                        ) : (
                          <Text style={[s.ddPlaceholder, { color: c.textFaint }]}>{t(lang, 'selectRole')}</Text>
                        )}
                      </View>
                      <Icon name="chevron" size={14} color={c.textFaint} />
                    </View>
                  </Pressable>
                  {touched.churchRole && fieldErrors.churchRole ? (
                    <Text style={[s.fieldErr, { color: c.danger }]}>{fieldErrors.churchRole}</Text>
                  ) : null}
                </View>

                {/* Preferred Language Toggle */}
                <View>
                  <Text style={[s.label, { color: c.text }]}>{t(lang, 'preferredLangLabel')}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <ToggleButton
                      c={c}
                      active={prefLang === 'am'}
                      onPress={() => {
                        setPrefLang('am');
                        setLang('am');
                      }}
                    >
                      አማርኛ
                    </ToggleButton>
                    <ToggleButton
                      c={c}
                      active={prefLang === 'en'}
                      onPress={() => {
                        setPrefLang('en');
                        setLang('en');
                      }}
                    >
                      English
                    </ToggleButton>
                  </View>
                </View>

                {/* Step 2 Action Buttons */}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Pressable
                    style={[s.btn, s.btnOutline, { flex: 1, backgroundColor: c.surface, borderColor: c.border }]}
                    onPress={() => setSignupStep(1)}
                  >
                    <Text style={[s.btnTxt, { color: c.text }]}>{`← ${t(lang, 'btnBack')}`}</Text>
                  </Pressable>
                  <PrimaryButton
                    c={c}
                    onPress={handleNextStep2}
                    disabled={busy || startingTelegram}
                    busy={busy || startingTelegram}
                    busyLabel={t(lang, 'creatingAccount')}
                    style={{ flex: 2 }}
                  >
                    {t(lang, 'btnContinue')}
                  </PrimaryButton>
                </View>
              </View>
            )}

            {/* STEP 3: CONNECT TELEGRAM */}
            {signupStep === 3 && (
              <View style={[s.card, { borderColor: c.border, backgroundColor: c.surface, gap: 16 }]}>
                <TelegramConnectStep
                  c={c}
                  lang={lang}
                  pending={pending}
                  status={telegramStatus}
                  onStatusChange={setTelegramStatus}
                  onStartAgain={beginTelegram}
                />

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Pressable
                    style={[s.btn, s.btnOutline, { flex: 1, backgroundColor: c.surface, borderColor: c.border }]}
                    onPress={() => setSignupStep(2)}
                  >
                    <Text style={[s.btnTxt, { color: c.text }]}>{`← ${t(lang, 'btnBack')}`}</Text>
                  </Pressable>
                  {/* Disabled until the *server* says connected. The label says
                      why rather than leaving a dead button unexplained. */}
                  <PrimaryButton
                    c={c}
                    onPress={submit}
                    disabled={busy || telegramStatus?.status !== 'connected'}
                    busy={busy}
                    busyLabel={t(lang, 'creatingAccount')}
                    style={{ flex: 2 }}
                  >
                    {telegramStatus?.status === 'connected'
                      ? t(lang, 'createMyAccount')
                      : t(lang, 'telegramConnectToContinue')}
                  </PrimaryButton>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ===================== PASTOR KYC FORM ===================== */}
        {mode === 'pastor' && (
          <View style={{ gap: 16 }}>
            <Field c={c} label={`${t(lang, 'fullNameLabel')} *`} placeholder="Your name" value={name} onChangeText={setName} />
            <Field
              c={c}
              label={`${t(lang, 'emailLabel')} *`}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Field c={c} label={`${t(lang, 'passwordLabel')} *`} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />

            {/* Church Selector */}
            <View>
              <Text style={[s.label, { color: c.text }]}>{`${t(lang, 'churchLabel')} *`}</Text>
              <Pressable onPress={() => setShowChurchSheet(true)}>
                <View style={[s.dropdown, { backgroundColor: c.bg, borderColor: c.border }]}>
                  <View style={{ flex: 1, justifyContent: 'center' }}>
                    {selectedChurch ? (
                      <>
                        <Text style={[s.ddTitle, { color: c.text }]} numberOfLines={1}>{selectedChurch.name_am}</Text>
                        <Text style={[s.ddSub, { color: c.textSoft }]} numberOfLines={1}>{selectedChurch.name_en}</Text>
                      </>
                    ) : (
                      <Text style={[s.ddPlaceholder, { color: c.textFaint }]}>{t(lang, 'selectChurch')}</Text>
                    )}
                  </View>
                  <Icon name="chevron" size={14} color={c.textFaint} />
                </View>
              </Pressable>
            </View>

            {/* Branch Name Input for Pastor */}
            <Field
              c={c}
              label={`${t(lang, 'branchLabel')} *`}
              placeholder={isAm ? 'የቅርንጫፉ ስም (ለምሳሌ፦ ቦሌ ቅርንጫፍ)' : 'Branch name (e.g. Bole Branch)'}
              value={pastorBranchName}
              onChangeText={setPastorBranchName}
            />

            {/* Branch Type Selector */}
            <View>
              <Text style={[s.label, { color: c.text }]}>{`${t(lang, 'branchTypeLabel')} *`}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <ToggleButton c={c} active={!isMotherBranch} onPress={() => setIsMotherBranch(false)}>
                  {t(lang, 'childBranch')}
                </ToggleButton>
                <ToggleButton c={c} active={isMotherBranch} onPress={() => setIsMotherBranch(true)}>
                  {t(lang, 'motherBranch')}
                </ToggleButton>
              </View>
            </View>

            {/* Document Picker */}
            <View>
              <Text style={[s.label, { color: c.text }]}>{`${t(lang, 'authDoc')} *`}</Text>
              <Pressable onPress={pickDocument}>
                <View style={[s.dropdown, { backgroundColor: c.bg, borderColor: c.border, gap: 8 }]}>
                  <Icon name="book" size={16} color={c.accent} />
                  <Text style={{ fontSize: 14, color: c.text, flex: 1 }} numberOfLines={1}>
                    {docFile ? docFile.name : t(lang, 'pickFile')}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        )}

        {/* Global Error Banner */}
        {err && <Text style={[s.errBanner, { color: c.danger }]}>{err}</Text>}

        {/* Submit Button for Sign In & Pastor Mode */}
        {mode !== 'up' && (
          <PrimaryButton c={c} onPress={submit} disabled={busy} busy={busy} style={{ marginTop: 16 }}>
            {mode === 'in' ? (isAm ? 'ግቡ' : 'Sign in') : (isAm ? 'ማመልከቻውን ላክ' : 'Submit Verification')}
          </PrimaryButton>
        )}

        {/* Direct pastor registration entry — separate from member signup */}
        {mode === 'in' && (
          <View style={{ alignItems: 'center', marginTop: 20 }}>
            <Pressable onPress={() => setMode('pastor')}>
              <Text style={[s.backLink, { color: c.accent }]}>{t(lang, 'registerPastor')}</Text>
            </Pressable>
          </View>
        )}

        {/* Back Link for Pastor Mode */}
        {mode === 'pastor' && (
          <View style={{ alignItems: 'center', marginTop: 16 }}>
            <Pressable onPress={() => setMode('in')}>
              <Text style={[s.backLink, { color: c.accent }]}>
                {isAm ? 'ወደ መግቢያ ተመለስ' : 'Back to Sign In'}
              </Text>
            </Pressable>
          </View>
        )}

        <Text style={[s.offlineNote, { color: c.textFaint }]}>{t(lang, 'offlineReady')}</Text>
      </ScrollView>

      {/* ===================== BOTTOM SHEETS ===================== */}

      {/* Church Picker */}
      <BottomSheet c={c} visible={showChurchSheet} onClose={() => setShowChurchSheet(false)} title={t(lang, 'selectChurch')} heightPct={0.75}>
        <FlatList
          style={{ flex: 1 }}
          data={churches}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                setChurchId(item.id);
                setBranchId(null);
                setShowChurchSheet(false);
                validateField('churchId', item.id);
              }}
            >
              <View style={[sheetS.sheetItem, { backgroundColor: c.bg, borderColor: churchId === item.id ? c.accent : c.border }]}>
                <Text style={[s.ddTitle, { color: c.text }]}>{item.name_am}</Text>
                <Text style={[s.ddSub, { color: c.textSoft }]}>
                  {item.name_en} {item.denomination ? `(${item.denomination})` : ''}
                </Text>
              </View>
            </Pressable>
          )}
          ListFooterComponent={
            mode === 'up' ? (
              <Pressable
                onPress={() => {
                  setChurchId(OTHER_CHURCH);
                  setBranchId(null);
                  setShowChurchSheet(false);
                  validateField('churchId', OTHER_CHURCH);
                }}
              >
                <View style={[sheetS.sheetItem, { backgroundColor: c.bg, borderColor: isOther ? c.accent : c.border }]}>
                  <Text style={[s.ddTitle, { color: c.text }]}>
                    {isAm ? 'ሌላ — ዝርዝሩ ውስጥ የለም' : 'Other — not in the list'}
                  </Text>
                  <Text style={[s.ddSub, { color: c.textSoft }]}>
                    {isAm ? 'ቤተ ክርስቲያንዎን ይጠይቁ' : 'Request your church'}
                  </Text>
                </View>
              </Pressable>
            ) : null
          }
        />
      </BottomSheet>

      {/* Branch Picker */}
      <BottomSheet c={c} visible={showBranchSheet} onClose={() => setShowBranchSheet(false)} title={t(lang, 'selectBranch')} heightPct={0.6}>
        <FlatList
          style={{ flex: 1 }}
          data={branches}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                setBranchId(item.id);
                setShowBranchSheet(false);
                validateField('branchId', item.id);
              }}
            >
              <View style={[sheetS.sheetItem, { backgroundColor: c.bg, borderColor: branchId === item.id ? c.accent : c.border }]}>
                <Text style={[s.ddTitle, { color: c.text }]}>{item.name_am}</Text>
                <Text style={[s.ddSub, { color: c.textSoft }]}>{item.name_en}</Text>
              </View>
            </Pressable>
          )}
        />
      </BottomSheet>

      {/* Role Picker */}
      <BottomSheet c={c} visible={showRoleSheet} onClose={() => setShowRoleSheet(false)} title={t(lang, 'selectRole')} heightPct={0.8}>
        <FlatList
          style={{ flex: 1 }}
          data={availableRoles}
          keyExtractor={(item) => item.value}
          renderItem={({ item }) => (
            <Pressable onPress={() => handleSelectRole(item)}>
              <View
                style={[
                  sheetS.sheetItem,
                  s.rowBetween,
                  { backgroundColor: c.bg, borderColor: churchRole === item.value ? c.accent : c.border },
                ]}
              >
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <Text style={[s.ddTitle, { color: c.text }]}>{item.am}</Text>
                  <Text style={[s.ddSub, { color: c.textSoft }]}>{item.en}</Text>
                </View>
                {item.isClergy && (
                  <View style={[sheetS.kycBadge, { borderColor: c.accent, backgroundColor: 'rgba(227,169,60,0.1)' }]}>
                    <Text style={[sheetS.kycBadgeTxt, { color: c.accent }]}>
                      {isAm ? 'ማረጋገጫ ያስፈልጋል' : 'KYC Required'}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          )}
        />
      </BottomSheet>

      {/* Clergy KYC Interception Notice */}
      <BottomSheet
        c={c}
        visible={showClergyNoticeSheet}
        onClose={() => setShowClergyNoticeSheet(false)}
        title={t(lang, 'clergyVerificationTitle')}
        heightPct={0.4}
      >
        <Text style={{ fontSize: 13.5, color: c.textSoft, lineHeight: 20 }}>{t(lang, 'clergyVerificationNotice')}</Text>
        <PrimaryButton c={c} onPress={handleProceedToClergyKYC} style={{ marginTop: 16 }}>
          {isAm ? 'ወደ ማረጋገጫ ቀጥል' : 'Proceed to Verification'}
        </PrimaryButton>
      </BottomSheet>
    </SafeAreaView>
  );
}

/* ----------------------------- building blocks ----------------------------- */

type FieldProps = TextInputProps & { c: Palette; label: string; error?: string };

function Field({ c, label, error, style, ...inputProps }: FieldProps) {
  return (
    <View>
      <Text style={[s.label, { color: c.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={c.textFaint}
        style={[s.input, { color: c.text, backgroundColor: c.bg, borderColor: error ? c.danger : c.border }, style]}
        {...inputProps}
      />
      {error ? <Text style={[s.fieldErr, { color: c.danger }]}>{error}</Text> : null}
    </View>
  );
}

function PrimaryButton({
  c,
  onPress,
  disabled,
  busy,
  busyLabel,
  children,
  style,
}: {
  c: Palette;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** Shown next to the spinner instead of a bare "Loading…" — "Creating your
   * account…" tells the user what's actually happening. */
  busyLabel?: string;
  children: React.ReactNode;
  style?: any;
}) {
  return (
    <Pressable
      style={[s.btn, { backgroundColor: c.text, opacity: disabled ? 0.6 : 1 }, style]}
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled, busy }}
    >
      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={c.bg} />
          {!!busyLabel && <Text style={[s.btnTxt, { color: c.bg }]}>{busyLabel}</Text>}
        </View>
      ) : (
        <Text style={[s.btnTxt, { color: c.bg }]}>{children}</Text>
      )}
    </Pressable>
  );
}

function ToggleButton({
  c,
  active,
  onPress,
  children,
}: {
  c: Palette;
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      style={[s.toggle, { backgroundColor: active ? c.text : c.bg, borderColor: c.border }]}
      onPress={onPress}
    >
      <Text style={{ fontSize: 14, fontWeight: '600', color: active ? c.bg : c.textSoft }}>{children}</Text>
    </Pressable>
  );
}

function BottomSheet({
  c,
  visible,
  onClose,
  title,
  heightPct,
  children,
}: {
  c: Palette;
  visible: boolean;
  onClose: () => void;
  title: string;
  heightPct: number;
  children: React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheetS.wrap}>
        <Pressable style={sheetS.overlay} onPress={onClose} />
        <View
          style={[
            sheetS.frame,
            { backgroundColor: c.surface, borderColor: c.border, height: Math.round(height * heightPct) },
          ]}
        >
          <View style={[sheetS.handle, { backgroundColor: c.border }]} />
          <View style={sheetS.header}>
            <Text style={[sheetS.title, { color: c.text }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Cross size={18} color={c.text} />
            </Pressable>
          </View>
          <View style={[sheetS.sep, { backgroundColor: c.border }]} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 60 },

  header: { alignItems: 'center', marginBottom: 16 },
  appName: { fontSize: 32, fontWeight: '700', marginTop: 4 },
  brandSub: { fontSize: 12, letterSpacing: 3 },

  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, overflow: 'hidden', marginBottom: 16, height: 48 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segTxt: { fontSize: 15, fontWeight: '700' },

  pastorHead: { borderBottomWidth: 1, paddingBottom: 8, marginBottom: 16, alignItems: 'center' },
  pastorHeadTxt: { fontSize: 17, fontWeight: '700' },

  card: { borderWidth: 1, borderRadius: radius.lg, padding: 16 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepTitle: { fontSize: 13, fontWeight: '700' },
  stepCount: { fontSize: 11.5, fontWeight: '600' },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },

  label: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  input: { height: 52, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 14, fontSize: 16 },
  fieldErr: { fontSize: 12, marginTop: 4 },
  // Ge'ez glyphs run tall and dense — these need roughly double the leading
  // a same-size Latin line would use (matches bible.tsx's amText ratio).
  helperTxt: { fontSize: 12, lineHeight: 20, marginTop: 6 },
  sectionLabel: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  sectionHint: { fontSize: 12, lineHeight: 20, marginBottom: 4 },
  okTxt: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 },
  orLine: { flex: 1, height: 1 },
  orTxt: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.5 },

  dropdown: {
    height: 52,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ddTitle: { fontSize: 15, fontWeight: '600' },
  ddSub: { fontSize: 11.5 },
  ddPlaceholder: { fontSize: 15 },

  btn: { height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnOutline: { borderWidth: 1 },
  btnTxt: { fontSize: 15, fontWeight: '700' },
  toggle: { flex: 1, height: 48, borderWidth: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },

  errBanner: { fontSize: 13, marginTop: 12, textAlign: 'center' },
  backLink: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
  offlineNote: { fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 18 },

  successWrap: { flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center' },
  successCard: { borderWidth: 1, borderRadius: radius.lg, padding: 24, width: '100%', alignItems: 'center' },
  successTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  successNote: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});

const sheetS = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  frame: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, marginTop: 2, marginBottom: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700' },
  sep: { height: 1, marginBottom: 12 },
  sheetItem: { minHeight: 52, justifyContent: 'center', borderWidth: 1, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  kycBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  kycBadgeTxt: { fontSize: 10, fontWeight: '700' },
});
