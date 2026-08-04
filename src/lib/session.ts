/**
 * 整理進度的純邏輯與本機保存。
 *
 * 設計要點：
 * - 進度完全以「照片 id」為單位記錄，不記位置。目前停在哪一張是即時推導出來的
 *   （第一張尚未整理的已載入照片），所以分頁追加新照片、相簿新增或刪除照片，
 *   都不會弄壞既有進度。
 * - 已從相簿消失、或還沒載入到的 id 只是查不到而已，會被安全略過。
 *
 * 安全性：
 * - 只保存照片 local ID 與決定，永遠不保存照片原始檔或縮圖。
 * - 「待刪除」只是一個字串陣列，本檔案不接觸任何相簿寫入或刪除 API。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseScope, type CleanupScope } from '@/lib/scope';

/** v4 以前只有單一 key，那些資料一律屬於「所有照片」範圍。 */
const LEGACY_STORAGE_KEY = 'photo-swipe-cleaner/session/v1';
/** v5 起每個整理範圍各有自己的 key，進度完全隔離。 */
const STORAGE_KEY_PREFIX = 'photo-swipe-cleaner/session/v5/';

const STORAGE_VERSION = 5;
/**
 * 舊版一律讀得進來，升版不清資料：
 * - v1：history 帶有已不使用的 index 欄位
 * - v2：沒有 deletedIds
 * - v3：沒有 sessionTotalEstimate
 * - v4：沒有 scope，且共用單一 storage key
 */
const SUPPORTED_VERSIONS = [1, 2, 3, 4, STORAGE_VERSION];

function storageKeyFor(scopeKeyValue: string): string {
  return `${STORAGE_KEY_PREFIX}${scopeKeyValue}`;
}

export type Decision = 'keep' | 'discard';

export type HistoryEntry = {
  id: string;
  decision: Decision;
};

export type SessionState = {
  keptIds: string[];
  discardedIds: string[];
  /** 已被系統實際刪除的照片 ID（Set 語意去重），用於保住「本次已處理」的數字。 */
  deletedIds: string[];
  /**
   * 本次整理的分母估計值，只增不減。
   * 相簿 totalCount 會因刪除而變少、因新拍而變多，直接拿來當分母會讓
   * 已處理數超過總數，所以改用這個單調遞增的估計值。0 代表尚未初始化。
   */
  sessionTotalEstimate: number;
  history: HistoryEntry[];
};

export const EMPTY_SESSION: SessionState = {
  keptIds: [],
  discardedIds: [],
  deletedIds: [],
  sessionTotalEstimate: 0,
  history: [],
};

/** 記下一個決定。位置會自己往前走，不需要另外維護索引。 */
export function applyDecision(
  state: SessionState,
  photoId: string,
  decision: Decision
): SessionState {
  return {
    keptIds: decision === 'keep' ? [...state.keptIds, photoId] : state.keptIds,
    discardedIds: decision === 'discard' ? [...state.discardedIds, photoId] : state.discardedIds,
    deletedIds: state.deletedIds,
    sessionTotalEstimate: state.sessionTotalEstimate,
    history: [...state.history, { id: photoId, decision }],
  };
}

/**
 * 復原最後一個決定。移除該 id 後，它會重新變成「第一張尚未整理的照片」，
 * 所以畫面自然回到上一張，統計也跟著更新。
 */
export function undoLastDecision(state: SessionState): SessionState {
  const last = state.history[state.history.length - 1];
  if (!last) {
    return state;
  }
  return {
    keptIds: state.keptIds.filter((id) => id !== last.id),
    discardedIds: state.discardedIds.filter((id) => id !== last.id),
    // 已刪除的照片不在 history 裡，所以復原永遠不會動到 deletedIds。
    deletedIds: state.deletedIds,
    sessionTotalEstimate: state.sessionTotalEstimate,
    history: state.history.slice(0, -1),
  };
}

/**
 * 在確認頁把一張「待刪除」改回「保留」。
 * 同一筆 history 的決定一起改寫，讓歷史與兩個清單永遠一致，
 * 之後在整理頁按復原時行為才不會錯亂。
 */
export function convertToKeep(state: SessionState, photoId: string): SessionState {
  if (!state.discardedIds.includes(photoId)) {
    return state;
  }
  return {
    keptIds: state.keptIds.includes(photoId) ? state.keptIds : [...state.keptIds, photoId],
    discardedIds: state.discardedIds.filter((id) => id !== photoId),
    deletedIds: state.deletedIds,
    sessionTotalEstimate: state.sessionTotalEstimate,
    history: state.history.map((entry) =>
      entry.id === photoId ? { ...entry, decision: 'keep' as const } : entry
    ),
  };
}

/**
 * 把一批 id 從進度中完全移除。
 *
 * 只用於「已確認無法取得」且由使用者主動處理的項目。
 * 尚在解析中的 id 絕對不能丟進來，否則會誤刪還沒載入到的決定。
 */
export function forgetIds(state: SessionState, ids: string[]): SessionState {
  if (ids.length === 0) {
    return state;
  }
  const drop = new Set(ids);
  return {
    keptIds: state.keptIds.filter((id) => !drop.has(id)),
    discardedIds: state.discardedIds.filter((id) => !drop.has(id)),
    // 已刪除是既成事實的紀錄，不會被「移出清單」清掉。
    deletedIds: state.deletedIds,
    sessionTotalEstimate: state.sessionTotalEstimate,
    history: state.history.filter((entry) => !drop.has(entry.id)),
  };
}

/**
 * 照片已被系統實際刪除後：從待刪除清單與操作歷史移除，並記進 deletedIds。
 * keptIds 原封不動 —— 尚未處理的保留進度不受影響。
 */
export function removeDeletedIds(state: SessionState, ids: string[]): SessionState {
  if (ids.length === 0) {
    return state;
  }
  const removed = new Set(ids);
  return {
    keptIds: state.keptIds,
    discardedIds: state.discardedIds.filter((id) => !removed.has(id)),
    // Set 語意去重：同一 ID 重複刪除也只會計入一次。
    deletedIds: Array.from(new Set([...state.deletedIds, ...ids])),
    sessionTotalEstimate: state.sessionTotalEstimate,
    history: state.history.filter((entry) => !removed.has(entry.id)),
  };
}

/** 本次已處理 = 已保留 + 待刪除 + 已刪除。 */
export function countProcessed(state: SessionState): number {
  return state.keptIds.length + state.discardedIds.length + state.deletedIds.length;
}

/**
 * 更新本次整理的分母估計值。只增不減。
 *
 * libraryTotal 是相簿目前回報的張數：刪除後會變少、新拍後會變多，
 * 所以加回 deletedIds 還原成「本次開始時的規模」，再與既有估計值和
 * 已處理數取最大值。這樣：
 * - 刪除 + reload 不會讓分母掉下來
 * - 新增照片可以把分母推高
 * - 已處理數永遠不會超過分母
 *
 * libraryTotal 為 0（還沒讀到 totalCount）時不採用相簿那一項，
 * 但仍保住「不小於已處理數」的底線。
 * 沒有變化時回傳同一個物件，讓 setState 可以直接 bail out。
 */
export function bumpSessionTotalEstimate(
  state: SessionState,
  libraryTotal: number
): SessionState {
  const libraryFloor =
    Number.isFinite(libraryTotal) && libraryTotal > 0 ? libraryTotal + state.deletedIds.length : 0;

  const next = Math.max(state.sessionTotalEstimate, libraryFloor, countProcessed(state));
  if (next === state.sessionTotalEstimate) {
    return state;
  }
  return { ...state, sessionTotalEstimate: next };
}

/**
 * 目前該整理第幾張：已載入照片中第一張還沒有處理的。
 * 全部都處理過就回傳陣列長度（等於「已載入的都做完了」）。
 */
export function findCursorIndex(photoIds: string[], state: SessionState): number {
  // 已刪除也算處理過：相簿重載前它可能還留在已載入陣列裡，不該再被推上來。
  const decided = new Set<string>([
    ...state.keptIds,
    ...state.discardedIds,
    ...state.deletedIds,
  ]);
  const next = photoIds.findIndex((id) => !decided.has(id));
  return next === -1 ? photoIds.length : next;
}

type StoredSession = {
  version: number;
  /** 這份進度屬於哪個整理範圍；v4 以前沒有這個欄位。 */
  scope: CleanupScope | null;
  keptIds: string[];
  discardedIds: string[];
  deletedIds: string[];
  sessionTotalEstimate: number;
  history: HistoryEntry[];
  updatedAt: number;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isHistory(value: unknown): value is HistoryEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item): boolean =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as HistoryEntry).id === 'string' &&
        ((item as HistoryEntry).decision === 'keep' || (item as HistoryEntry).decision === 'discard')
    )
  );
}

function parseStored(raw: string): StoredSession | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<StoredSession>;
  if (
    typeof candidate.version !== 'number' ||
    !SUPPORTED_VERSIONS.includes(candidate.version) ||
    !isStringArray(candidate.keptIds) ||
    !isStringArray(candidate.discardedIds) ||
    !isHistory(candidate.history)
  ) {
    return null;
  }

  return {
    version: STORAGE_VERSION,
    // v4 以前沒有 scope，補 null；格式不對也視為 null，不影響其他欄位。
    scope: parseScope(candidate.scope),
    keptIds: candidate.keptIds,
    discardedIds: candidate.discardedIds,
    // v1／v2 沒有 deletedIds，補成空陣列即可，其餘欄位一律保留。
    deletedIds: isStringArray(candidate.deletedIds)
      ? Array.from(new Set(candidate.deletedIds))
      : [],
    // v1～v3 沒有 sessionTotalEstimate，補成 0（= 尚未初始化），
    // 下一次拿到相簿 totalCount 時會自動算出來。
    sessionTotalEstimate:
      typeof candidate.sessionTotalEstimate === 'number' &&
      Number.isFinite(candidate.sessionTotalEstimate) &&
      candidate.sessionTotalEstimate > 0
        ? Math.floor(candidate.sessionTotalEstimate)
        : 0,
    // 去掉 v1 可能帶有的 index，只留 id 與決定。
    history: candidate.history.map((entry) => ({ id: entry.id, decision: entry.decision })),
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
  };
}

/**
 * 還原保存的進度。刻意「不」比對目前已載入的照片：
 * 分頁時後面幾頁還沒載入，若在這裡過濾就會把還沒讀到的決定誤刪。
 */
export function restoreSession(stored: StoredSession | null): SessionState {
  if (!stored) {
    return EMPTY_SESSION;
  }
  return {
    keptIds: stored.keptIds,
    discardedIds: stored.discardedIds,
    deletedIds: stored.deletedIds,
    sessionTotalEstimate: stored.sessionTotalEstimate,
    history: stored.history,
  };
}

/**
 * 讀取某個整理範圍的進度。
 *
 * 「所有照片」範圍在新 key 沒有資料時，會回頭讀 v4 以前的單一 key，
 * 把既有進度接過來，升版不會讓使用者的進度消失。
 */
export async function loadStoredSessionAsync(scopeKeyValue: string): Promise<SessionState> {
  try {
    const raw = await AsyncStorage.getItem(storageKeyFor(scopeKeyValue));
    if (raw) {
      return restoreSession(parseStored(raw));
    }
    if (scopeKeyValue === 'all') {
      const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        return restoreSession(parseStored(legacy));
      }
    }
    return EMPTY_SESSION;
  } catch {
    // 讀不到就從頭開始，不要因為快取問題卡住使用者。
    return EMPTY_SESSION;
  }
}

export async function saveSessionAsync(
  state: SessionState,
  scopeKeyValue: string,
  scope: CleanupScope
): Promise<void> {
  const payload: StoredSession = {
    version: STORAGE_VERSION,
    scope,
    keptIds: state.keptIds,
    discardedIds: state.discardedIds,
    deletedIds: state.deletedIds,
    sessionTotalEstimate: state.sessionTotalEstimate,
    history: state.history,
    updatedAt: Date.now(),
  };
  try {
    await AsyncStorage.setItem(storageKeyFor(scopeKeyValue), JSON.stringify(payload));
  } catch {
    // 保存失敗不影響當次操作。
  }
}

/** 只清除指定範圍的進度，其他範圍不受影響。 */
export async function clearStoredSessionAsync(scopeKeyValue: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKeyFor(scopeKeyValue));
    if (scopeKeyValue === 'all') {
      // 一併清掉舊 key，否則下次載入又會把舊進度接回來。
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    // 忽略：下一次保存會覆寫。
  }
}
