/**
 * 文字階層。
 *
 * 正文與所有重要說明一律使用系統字體（不載入任何字型檔），
 * 像素感留給描邊、陰影、進度條與裝飾。只有三層：Title／Body／Caption。
 *
 * lineHeight 一律用倍率算出，不寫死 px，這樣 Dynamic Type 放大時不會裁字。
 */
import { fontScaleCap, scaleFont } from '@/lib/theme';

export type TypeRole = 'title' | 'body' | 'caption';

type TypeSpec = {
  /** 375pt 基準字級，實際值由 scaleFont 依裝置寬度調整。 */
  size: number;
  /** lineHeight = size × ratio。 */
  lineHeight: number;
  weight: '400' | '500' | '600' | '700';
};

export const typeScale: Record<TypeRole, TypeSpec> = {
  title: { size: 26, lineHeight: 1.35, weight: '700' },
  body: { size: 16, lineHeight: 1.5, weight: '400' },
  caption: { size: 13, lineHeight: 1.45, weight: '400' },
};

/**
 * 小型強調文字（按鈕、標籤、統計數字）與畫面內標題用的補充規格。
 *
 * screenHeading／sectionTitle／micro 是階段 9 補上的：
 * 這些位置原本各自寫 scaleFont(21) / scaleFont(19) / fontSize: 11，
 * 既沒有 lineHeight（大字級時 CJK 容易被上下裁掉），也沒有統一的字級階層。
 */
export const typeAccent = {
  /** 內頁主標題（不是 Title 的 26pt，例如整理頁與 Review 頁的標頭）。 */
  screenHeading: { size: 21, lineHeight: 1.3, weight: '700' as const },
  /** 區塊標題（成功卡片、空狀態卡片、標頭範圍名稱）。 */
  sectionTitle: { size: 19, lineHeight: 1.3, weight: '700' as const },
  button: { size: 16, lineHeight: 1.25, weight: '600' as const },
  buttonSmall: { size: 14, lineHeight: 1.25, weight: '600' as const },
  badgeLabel: { size: 12, lineHeight: 1.3, weight: '500' as const },
  badgeValue: { size: 13, lineHeight: 1.3, weight: '700' as const },
  noticeTitle: { size: 14, lineHeight: 1.35, weight: '700' as const },
  noticeBody: { size: 14, lineHeight: 1.5, weight: '400' as const },
  /** 輔助資訊（載入提示、格子狀態、行內文字按鈕）。 */
  micro: { size: 11, lineHeight: 1.4, weight: '400' as const },
};

/** 把規格換算成可以直接展開到 Text style 的物件。 */
export function typeStyle(
  spec: { size: number; lineHeight: number; weight: string },
  screenWidth: number
): { fontSize: number; lineHeight: number; fontWeight: TypeSpec['weight'] } {
  const fontSize = scaleFont(spec.size, screenWidth);
  return {
    fontSize,
    lineHeight: Math.round(fontSize * spec.lineHeight),
    fontWeight: spec.weight as TypeSpec['weight'],
  };
}

/** 所有 Text 都套同一個 Dynamic Type 上限，避免各處寫不一致。 */
export const textScaling = {
  maxFontSizeMultiplier: fontScaleCap.maxFontSizeMultiplier,
} as const;
