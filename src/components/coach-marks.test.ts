import { computeCoachLayout } from './coach-marks';

const SCREEN = { width: 390, height: 844 }; // iPhone-ish
const TIP = { tipWidth: 320, tipHeight: 150 };

describe('computeCoachLayout', () => {
  it('centers the tooltip with no arrow when there is no target', () => {
    const l = computeCoachLayout(null, SCREEN, TIP);
    expect(l.hole).toBeNull();
    expect(l.tip.arrow).toBe('none');
    // centered horizontally
    expect(l.tip.left).toBeCloseTo((SCREEN.width - 320) / 2);
  });

  it('places the tooltip BELOW a target near the top, arrow pointing up', () => {
    const target = { x: 300, y: 60, width: 44, height: 44 }; // top-right (search icon)
    const l = computeCoachLayout(target, SCREEN, TIP);
    expect(l.hole).not.toBeNull();
    expect(l.tip.arrow).toBe('up');
    expect(l.tip.top).toBeGreaterThan(target.y + target.height); // below the hole
  });

  it('places the tooltip ABOVE a target near the bottom, arrow pointing down', () => {
    const target = { x: 40, y: 780, width: 200, height: 40 };
    const l = computeCoachLayout(target, SCREEN, TIP);
    expect(l.tip.arrow).toBe('down');
    expect(l.tip.top).toBeLessThan(target.y);
  });

  it('keeps the tooltip within the screen margins', () => {
    const target = { x: 360, y: 200, width: 30, height: 30 }; // far right edge
    const l = computeCoachLayout(target, SCREEN, TIP);
    expect(l.tip.left).toBeGreaterThanOrEqual(16);
    expect(l.tip.left + l.tip.width).toBeLessThanOrEqual(SCREEN.width - 16 + 0.001);
  });

  it('the hole includes padding around the target and clamps to the screen', () => {
    const target = { x: 0, y: 0, width: 50, height: 50 };
    const l = computeCoachLayout(target, SCREEN, TIP)!;
    expect(l.hole!.x).toBe(0);          // clamped, not negative
    expect(l.hole!.y).toBe(0);
    expect(l.hole!.width).toBeGreaterThan(target.width); // padded
  });

  it('points the arrow at the target center, clamped inside the tooltip', () => {
    const target = { x: 180, y: 300, width: 30, height: 30 }; // center ~195 (screen middle)
    const l = computeCoachLayout(target, SCREEN, TIP);
    const arrowScreenX = l.tip.left + l.tip.arrowLeft;
    expect(Math.abs(arrowScreenX - (target.x + target.width / 2))).toBeLessThan(1);
    expect(l.tip.arrowLeft).toBeGreaterThanOrEqual(20);
    expect(l.tip.arrowLeft).toBeLessThanOrEqual(l.tip.width - 20);
  });
});
