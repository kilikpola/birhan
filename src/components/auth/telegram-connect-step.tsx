import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Linking, ActivityIndicator, AppState, StyleSheet } from 'react-native';
import { Icon } from '@/components/icon';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';
import { reportError } from '@/lib/errors';
import {
  getTelegramRegistrationStatus,
  type PendingRegistration,
  type TelegramStatus,
} from '@/lib/telegramSignup';

/**
 * Step 3 of registration: connect Telegram, and wait for the server to say it
 * saw you.
 *
 * The screen is a viewer onto a server-side fact. It has no way to decide it is
 * connected — it opens a link and polls, and `connected` only ever arrives from
 * the backend. That is why the Create-account button is driven by `status`
 * rather than by anything this component could set on its own.
 */

/**
 * Someone is sitting and waiting, so this has to feel responsive — but the
 * endpoint is rate limited per IP, and in Ethiopia a single address is often a
 * whole café or a shared line. Four seconds keeps a ten-minute worst case near
 * 150 requests, which leaves room for several people registering at once from
 * behind the same NAT.
 */
const POLL_MS = 4000;

export type ConnectState = TelegramStatus['status'] | 'idle';

export function TelegramConnectStep({
  c,
  lang,
  pending,
  status,
  onStatusChange,
  onStartAgain,
}: {
  c: Palette;
  lang: Lang;
  /** Null until the details have been handed over and a link issued. */
  pending: PendingRegistration | null;
  status: TelegramStatus | null;
  onStatusChange: (status: TelegramStatus) => void;
  onStartAgain: () => void;
}) {
  const [openError, setOpenError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  // "Settled" means there is nothing left to wait for. Deriving it rather than
  // reading a ref keeps the polling effect's dependencies honest: waiting →
  // waiting does not change it, so a poll that finds nothing new does not
  // restart the timer, and the one transition that matters does stop it.
  const settled = status != null && status.status !== 'waiting' && status.status !== 'offline';

  const poll = useCallback(async () => {
    if (!pending) return;
    const next = await getTelegramRegistrationStatus(pending.pendingId);
    // A failed poll is not an answer — hold the last real one rather than
    // telling someone their registration broke because the signal dropped.
    if (next.status === 'offline') return;
    onStatusChange(next);
  }, [pending, onStatusChange]);

  // Poll while there is still something to wait for. Finishing in Telegram and
  // immediately tapping Create is why this does not rely on the app regaining
  // focus — the answer arrives on its own either way, and the backend re-checks
  // regardless of what this ever saw.
  useEffect(() => {
    if (!pending || settled) return;
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [pending, settled, poll]);

  // Coming back from Telegram is the most likely moment for the answer to have
  // landed. Poll immediately rather than waiting out the interval.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') poll();
    });
    return () => sub.remove();
  }, [poll]);

  const openTelegram = async () => {
    if (!pending) return;
    setOpenError(null);
    try {
      await Linking.openURL(pending.deepLink);
      setOpened(true);
    } catch (err) {
      reportError(err, 'telegram-connect:open');
      setOpenError(t(lang, 'telegramCouldNotOpen'));
    }
  };

  const state: ConnectState = status?.status === 'offline' ? 'waiting' : status?.status ?? 'idle';
  const connected = status?.status === 'connected';

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 6 }}>
        <Text style={[styles.title, { color: c.text }]}>{t(lang, 'telegramStepTitle')}</Text>
        <Text style={[styles.intro, { color: c.textSoft }]}>{t(lang, 'telegramStepIntro')}</Text>
      </View>

      <StatusCard c={c} lang={lang} state={state} status={status} />

      {/* Expired and already-linked are dead ends: the only way forward is a
          fresh registration, so the primary action changes to say so. */}
      {state === 'expired' || state === 'already_linked' || state === 'not_found' ? (
        <Pressable
          onPress={onStartAgain}
          style={[styles.btn, { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 }]}
        >
          <Text style={[styles.btnTxt, { color: c.text }]}>{t(lang, 'telegramStartAgain')}</Text>
        </Pressable>
      ) : connected ? null : (
        <Pressable
          onPress={openTelegram}
          disabled={!pending}
          style={[styles.btn, { backgroundColor: c.accent, opacity: pending ? 1 : 0.5 }]}
        >
          <Text style={[styles.btnTxt, { color: c.bg }]}>
            {opened ? t(lang, 'telegramOpenAgain') : t(lang, 'telegramOpenButton')}
          </Text>
        </Pressable>
      )}

      {openError ? (
        <Text style={[styles.error, { color: c.danger }]}>{openError}</Text>
      ) : null}

      <View style={[styles.why, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.whyTitle, { color: c.text }]}>{t(lang, 'telegramWhyTitle')}</Text>
        <Text style={[styles.whyBody, { color: c.textSoft }]}>{t(lang, 'telegramWhyBody')}</Text>
      </View>
    </View>
  );
}

function StatusCard({
  c,
  lang,
  state,
  status,
}: {
  c: Palette;
  lang: Lang;
  state: ConnectState;
  status: TelegramStatus | null;
}) {
  const username =
    status?.status === 'connected' && status.telegramUsername ? status.telegramUsername : null;

  if (state === 'connected') {
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.accent }]}>
        <Icon name="check" size={16} color={c.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.cardTitle, { color: c.text }]}>
            {t(lang, 'telegramConnectedTitle')}
          </Text>
          {username ? (
            <Text style={[styles.cardBody, { color: c.textSoft }]}>
              {`${t(lang, 'telegramConnectedAs')} @${username}`}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  if (state === 'already_linked' || state === 'expired' || state === 'not_found') {
    const message =
      state === 'already_linked'
        ? t(lang, 'telegramAlreadyLinked')
        : t(lang, 'telegramSessionExpired');
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.danger }]}>
        <Icon name="alert" size={16} color={c.danger} />
        <Text style={[styles.cardBody, { color: c.text, flex: 1 }]}>{message}</Text>
      </View>
    );
  }

  if (state === 'idle') {
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.cardBody, { color: c.textSoft, flex: 1 }]}>
          {t(lang, 'telegramNotConnected')}
        </Text>
      </View>
    );
  }

  // waiting (and a failed poll, which is shown as waiting rather than as an
  // error the person cannot act on)
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <ActivityIndicator size="small" color={c.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.cardTitle, { color: c.text }]}>{t(lang, 'telegramWaiting')}</Text>
        <Text style={[styles.cardBody, { color: c.textSoft }]}>
          {t(lang, 'telegramWaitingHint')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700' },
  // Ge'ez needs the taller line box; 1.9x, per the project's own rule.
  intro: { fontSize: 14, lineHeight: 26 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  cardTitle: { fontSize: 14.5, fontWeight: '700' },
  cardBody: { fontSize: 13, lineHeight: 24 },
  btn: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTxt: { fontSize: 15, fontWeight: '700' },
  error: { fontSize: 12.5, lineHeight: 22 },
  why: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 4 },
  whyTitle: { fontSize: 13.5, fontWeight: '700' },
  whyBody: { fontSize: 12.5, lineHeight: 24 },
});
