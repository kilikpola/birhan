import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/icon';
import { PasswordField } from '@/components/auth/password-field';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';
import { deleteAccount, type TelegramRemoval } from '@/lib/account';

/**
 * Deleting your account, from More → Settings.
 *
 * Two rules shape this screen. It must say plainly what will happen before it
 * happens, including the parts that are *not* reversible and the parts Birhan
 * cannot reach — a bot can only remove someone from a group it administers, and
 * implying otherwise would be a promise the software cannot keep. And it must
 * not be a single tap: the password is asked for again, and the server checks
 * it again.
 */

type Stage = 'confirm' | 'working' | 'done';

export function DeleteAccountModal({
  visible,
  c,
  lang,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  c: Palette;
  lang: Lang;
  /** Dismiss without deleting. */
  onClose: () => void;
  /** Called after the person acknowledges the result — clears the session. */
  onDeleted: () => void;
}) {
  const [stage, setStage] = useState<Stage>('confirm');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removals, setRemovals] = useState<TelegramRemoval[]>([]);

  const reset = () => {
    setStage('confirm');
    setPassword('');
    setError(null);
    setRemovals([]);
  };

  const cancel = () => {
    reset();
    onClose();
  };

  const confirm = async () => {
    setError(null);
    setStage('working');
    const res = await deleteAccount(password);

    if (!res.ok) {
      setStage('confirm');
      setPassword('');
      setError(
        res.code === 'WRONG_PASSWORD'
          ? t(lang, 'deleteWrongPassword')
          : res.code === 'OFFLINE'
            ? t(lang, 'errCouldNotReachServer')
            : t(lang, 'deleteFailed'),
      );
      return;
    }

    // The account is gone from here whatever Telegram said.
    setRemovals(res.telegram);
    setStage('done');
  };

  const finish = () => {
    reset();
    onDeleted();
  };

  const removed = removals.filter((r) => r.removed);
  const failed = removals.filter((r) => !r.removed);
  const groupName = (r: TelegramRemoval) => r.chatTitle || t(lang, 'deleteGroupUnnamed');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={stage === 'working' ? undefined : cancel}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {stage === 'done' ? (
            <View style={{ gap: space.lg }}>
              <Text style={[styles.title, { color: c.text }]}>{t(lang, 'deleteDoneTitle')}</Text>

              {removed.length > 0 ? (
                <View style={{ gap: 6 }}>
                  <Text style={[styles.groupLabel, { color: c.textSoft }]}>
                    {t(lang, 'deleteRemovedFrom')}
                  </Text>
                  {removed.map((r, i) => (
                    <Text key={`ok-${i}`} style={[styles.groupName, { color: c.text }]}>
                      · {groupName(r)}
                    </Text>
                  ))}
                </View>
              ) : null}

              {/* Named explicitly rather than glossed over — the person needs to
                  know which group they are still in so they can leave it. */}
              {failed.length > 0 ? (
                <View
                  style={[styles.card, { backgroundColor: c.surface, borderColor: c.danger }]}
                >
                  <Text style={[styles.groupLabel, { color: c.danger }]}>
                    {t(lang, 'deleteCouldNotRemoveFrom')}
                  </Text>
                  {failed.map((r, i) => (
                    <Text key={`fail-${i}`} style={[styles.groupName, { color: c.text }]}>
                      · {groupName(r)}
                    </Text>
                  ))}
                  <Text style={[styles.body, { color: c.textSoft }]}>
                    {t(lang, 'deleteCouldNotRemoveNote')}
                  </Text>
                </View>
              ) : null}

              <Pressable
                onPress={finish}
                style={[styles.btn, { backgroundColor: c.text }]}
              >
                <Text style={[styles.btnTxt, { color: c.bg }]}>{t(lang, 'btnGoToApp')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: space.lg }}>
              <View style={{ gap: 6 }}>
                <Text style={[styles.title, { color: c.text }]}>
                  {t(lang, 'deleteAccountTitle')}
                </Text>
                <Text style={[styles.body, { color: c.danger }]}>
                  {t(lang, 'deleteAccountIntro')}
                </Text>
              </View>

              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.groupLabel, { color: c.text }]}>
                  {t(lang, 'deleteWhatHappens')}
                </Text>
                {([
                  'deleteBulletAccount',
                  'deleteBulletTelegram',
                  'deleteBulletContent',
                  'deleteBulletSessions',
                ] as const).map((key) => (
                  <View key={key} style={styles.bulletRow}>
                    <Text style={[styles.bulletDot, { color: c.accent }]}>·</Text>
                    <Text style={[styles.body, { color: c.textSoft, flex: 1 }]}>
                      {t(lang, key)}
                    </Text>
                  </View>
                ))}
              </View>

              {/* The honest limit. Birhan administers a church's linked group;
                  it has no reach into anything else, and must not imply it. */}
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.groupLabel, { color: c.text }]}>
                  {t(lang, 'deleteTelegramLimitTitle')}
                </Text>
                <Text style={[styles.body, { color: c.textSoft }]}>
                  {t(lang, 'deleteTelegramLimitBody')}
                </Text>
                <Text style={[styles.body, { color: c.textSoft }]}>
                  {t(lang, 'deleteRejoinNote')}
                </Text>
              </View>

              <PasswordField
                c={c}
                lang={lang}
                label={t(lang, 'deleteEnterPassword')}
                value={password}
                onChangeText={setPassword}
                error={error ?? undefined}
              />

              <View style={{ gap: space.sm }}>
                <Pressable
                  onPress={confirm}
                  disabled={stage === 'working' || password.length === 0}
                  style={[
                    styles.btn,
                    {
                      backgroundColor: c.danger,
                      opacity: stage === 'working' || password.length === 0 ? 0.5 : 1,
                    },
                  ]}
                >
                  {stage === 'working' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={[styles.btnTxt, { color: '#fff' }]}>
                      {t(lang, 'deleteConfirmButton')}
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  onPress={cancel}
                  disabled={stage === 'working'}
                  style={[
                    styles.btn,
                    { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.btnTxt, { color: c.text }]}>{t(lang, 'deleteCancel')}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** The row in More → Settings that opens the above. */
export function DeleteAccountRow({
  c,
  lang,
  onPress,
}: {
  c: Palette;
  lang: Lang;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
      accessibilityRole="button"
    >
      <Icon name="alert" size={16} color={c.danger} />
      <Text style={[styles.rowTxt, { color: c.danger }]}>{t(lang, 'deleteAccount')}</Text>
      <Icon name="chev" size={15} color={c.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space.lg, paddingBottom: space.xxl, gap: space.lg },
  title: { fontSize: 20, fontWeight: '700' },
  // Ge'ez needs the taller line box — ~1.9x, per the project's own rule.
  body: { fontSize: 13.5, lineHeight: 26 },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  groupLabel: { fontSize: 13.5, fontWeight: '700' },
  groupName: { fontSize: 13.5, lineHeight: 24 },
  bulletRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  bulletDot: { fontSize: 15, fontWeight: '700', lineHeight: 26 },
  btn: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTxt: { fontSize: 15, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    height: 52,
    marginBottom: space.sm,
  },
  rowTxt: { flex: 1, fontSize: 14.5, fontWeight: '600' },
});
