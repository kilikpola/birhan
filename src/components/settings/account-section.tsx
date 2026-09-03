import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';
import { Card, Row } from './rows';
import { apiFetch } from '@/lib/api';
import { reportError } from '@/lib/errors';
import { LAY_ROLES, CLERGY_ROLE_QES, CLERGY_ROLES_STANDARD } from '@/constants/roles';
import type { Profile } from '@/lib/auth';

/**
 * Who you are, as Birhan has it.
 *
 * Read-only: nothing here is editable yet, and a row that looks tappable but
 * does nothing is worse than one that plainly does not.
 */

/** Churches Birhan ships knowing about, so this reads correctly offline. */
const SEEDED: Record<string, { am: string; en: string }> = {
  'a0000000-0000-4000-8000-000000000001': { am: 'የኢትዮጵያ ወንጌላዊት ቤተ ክርስቲያን መካነ ኢየሱስ', en: 'Ethiopian Evangelical Church Mekane Yesus' },
  'a0000000-0000-4000-8000-000000000002': { am: 'የኢትዮጵያ ቃለ ሕይወት ቤተ ክርስቲያን', en: 'Ethiopian Kale Heywet Church' },
  'a0000000-0000-4000-8000-000000000003': { am: 'የኢትዮጵያ ሙሉ ወንጌል አማኞች ቤተ ክርስቲያን', en: "Ethiopian Full Gospel Believers' Church" },
  'a0000000-0000-4000-8000-000000000004': { am: 'መሠረተ ክርስቶስ ቤተ ክርስቲያን', en: 'Meserete Kristos Church' },
  'a0000000-0000-4000-8000-000000000005': { am: 'አማኑኤል ኅብረት ቤተ ክርስቲያን', en: 'Emmanuel United Church' },
  'a0000000-0000-4000-8000-000000000006': { am: 'ሕይወት ብርሃን ቤተ ክርስቲያን', en: 'Hiwot Berhan Church' },
  'a0000000-0000-4000-8000-000000000007': { am: 'የኢትዮጵያ ባፕቲስት አብያተ ክርስቲያናት', en: 'Ethiopian Baptist Churches' },
};

const ALL_ROLES = [...LAY_ROLES, CLERGY_ROLE_QES, ...CLERGY_ROLES_STANDARD];

/** The role the person holds in their church, in their language. */
function churchRoleLabel(value: string | null | undefined, lang: Lang): string | null {
  if (!value) return null;
  const def = ALL_ROLES.find((r) => r.value === value);
  if (!def) return null;
  return lang === 'am' ? def.am : def.en;
}

/** Their standing in Birhan itself, which is a different thing. */
function accountRoleLabel(role: string | undefined, lang: Lang): string {
  const am = lang === 'am';
  switch (role) {
    case 'super_admin': return am ? 'ሱፐር አስተዳዳሪ' : 'Super admin';
    case 'pastor': return am ? 'እረኛ' : 'Pastor';
    case 'admin': return am ? 'አስተዳዳሪ' : 'Admin';
    case 'pending_pastor': return am ? 'በመጠባበቅ ላይ' : 'Pending pastor';
    default: return am ? 'አባል' : 'Member';
  }
}

export function AccountSection({
  c,
  lang,
  profile,
  onSignOut,
  onDelete,
}: {
  c: Palette;
  lang: Lang;
  profile: Profile | null;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  const isAm = lang === 'am';
  const [churchAm, setChurchAm] = useState('');
  const [churchEn, setChurchEn] = useState('');

  useEffect(() => {
    if (!profile?.church_id) {
      setChurchAm('');
      setChurchEn('');
      return;
    }
    const seeded = SEEDED[profile.church_id];
    setChurchAm(profile.church_name_am || seeded?.am || '');
    setChurchEn(profile.church_name_en || seeded?.en || '');

    let active = true;
    apiFetch<{ churches: any[] }>('/api/v1/churches', { auth: false })
      .then((res) => {
        if (!active) return;
        const found = res.churches.find((ch) => ch.id === profile.church_id);
        if (found) {
          setChurchAm(found.nameAm);
          setChurchEn(found.nameEn);
        }
      })
      .catch((err) => reportError(err, 'Settings.loadChurch', 'am', false));
    return () => {
      active = false;
    };
  }, [profile?.church_id, profile?.church_name_am, profile?.church_name_en]);

  const church = (isAm ? churchAm || churchEn : churchEn || churchAm) || '—';
  const role = churchRoleLabel(profile?.church_role, lang);

  // Whichever contact method they actually registered with. Both is allowed.
  const contactRows: { label: string; value: string; note?: string }[] = [];
  if (profile?.email) {
    contactRows.push({
      label: t(lang, 'emailLabel'),
      value: profile.email,
      note: profile.email_verified ? t(lang, 'verifiedStatus') : t(lang, 'notVerifiedStatus'),
    });
  }
  if (profile?.phone) {
    contactRows.push({ label: t(lang, 'phoneLabel'), value: profile.phone });
  }

  return (
    <View>
      {/* Who you are — read-only facts, one card. */}
      <Card c={c}>
        <Row c={c} lang={lang} label={isAm ? 'ሙሉ ስም' : 'Name'} value={profile?.display_name || '—'} />
        <Row c={c} lang={lang} label={t(lang, 'churchLabel')} value={church} />
        <Row c={c} lang={lang} label={t(lang, 'branchLabel')} value={profile?.branch_name || '—'} />
        {role ? <Row c={c} lang={lang} label={t(lang, 'roleLabel')} value={role} /> : null}
        <Row
          c={c}
          lang={lang}
          label={isAm ? 'በብርሃን ውስጥ ያለዎት ደረጃ' : 'Account type'}
          value={accountRoleLabel(profile?.role, lang)}
        />
        {contactRows.map((r) => (
          <Row key={r.label} c={c} lang={lang} label={r.label} note={r.note} value={r.value} />
        ))}
      </Card>

      {/* Actions, kept apart from the facts above so a destructive one is never
          a neighbour of a label you were only reading. */}
      <View style={styles.gap} />
      <Card c={c}>
        <Row c={c} lang={lang} label={t(lang, 'signOut')} onPress={onSignOut} />
        <Row c={c} lang={lang} label={t(lang, 'deleteAccount')} onPress={onDelete} danger />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { height: space.md },
});
