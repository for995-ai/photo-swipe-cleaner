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

const STORAGE_KEY = 'photo-swipe-cleaner/session/v1';
const STORAGE_VERSION = 2;
/** v1 也讀得進來（只是多了現在不用的 index 欄位），避免升版時清掉使用者進度。 */
const SUPPORTED_VERSIONS = [1, STORAGE_VERSION];

export type Decision = 'keep' | 'discard';

export type HistoryEntry = {
  id: string;
  decision: Decision;
};

export type SessionState = {
  keptIds: string[];
  discardedIds: string[];
  history: HistoryEntry[];
};

export const EMPTY_SESSION: SessionState = {
  keptIds: [],
  discardedIds: [],
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
    history: state.history.filter((entry) => !drop.has(entry.id)),
  };
}

export function countDecided(state: SessionState): number {
  return state.keptIds.length + state.discardedIds.length;
}

/**
 * 目前該整理第幾張：已載入照片中第一張還沒有決定的。
 * 全部都整理過就回傳陣列長度（等於「已載入的都做完了」）。
 */
export function findCursorIndex(photoIds: string[], state: SessionState): number {
  const decided = new Set<string>([...state.keptIds, ...state.discardedIds]);
  const next = photoIds.findIndex((id) => !decided.has(id));
  return next === -1 ? photoIds.length : next;
}

type StoredSession = {
  version: number;
  keptIds: string[];
  discardedIds: string[];
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
    keptIds: candidate.keptIds,
    discardedIds: candidate.discardedIds,
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
    history: stored.history,
  };
}

export async function loadStoredSessionAsync(): Promise<SessionState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return restoreSession(raw ? parseStored(raw) : null);
  } catch {
    // 讀不到就從頭開始，不要因為快取問題卡住使用者。
    return EMPTY_SESSION;
  }
}

export async function saveSessionAsync(state: SessionState): Promise<void> {
  const payload: StoredSession = {
    version: STORAGE_VERSION,
    keptIds: state.keptIds,
    discardedIds: state.discardedIds,
    history: state.history,
    updatedAt: Date.now(),
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 保存失敗不影響當次操作。
  }
}

export async function clearStoredSessionAsync(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略：下一次保存會覆寫。
  }
}
