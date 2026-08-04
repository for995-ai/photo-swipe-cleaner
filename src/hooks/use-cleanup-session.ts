import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RecentPhoto } from '@/lib/photos';
import { scopeKey, type CleanupScope } from '@/lib/scope';
import {
  EMPTY_SESSION,
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
  type SessionState,
} from '@/lib/session';

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
  saveNow: () => Promise<void>;
};

/**
 * 管理整理進度，並在每次變動後把「只有 ID」的進度寫入本機。
 *
 * 還原只在權限開啟時做一次（或按下重新開始後再做一次），
 * 完全不依賴 photos，所以分頁追加新照片不可能重設
 * cursorIndex／keptIds／discardedIds／history。
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

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_SESSION);
      setReady(false);
      return;
    }

    let cancelled = false;
    setReady(false);

    loadStoredSessionAsync(activeScopeKey).then((restored) => {
      if (!cancelled) {
        setState(restored);
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, activeScopeKey]);

  // 分母只增不減。bumpSessionTotalEstimate 沒有變化時會回傳同一個物件，
  // setState 直接 bail out，所以把 state 放進依賴也不會無限循環。
  useEffect(() => {
    if (!ready) {
      return;
    }
    setState((current) => bumpSessionTotalEstimate(current, libraryTotal));
  }, [ready, libraryTotal, state]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    void saveSessionAsync(state, activeScopeKey, scopeRef.current);
  }, [ready, state, activeScopeKey]);

  const photoIds = useMemo(() => photos.map((photo) => photo.id), [photos]);
  const cursorIndex = useMemo(() => findCursorIndex(photoIds, state), [photoIds, state]);

  const decide = useCallback((photoId: string, decision: Decision) => {
    setState((current) => applyDecision(current, photoId, decision));
  }, []);

  const undo = useCallback(() => {
    setState((current) => undoLastDecision(current));
  }, []);

  const keepInstead = useCallback((photoId: string) => {
    setState((current) => convertToKeep(current, photoId));
  }, []);

  const forget = useCallback((photoIds: string[]) => {
    setState((current) => forgetIds(current, photoIds));
  }, []);

  const removeDeleted = useCallback((photoIds: string[]) => {
    setState((current) => removeDeletedIds(current, photoIds));
  }, []);

  // 清空進度即等於重新開始；不重新讀取儲存，避免清除與還原互相搶。
  const reset = useCallback(() => {
    setState(EMPTY_SESSION);
    void clearStoredSessionAsync(activeScopeKey);
  }, [activeScopeKey]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const saveNow = useCallback(
    () => saveSessionAsync(stateRef.current, activeScopeKey, scopeRef.current),
    [activeScopeKey]
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
    decide,
    undo,
    keepInstead,
    forget,
    removeDeleted,
    reset,
    saveNow,
  };
}
