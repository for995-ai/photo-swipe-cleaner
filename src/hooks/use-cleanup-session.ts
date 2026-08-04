import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RecentPhoto } from '@/lib/photos';
import {
  EMPTY_SESSION,
  applyDecision,
  clearStoredSessionAsync,
  convertToKeep,
  countDecided,
  findCursorIndex,
  forgetIds,
  loadStoredSessionAsync,
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
  decidedCount: number;
  canUndo: boolean;
  /** 滑動與底部按鈕共用的唯一決策入口。 */
  decide: (photoId: string, decision: Decision) => void;
  undo: () => void;
  /** 確認頁把待刪除改回保留。 */
  keepInstead: (photoId: string) => void;
  /** 由使用者主動處理「已確認無法取得」的 id；不可用於尚在解析中的 id。 */
  forget: (photoIds: string[]) => void;
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
export function useCleanupSession(photos: RecentPhoto[], enabled: boolean): CleanupSession {
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

    loadStoredSessionAsync().then((restored) => {
      if (!cancelled) {
        setState(restored);
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    void saveSessionAsync(state);
  }, [ready, state]);

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

  // 清空進度即等於重新開始；不重新讀取儲存，避免清除與還原互相搶。
  const reset = useCallback(() => {
    setState(EMPTY_SESSION);
    void clearStoredSessionAsync();
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;
  const saveNow = useCallback(() => saveSessionAsync(stateRef.current), []);

  return {
    state,
    ready,
    cursorIndex,
    keptCount: state.keptIds.length,
    discardedCount: state.discardedIds.length,
    decidedCount: countDecided(state),
    canUndo: state.history.length > 0,
    decide,
    undo,
    keepInstead,
    forget,
    reset,
    saveNow,
  };
}
