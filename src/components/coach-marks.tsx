import { useEffect, useMemo, useState, type RefObject } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  useWindowDimensions,
  type LayoutRectangle,
} from 'react-native';
import { t, type Lang } from '../i18n';
import { fonts, type Palette } from '../theme/tokens';

/**
 * Coach marks — a first-run guided tour that dims the screen and spotlights a
 * real control while a tooltip explains it. Self-contained: the geometry is a
 * pure function (unit-tested), and the spotlight is four dim rectangles around
 * the target hole, so there is no SVG mask or native dependency.
 *
 * A step points at a live element via a ref. The overlay measures that element
 * on screen when the step becomes active; if measurement fails (ref not laid
 * out yet, or on a fast unmount) the step falls back to a centered tooltip with
 * no spotlight, so the tour never blocks on a missing target.
 */

export type CoachStep = {
  /** The on-screen element to spotlight. */
  targetRef: RefObject<{ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null>;
  /** i18n keys — kept as keys so the component stays language-agnostic. */
  titleKey: string;
  bodyKey: string;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type CoachLayout = {
  /** The cleared hole (target + padding), clamped to the screen. Null → no spotlight. */
  hole: Rect | null;
  tip: {
    top: number;
    left: number;
    width: number;
    arrow: 'up' | 'down' | 'none';
    /** Arrow x within the tooltip. */
    arrowLeft: number;
  };
};

/**
 * Where to put the spotlight hole and the tooltip. Pure — no React, no
 * measurement — so the positioning can be tested directly.
 */
export function computeCoachLayout(
  target: Rect | null,
  screen: { width: number; height: number },
  opts: { tipWidth: number; tipHeight: number; pad?: number; margin?: number; gap?: number },
): CoachLayout {
  const pad = opts.pad ?? 8;
  const margin = opts.margin ?? 16;
  const gap = opts.gap ?? 12;
  const tipWidth = Math.min(opts.tipWidth, screen.width - margin * 2);

  if (!target) {
    return {
      hole: null,
      tip: {
        top: Math.max(margin, screen.height / 2 - opts.tipHeight / 2),
        left: (screen.width - tipWidth) / 2,
        width: tipWidth,
        arrow: 'none',
        arrowLeft: tipWidth / 2,
      },
    };
  }

  const hole: Rect = {
    x: Math.max(0, target.x - pad),
    y: Math.max(0, target.y - pad),
    width: Math.min(screen.width, target.width + pad * 2),
    height: Math.min(screen.height, target.height + pad * 2),
  };

  const holeBottom = hole.y + hole.height;
  const roomBelow = screen.height - holeBottom;
  const roomAbove = hole.y;
  const below = roomBelow >= opts.tipHeight + gap + margin || roomBelow >= roomAbove;

  const top = below
    ? holeBottom + gap
    : Math.max(margin, hole.y - gap - opts.tipHeight);

  const targetCenterX = target.x + target.width / 2;
  const left = Math.min(
    Math.max(margin, targetCenterX - tipWidth / 2),
    screen.width - margin - tipWidth,
  );

  const arrowLeft = Math.min(Math.max(20, targetCenterX - left), tipWidth - 20);

  return {
    hole,
    tip: { top, left, width: tipWidth, arrow: below ? 'up' : 'down', arrowLeft },
  };
}

const DIM = 'rgba(0,0,0,0.74)';

export function CoachMarks({
  c,
  lang,
  steps,
  visible,
  onDone,
}: {
  c: Palette;
  lang: Lang;
  steps: CoachStep[];
  visible: boolean;
  onDone: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Rect | null>(null);
  const [tipSize, setTipSize] = useState<LayoutRectangle | null>(null);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  // Reset to the first step every time the tour opens.
  useEffect(() => {
    if (visible) { setIndex(0); }
  }, [visible]);

  // Measure the current step's target when it becomes active.
  useEffect(() => {
    if (!visible || !step) return;
    let alive = true;
    setTarget(null);
    const node = step.targetRef.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    // A tick lets the target settle after any layout/scroll before measuring.
    const id = setTimeout(() => {
      node.measureInWindow((x, y, w, h) => {
        if (!alive) return;
        if (w > 0 && h > 0) setTarget({ x, y, width: w, height: h });
        else setTarget(null);
      });
    }, 60);
    return () => { alive = false; clearTimeout(id); };
  }, [visible, index, step]);

  const layout = useMemo(
    () => computeCoachLayout(target, { width, height }, {
      tipWidth: 320,
      tipHeight: tipSize?.height ?? 150,
    }),
    [target, width, height, tipSize?.height],
  );

  if (!visible || !step) return null;

  const next = () => { if (isLast) onDone(); else setIndex((i) => i + 1); };
  const hole = layout.hole;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      {/* Dim: four rectangles leaving the target hole clear. Full-screen dim when no hole. */}
      {hole ? (
        <>
          <View style={[styles.dim, { top: 0, left: 0, width, height: hole.y }]} />
          <View style={[styles.dim, { top: hole.y + hole.height, left: 0, width, height: height - (hole.y + hole.height) }]} />
          <View style={[styles.dim, { top: hole.y, left: 0, width: hole.x, height: hole.height }]} />
          <View style={[styles.dim, { top: hole.y, left: hole.x + hole.width, width: width - (hole.x + hole.width), height: hole.height }]} />
          {/* Highlight ring around the hole. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: hole.y, left: hole.x, width: hole.width, height: hole.height,
              borderRadius: 12, borderWidth: 2, borderColor: c.accent,
            }}
          />
        </>
      ) : (
        <View style={[styles.dim, { top: 0, left: 0, width, height }]} />
      )}

      {/* Tooltip */}
      <View
        onLayout={(e) => setTipSize(e.nativeEvent.layout)}
        style={[
          styles.tip,
          { top: layout.tip.top, left: layout.tip.left, width: layout.tip.width, backgroundColor: c.surface, borderColor: c.border },
        ]}
      >
        {layout.tip.arrow !== 'none' && (
          <View
            style={[
              styles.arrow,
              layout.tip.arrow === 'up'
                ? { top: -8, borderBottomColor: c.surface, borderBottomWidth: 8, borderTopWidth: 0 }
                : { bottom: -8, borderTopColor: c.surface, borderTopWidth: 8, borderBottomWidth: 0 },
              { left: layout.tip.arrowLeft - 8 },
            ]}
          />
        )}
        <Text style={[styles.title, { color: c.text }, lang === 'am' && styles.am]}>{t(lang, step.titleKey as any)}</Text>
        <Text style={[styles.body, { color: c.textSoft }, lang === 'am' && styles.amBody]}>{t(lang, step.bodyKey as any)}</Text>

        <View style={styles.footer}>
          <Text style={[styles.count, { color: c.textFaint }]}>{index + 1}/{steps.length}</Text>
          <View style={styles.actions}>
            {!isLast && (
              <Pressable onPress={onDone} hitSlop={8} style={styles.skip}>
                <Text style={[styles.skipTxt, { color: c.textFaint }]}>{t(lang, 'coachSkip')}</Text>
              </Pressable>
            )}
            <Pressable onPress={next} style={[styles.nextBtn, { backgroundColor: c.accent }]}>
              <Text style={[styles.nextTxt, { color: c.bg }]}>{t(lang, isLast ? 'coachDone' : 'coachNext')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: DIM },
  tip: { position: 'absolute', borderRadius: 14, borderWidth: 1, padding: 16, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  arrow: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  title: { fontSize: 16.5, fontWeight: '700', marginBottom: 6 },
  am: { fontFamily: fonts.amBold },
  body: { fontSize: 14, lineHeight: 21 },
  amBody: { lineHeight: 24, fontFamily: fonts.am },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  count: { fontSize: 12, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  skip: { paddingVertical: 6, paddingHorizontal: 4 },
  skipTxt: { fontSize: 13.5, fontWeight: '600' },
  nextBtn: { paddingVertical: 9, paddingHorizontal: 18, borderRadius: 9 },
  nextTxt: { fontSize: 14, fontWeight: '700' },
});
