import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RecentPhoto } from '@/lib/photos';
import { scopeKey, type CleanupScope } from '@/lib/scope';
import {
  EMPTY_SESSION,
  SESSION_SAVE_FAILED_MESSAGE,
  applyDecision,
  bumpSessionTotalEstimate,
  clearStoredSessionAsync,
  convertToKeep,
  countProcessed,
  findCursorIndex,
  forgetIds,
  loadStoredSessionAsync,
  removeDeletedIds,
  saveSessionAsync,
  undoLastDecision,
  type Decision,
  type SessionSaveResult,
  type SessionState,
} from '@/lib/session';

/**
 * 提交「已被 iPhone 實際刪除的一批照片」的結果。
 *
 * - `committedIds`：已經套用到記憶體 Session state 的 ID。
 * - `ok`：那份最新 state 有沒有成功寫進本機。
 *
 * 兩者是分開的：照片已經被系統刪掉了，所以就算保存失敗，記憶體 state
 * 仍然必須反映真實結果，`committedIds` 照樣有值。
 */
export type CommitDeletedBatchResult =
  | { ok: true; committedIds: string[] }
  | { ok: false; committedIds: string[]; message: string };

/** 傳進來的 ID 全部不可用時的訊息。這種情況不會動到任何 state。 */
const COMMIT_INVALID_IDS_MESSAGE = '沒有可提交的照片 ID，進度沒有變更。';

/** expectedScopeKey 與目前 state 歸屬不符時的訊息。 */
const COMMIT_SCOPE_MISMATCH_MESSAGE = '整理範圍已變更，無法更新這批刪除進度。';

/** 還沒還原任何整理範圍就要求保存時的訊息。 */
const SESSION_NOT_READY_MESSAGE = '進度尚未載入完成，請稍後再試一次。';

/**
 * commitDeletedBatch 的 ID 檢查。
 *
 * 刻意不重用 delete-batches.ts 的 dedupeIdsInOrder：那個函式遇到壞資料會 throw，
 * 而這裡是在照片「已經被刪掉之後」才被呼叫的，拋錯會讓呼叫端連
 * 「哪些已經刪掉」都拿不到。所以這裡一律回傳 null，讓呼叫端走安全失敗路徑。
 *
 * 回傳 null 代表沒有可提交的 ID：非陣列、空陣列，或含有任何無效 ID。
 * 穩定去重、保留第一次出現順序、不修改輸入陣列。
 */
function sanitizeCommitIds(ids: readonly string[]): string[] | null {
  if (!Array.isArray(ids)) {
    return null;
  }

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of ids) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }
    if (!seen.has(value)) {
      seen.add(value);
      unique.push(value);
    }
  }

  return unique.length > 0 ? unique : null;
}

export type CleanupSession = {
  state: SessionState;
  /** false 代表還在從 AsyncStorage 還原進度。 */
  ready: boolean;
  /** 目前該整理已載入照片中的第幾張；等於長度代表已載入的都做完了。 */
  cursorIndex: number;
  keptCount: number;
  discardedCount: number;
  /** 已被系統實際刪除的張數。 */
  deletedCount: number;
  /** 本次已處理 = 已保留 + 待刪除 + 已刪除。 */
  processedCount: number;
  /** 進度分母：本次整理的總數估計值，只增不減。 */
  sessionTotalEstimate: number;
  /** 這份進度所屬的整理範圍。 */
  scope: CleanupScope;
  canUndo: boolean;
  /** 最近一次保存失敗的訊息；之後任何一次保存成功就會清掉。 */
  lastSaveError: string | null;
  /** 滑動與底部按鈕共用的唯一決策入口。 */
  decide: (photoId: string, decision: Decision) => void;
  undo: () => void;
  /** 確認頁把待刪除改回保留。 */
  keepInstead: (photoId: string) => void;
  /** 由使用者主動處理「已確認無法取得」的 id；不可用於尚在解析中的 id。 */
  forget: (photoIds: string[]) => void;
  /** 照片已被系統實際刪除後，把 id 從待刪除清單與歷史移除；keptIds 不動。 */
  removeDeleted: (photoIds: string[]) => void;
  reset: () => void;
  /** 立即把目前進度寫入本機（用於「完成本次整理」）。 */
  saveNow: () => Promise<SessionSaveResult>;
  /** 保存失敗後由 UI 觸發：重新保存記憶體中最新的 state。 */
  retrySaveCurrentState: () => Promise<SessionSaveResult>;
  /** 手動清掉保存錯誤提示。 */
  clearSaveError: () => void;
  /**
   * 記憶體中最新的 state 快照。
   *
   * 分批刪除的執行器在**每一批開始前**都要重新確認 discardedIds，而那時
   * React 可能還沒 render（上一批的 commit 剛結束）。閉包裡的 `state` 在
   * 那個瞬間是舊的，所以必須有一個直接讀 ref 的入口。
   *
   * 回傳的是內部物件本身（`Readonly` 只是型別層的提醒）：**呼叫端不得修改它**。
   */
  getStateSnapshot: () => Readonly<SessionState>;
  /**
   * 目前記憶體 state 實際歸屬的 scope key；尚未還原任何範圍時為 null。
   *
   * 與畫面上的 activeScopeKey 不同：切換範圍後、載入完成前，這裡仍是舊的 key。
   * 分批刪除必須用這個值判斷「Session 是不是真的已經對齊我要刪的範圍」。
   */
  getScopeKeySnapshot: () => string | null;
  /**
   * 提交一批「已經被 iPhone 刪除」的照片：更新記憶體 state 並立即嘗試持久化。
   * 保存失敗時**不會回滾** state —— 照片真的已經不見了。
   *
   * `expectedScopeKey` 是可選的防護：有給就必須與目前 state 的歸屬相符，
   * 否則完全不動任何東西並回報失敗。分批刪除與恢復流程都會帶上它，
   * 避免在使用者切換範圍後把上一個範圍的結果寫進新範圍。
   */
  commitDeletedBatch: (
    ids: readonly string[],
    expectedScopeKey?: string
  ) => Promise<CommitDeletedBatchResult>;
};

/**
 * 管理整理進度，並在每次變動後把「只有 ID」的進度寫入本機。
 *
 * 還原只在權限開啟時做一次（或按下重新開始後再做一次），
 * 完全不依賴 photos，所以分頁追加新照片不可能重設
 * cursorIndex／keptIds／discardedIds／history。
 *
 * 保存的協調規則（Beta 0.5 階段 B）：
 * - 所有保存都排進同一條序列佇列，永遠只有一個 setItem 在飛。
 * - 每次排入時就把「state 快照 + storage key + scope」一起捕捉起來，
 *   之後就算使用者切換了範圍，這個任務仍然寫回它自己的位置。
 * - 任何一次保存失敗都不會讓佇列永久 rejected，後面的保存照樣執行。
 */
export function useCleanupSession(
  photos: RecentPhoto[],
  enabled: boolean,
  /** 相簿目前回報的照片總數；只用來把分母往上推，不會讓它變小。 */
  libraryTotal: number,
  /** 整理範圍。不同範圍各自一份進度，永不共用。 */
  scope: CleanupScope
): CleanupSession {
  const activeScopeKey = scopeKey(scope);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const [state, setState] = useState<SessionState>(EMPTY_SESSION);
  const [ready, setReady] = useState(false);
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);

  /**
   * 記憶體中最新的 state。
   *
   * 所有算出 next state 的動作都以 stateRef.current 為基準，不用閉包裡的 state：
   * 連續兩次 commitDeletedBatch 之間 React 還沒 render，閉包的 state 會是舊的，
   * 第二批就會從錯誤的基準算起，把第一批的結果整個蓋掉。
   */
  const stateRef = useRef<SessionState>(EMPTY_SESSION);

  /**
   * 目前 state 歸屬的整理範圍，key 與 scope 物件**成對**保存。
   *
   * 成對是重點：payload 裡的 scope 欄位與寫入用的 storage key 必須永遠指向
   * 同一個範圍，分開存兩個 ref 就有可能拿到不同 render 的組合。
   * null 代表還沒還原任何範圍（session 停用中）。
   */
  const stateOwnerRef = useRef<{ key: string; scope: CleanupScope } | null>(null);

  /** 序列保存佇列。永遠保持 resolved，這樣單次失敗不會卡住後面所有保存。 */
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  /** 單調遞增的保存編號。 */
  const saveSeqRef = useRef(0);
  /** 已套用到 lastSaveError 的最大編號，用來擋掉「較舊結果蓋掉較新結果」。 */
  const appliedSaveSeqRef = useRef(0);
  /**
   * 上一個已排入佇列的快照。
   *
   * 用 reference 相等來判斷「是不是同一份 state」：session.ts 的所有純函式
   * 都是 immutable 的，沒有變化時會回傳同一個物件，所以 reference 相同就
   * 保證是同一份快照。這是 O(1) 的比較，不需要任何深層比對，也不必動 schema。
   */
  const lastQueuedRef = useRef<{ state: SessionState; key: string } | null>(null);

  const applySaveResult = useCallback((requestId: number, result: SessionSaveResult) => {
    // 只有比「已套用的最大編號」更新的結果才生效。
    // 佇列本身已經是序列的，這道檢查是為了把不變式留在本地，
    // 不必依賴 microtask 的先後順序也成立。
    if (requestId < appliedSaveSeqRef.current) {
      return;
    }
    appliedSaveSeqRef.current = requestId;
    setLastSaveError(result.ok ? null : result.message);
  }, []);

  /** 把一次保存排進佇列，並回傳「屬於這一次」的結果。 */
  const enqueueSessionSave = useCallback(
    (
      snapshot: SessionState,
      scopeKeyValue: string,
      scopeValue: CleanupScope
    ): Promise<SessionSaveResult> => {
      const requestId = saveSeqRef.current + 1;
      saveSeqRef.current = requestId;
      lastQueuedRef.current = { state: snapshot, key: scopeKeyValue };

      const run = saveChainRef.current.then(async (): Promise<SessionSaveResult> => {
        try {
          return await saveSessionAsync(snapshot, scopeKeyValue, scopeValue);
        } catch (cause) {
          // saveSessionAsync 本身就不會 reject；這裡只是最後一道保險，
          // 確保任何意外都不會變成 unhandled rejection。
          return { ok: false, message: SESSION_SAVE_FAILED_MESSAGE, cause };
        }
      });

      // 佇列改接一條「永遠 resolved」的尾巴：
      // 某一次保存失敗不可以讓後面排隊的保存全部再也跑不到。
      saveChainRef.current = run.then(
        () => undefined,
        () => undefined
      );

      return run.then((result) => {
        applySaveResult(requestId, result);
        return result;
      });
    },
    [applySaveResult]
  );

  /** 一般動作用：只換 state，範圍歸屬不變。 */
  const applyState = useCallback((next: SessionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** 還原或清空某個範圍的 state，同時記下它屬於哪個 key／scope。 */
  const adoptState = useCallback(
    (next: SessionState, owner: { key: string; scope: CleanupScope } | null) => {
      stateRef.current = next;
      stateOwnerRef.current = owner;
      // 換了範圍就是換了一份 state，之前的排隊指紋不再適用。
      lastQueuedRef.current = null;
      setState(next);
    },
    []
  );

  useEffect(() => {
    if (!enabled) {
      adoptState(EMPTY_SESSION, null);
      setReady(false);
      return;
    }

    let cancelled = false;
    setReady(false);

    // 捕捉這一輪的 key 與 scope。兩者來自同一個 render，所以一定是同一個範圍。
    const owner = { key: activeScopeKey, scope: scopeRef.current };

    loadStoredSessionAsync(owner.key).then((restored) => {
      if (!cancelled) {
        adoptState(restored, owner);
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, activeScopeKey, adoptState]);

  // 分母只增不減。沒有變化時 bumpSessionTotalEstimate 會回傳同一個物件，
  // 這裡先比對 reference 再決定要不要更新，所以把 state 放進依賴也不會無限循環。
  useEffect(() => {
    if (!ready) {
      return;
    }
    const next = bumpSessionTotalEstimate(stateRef.current, libraryTotal);
    if (next !== stateRef.current) {
      applyState(next);
    }
  }, [ready, libraryTotal, state, applyState]);

  // 自動保存：一般滑動、保留、待刪除等變動都走這裡，但同樣經過那條佇列。
  useEffect(() => {
    if (!ready) {
      return;
    }

    const owner = stateOwnerRef.current;
    // 只保存「確定屬於目前範圍」的 state。
    // 切換範圍的那一個 render 裡，記憶體 state 還是舊範圍的，owner.key 會對不上，
    // 於是不會把舊範圍的進度寫進新範圍的 key。
    if (!owner || owner.key !== activeScopeKey) {
      return;
    }

    const snapshot = stateRef.current;
    const queued = lastQueuedRef.current;
    // 同一份快照（reference 相同）且同一個 key，就不必再存一次：
    // commitDeletedBatch 與 saveNow 已經自己排過隊了。
    if (queued && queued.state === snapshot && queued.key === owner.key) {
      return;
    }

    void enqueueSessionSave(snapshot, owner.key, owner.scope);
  }, [ready, state, activeScopeKey, enqueueSessionSave]);

  const photoIds = useMemo(() => photos.map((photo) => photo.id), [photos]);
  const cursorIndex = useMemo(() => findCursorIndex(photoIds, state), [photoIds, state]);

  const decide = useCallback(
    (photoId: string, decision: Decision) => {
      applyState(applyDecision(stateRef.current, photoId, decision));
    },
    [applyState]
  );

  const undo = useCallback(() => {
    applyState(undoLastDecision(stateRef.current));
  }, [applyState]);

  const keepInstead = useCallback(
    (photoId: string) => {
      applyState(convertToKeep(stateRef.current, photoId));
    },
    [applyState]
  );

  const forget = useCallback(
    (photoIds: string[]) => {
      applyState(forgetIds(stateRef.current, photoIds));
    },
    [applyState]
  );

  const removeDeleted = useCallback(
    (photoIds: string[]) => {
      applyState(removeDeletedIds(stateRef.current, photoIds));
    },
    [applyState]
  );

  // 清空進度即等於重新開始；不重新讀取儲存，避免清除與還原互相搶。
  const reset = useCallback(() => {
    applyState(EMPTY_SESSION);
    void clearStoredSessionAsync(activeScopeKey);
  }, [applyState, activeScopeKey]);

  /** 保存 stateRef.current 的精確快照，經過同一條佇列。 */
  const saveCurrentState = useCallback((): Promise<SessionSaveResult> => {
    const owner = stateOwnerRef.current;
    if (!owner) {
      // 還沒還原任何範圍就沒有東西可存。回報失敗，不假裝成功。
      return Promise.resolve({
        ok: false,
        message: SESSION_NOT_READY_MESSAGE,
        cause: 'session-not-ready',
      });
    }
    return enqueueSessionSave(stateRef.current, owner.key, owner.scope);
  }, [enqueueSessionSave]);

  // saveNow 與 retrySaveCurrentState 共用同一份實作，但保留兩個名字：
  // 前者是「離開頁面前先存起來」，後者是「保存失敗後使用者按重試」。
  const saveNow = useCallback(() => saveCurrentState(), [saveCurrentState]);
  const retrySaveCurrentState = useCallback(() => saveCurrentState(), [saveCurrentState]);

  const clearSaveError = useCallback(() => {
    setLastSaveError(null);
  }, []);

  const getStateSnapshot = useCallback((): Readonly<SessionState> => stateRef.current, []);

  const getScopeKeySnapshot = useCallback(
    (): string | null => stateOwnerRef.current?.key ?? null,
    []
  );

  const commitDeletedBatch = useCallback(
    async (
      ids: readonly string[],
      expectedScopeKey?: string
    ): Promise<CommitDeletedBatchResult> => {
      const uniqueIds = sanitizeCommitIds(ids);
      if (!uniqueIds) {
        // 沒有合法 ID：完全不動 state，也不排任何保存。
        return { ok: false, committedIds: [], message: COMMIT_INVALID_IDS_MESSAGE };
      }

      const owner = stateOwnerRef.current;

      // 範圍防護要在**修改 state 之前**檢查：一旦寫下去就沒有安全的回滾方式。
      // 沒帶 expectedScopeKey 的舊呼叫端行為完全不變。
      if (expectedScopeKey !== undefined && owner?.key !== expectedScopeKey) {
        return { ok: false, committedIds: [], message: COMMIT_SCOPE_MISMATCH_MESSAGE };
      }
      // 沿用既有的 removeDeletedIds 語意：discardedIds 與 history 移除、
      // deletedIds 以 Set 去重併入、keptIds 完全不動。
      const nextState = removeDeletedIds(stateRef.current, uniqueIds);

      // 先同步更新 ref 再 setState：下一批會立刻以這份 next state 為基準，
      // 不需要等 React render 完成。
      applyState(nextState);

      if (!owner) {
        return { ok: false, committedIds: uniqueIds, message: SESSION_NOT_READY_MESSAGE };
      }

      const result = await enqueueSessionSave(nextState, owner.key, owner.scope);
      if (result.ok) {
        return { ok: true, committedIds: uniqueIds };
      }

      // 刻意不回滾：照片已經被 iPhone 刪掉了，記憶體 state 必須說實話。
      // 呼叫端看到 ok:false 就應該停止後續批次。
      return { ok: false, committedIds: uniqueIds, message: result.message };
    },
    [applyState, enqueueSessionSave]
  );

  return {
    state,
    ready,
    cursorIndex,
    keptCount: state.keptIds.length,
    discardedCount: state.discardedIds.length,
    deletedCount: state.deletedIds.length,
    processedCount: countProcessed(state),
    sessionTotalEstimate: state.sessionTotalEstimate,
    scope,
    canUndo: state.history.length > 0,
    lastSaveError,
    decide,
    undo,
    keepInstead,
    forget,
    removeDeleted,
    reset,
    saveNow,
    retrySaveCurrentState,
    clearSaveError,
    getStateSnapshot,
    getScopeKeySnapshot,
    commitDeletedBatch,
  };
}
