/**
 * 全域設計變數（Beta 0.4：柔和像素風）。
 *
 * 視覺骨架：奶油白底、深紫黑文字、2px 深色描邊、4px 無模糊硬陰影、小圓角。
 * 照片永遠是主角，像素感只出現在描邊、陰影、進度條與裝飾。
 *
 * 相容性：舊的 token key（text／textMuted／accent／accentText／border／disabled）
 * 全部保留並映射到新 token，所以既有頁面不用大改就能換皮。
 */

/** 新命名的語意色票。 */
const palette = {
  background: '#FFF8E8',
  surface: '#FFFDF7',
  /** 卡片內層、進度條軌道、次級區塊。 */
  surfaceAlt: '#FFF3D6',

  textPrimary: '#302B3A',
  /** 由 #81798D 調深，讓 13px caption 在奶油白底上達到 AA（3.93:1 → 5.05:1）。 */
  textSecondary: '#6F6879',

  primary: '#A998F5',
  keep: '#85D6AE',
  discard: '#FF7D78',
  warning: '#FFD46A',

  /** 描邊與硬陰影共用同一個深色。 */
  outline: '#423B4D',

  disabledSurface: '#EDE7DC',
  disabledText: '#A9A2B3',

  /** 全螢幕覆蓋層／卡片上的 badge 底色。 */
  overlayScrim: 'rgba(48, 43, 58, 0.55)',

  /**
   * 深色前景版本，專門用在「有色文字放在淺色底」的情況。
   *
   * primary／keep／discard／warning 這四個粉彩色是給填色與描邊用的；
   * 直接拿來當淺底上的文字只有 1.3~2.4:1，完全讀不到。
   * 需要「綠色的字」「紅色的字」時一律用這組（皆 ≥4.7:1）。
   */
  primaryText: '#5B4BA8',
  keepText: '#2E7D5B',
  discardText: '#B03A36',
  warningText: '#8A6416',
} as const;

/**
 * 這組粉彩色的亮度都偏高，白字對比不足
 * （白 on primary 僅約 2.5:1），所以有色底一律搭深色文字（約 5.5:1 以上）。
 */
export const colors = {
  ...palette,

  /** 硬陰影顏色，與描邊同色才有「印刷疊色」的像素感。 */
  shadow: palette.outline,
  /** 有色底（primary／keep／discard／warning）上的文字。 */
  onColor: palette.textPrimary,

  // ── 以下為舊 key 的相容映射，勿刪 ──
  /** @deprecated 用 textPrimary */
  text: palette.textPrimary,
  /** @deprecated 用 textSecondary */
  textMuted: palette.textSecondary,
  /** @deprecated 用 primary */
  accent: palette.primary,
  /** @deprecated 用 onColor */
  accentText: palette.textPrimary,
  /** @deprecated 用 outline */
  border: palette.outline,
  /** @deprecated 用 disabledSurface */
  disabled: palette.disabledSurface,
} as const;

/** 間距系統：4／8／12／16／24／32。 */
export const spacing = {
  xs: 4,
  sm: 8,
  ms: 12,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** 小圓角，避免膠囊感。 */
export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
} as const;

/** 描邊寬度。統一取代先前散落的 StyleSheet.hairlineWidth。 */
export const border = {
  width: 2,
  /** 選取／強調態。 */
  widthThick: 3,
} as const;

/**
 * 硬陰影：無模糊、不透明、只有位移。
 * 實作上用一層位移的實色 View（見 PixelSurface），
 * 這樣 iOS 與 Android 表現一致，也不會被 overflow: hidden 裁掉。
 */
export const shadow = {
  offset: 4,
  /** 按下時陰影縮短，配合內容下移 2px。 */
  pressOffset: 2,
} as const;

export const iconSize = {
  sm: 16,
  md: 24,
  lg: 32,
} as const;

/** 像素格點：裝飾尺寸一律取 unit 的整數倍。 */
export const pixel = {
  unit: 2,
  /** 進度條高度。 */
  barHeight: 12,
  /** 進度條分段數。 */
  barSegments: 10,
} as const;

/**
 * Dynamic Type 上限。硬陰影與固定高度的版面在超大字級下會破版，
 * 所以統一夾在 1.4 倍，仍保留放大字級的可用性。
 */
export const fontScaleCap = {
  maxFontSizeMultiplier: 1.4,
} as const;

/**
 * 字級用 clamp 過的比例縮放，讓 iPhone SE ~ Pro Max 都不溢位。
 * scale 由畫面寬度算出（375pt 為基準），上下限避免極端值。
 * 這只處理「裝置寬度」，使用者的 Dynamic Type 由 maxFontSizeMultiplier 控制。
 */
export function scaleFont(size: number, screenWidth: number): number {
  const ratio = screenWidth / 375;
  const clamped = Math.min(Math.max(ratio, 0.9), 1.15);
  return Math.round(size * clamped);
}
