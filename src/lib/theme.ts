/**
 * 全域設計變數。固定使用深色底，讓照片本身成為畫面主角。
 * 只放「跨畫面共用」的值，避免過度拆檔。
 */

export const colors = {
  background: '#0E1014',
  surface: '#191C22',
  surfaceAlt: '#22262E',
  border: '#2E333D',
  text: '#F5F6F8',
  textMuted: '#9AA1AE',
  accent: '#4C8DFF',
  accentText: '#FFFFFF',
  keep: '#3ECF8E',
  discard: '#FF6B6B',
  warning: '#FFC24B',
  disabled: '#3A3F49',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
} as const;

/**
 * 字級用 clamp 過的比例縮放，讓 iPhone SE ~ Pro Max 都不溢位。
 * scale 由畫面寬度算出（375pt 為基準），上下限避免極端值。
 */
export function scaleFont(size: number, screenWidth: number): number {
  const ratio = screenWidth / 375;
  const clamped = Math.min(Math.max(ratio, 0.9), 1.15);
  return Math.round(size * clamped);
}
