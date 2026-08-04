/**
 * 整理範圍。
 *
 * 每個範圍都是一組 getAssetsAsync 的查詢條件，分頁行為完全沿用既有邏輯。
 * 範圍同時是 Session 的命名空間，不同範圍的進度彼此完全隔離。
 */
import { Platform } from 'react-native';

export type CleanupScope =
  | { type: 'all' }
  | { type: 'screenshots' }
  | { type: 'recent30Days' }
  /** month 為 'YYYY-MM'。 */
  | { type: 'month'; month: string }
  | { type: 'album'; albumId: string; albumTitle: string };

export type CleanupScopeType = CleanupScope['type'];

export const DEFAULT_SCOPE: CleanupScope = { type: 'all' };

export const RECENT_DAYS = 30;
export const MONTH_OPTION_COUNT = 24;

/**
 * 截圖只在 iOS 才能靠 PHAsset 的 mediaSubtypes（PhotoKit metadata）可靠辨識。
 * 其他平台沒有這個欄位，若照查就會退化成「所有照片」，所以直接標為不可用。
 */
export const SCREENSHOT_SUPPORTED = Platform.OS === 'ios';

/** Session 與已選範圍的儲存命名空間，必須穩定且可逆推。 */
export function scopeKey(scope: CleanupScope): string {
  switch (scope.type) {
    case 'month':
      return `month:${scope.month}`;
    case 'album':
      return `album:${scope.albumId}`;
    default:
      return scope.type;
  }
}

export function scopeLabel(scope: CleanupScope): string {
  switch (scope.type) {
    case 'all':
      return '所有照片';
    case 'screenshots':
      return '截圖';
    case 'recent30Days':
      return `最近 ${RECENT_DAYS} 天`;
    case 'month':
      return monthLabel(scope.month) ?? '依月份選擇';
    case 'album':
      return `相簿：${scope.albumTitle}`;
  }
}

/** 'YYYY-MM' → 「2026 年 8 月」。格式不對回傳 null。 */
export function monthLabel(month: string): string | null {
  const parsed = parseMonth(month);
  return parsed ? `${parsed.year} 年 ${parsed.monthIndex + 1} 月` : null;
}

function parseMonth(month: string): { year: number; monthIndex: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  return { year, monthIndex };
}

/**
 * 該月份的查詢區間。
 *
 * 原生條件是 creationDate > createdAfter 且 creationDate < createdBefore，
 * 兩端都是開區間，所以起點要往前挪 1ms，才不會漏掉剛好落在該月第一毫秒的照片。
 */
export function monthRange(month: string): { createdAfter: number; createdBefore: number } | null {
  const parsed = parseMonth(month);
  if (!parsed) {
    return null;
  }
  const start = new Date(parsed.year, parsed.monthIndex, 1, 0, 0, 0, 0).getTime();
  const end = new Date(parsed.year, parsed.monthIndex + 1, 1, 0, 0, 0, 0).getTime();
  return { createdAfter: start - 1, createdBefore: end };
}

/** 最近 N 天的起點（開區間）。 */
export function recentRangeStart(days: number = RECENT_DAYS, now: number = Date.now()): number {
  return now - days * 24 * 60 * 60 * 1000;
}

export type MonthOption = { month: string; label: string };

/** 由新到舊列出最近 count 個月。 */
export function listRecentMonths(
  count: number = MONTH_OPTION_COUNT,
  now: Date = new Date()
): MonthOption[] {
  const options: MonthOption[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    options.push({ month, label: `${date.getFullYear()} 年 ${date.getMonth() + 1} 月` });
  }
  return options;
}

/** 從儲存資料還原範圍，格式不對就退回預設值。 */
export function parseScope(value: unknown): CleanupScope | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<CleanupScope> & Record<string, unknown>;

  switch (candidate.type) {
    case 'all':
    case 'recent30Days':
      return { type: candidate.type };
    case 'screenshots':
      return SCREENSHOT_SUPPORTED ? { type: 'screenshots' } : null;
    case 'month':
      return typeof candidate.month === 'string' && parseMonth(candidate.month)
        ? { type: 'month', month: candidate.month }
        : null;
    case 'album':
      return typeof candidate.albumId === 'string' &&
        candidate.albumId.length > 0 &&
        typeof candidate.albumTitle === 'string'
        ? { type: 'album', albumId: candidate.albumId, albumTitle: candidate.albumTitle }
        : null;
    default:
      return null;
  }
}
