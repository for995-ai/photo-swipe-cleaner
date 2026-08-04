import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_SCOPE, parseScope, type CleanupScope } from '@/lib/scope';

/** 只保存已選的整理範圍（type 與 month／albumId），不含任何照片資料。 */
const STORAGE_KEY = 'photo-swipe-cleaner/scope/v1';

export type ScopeController = {
  scope: CleanupScope;
  /** false 代表還在從本機讀取上次選的範圍。 */
  ready: boolean;
  /**
   * 使用者這一輪是否已經在範圍頁「確定」選了範圍。
   * 只存在記憶體、不持久化：重開 App 雖然會還原上次的範圍，
   * 但仍要重新走一次「開始整理 → 確認權限 → 選範圍」才會開始查詢相簿。
   */
  activated: boolean;
  /** 本機確實存有上次使用的範圍（不是第一次使用的預設值）。 */
  restored: boolean;
  select: (next: CleanupScope) => void;
  /** 停用目前範圍（例如相簿已無法存取），不會清掉該範圍已保存的進度。 */
  deactivate: () => void;
  /** 給範圍頁顯示的一次性提示。 */
  notice: string | null;
  raiseNotice: (message: string) => void;
  clearNotice: () => void;
};

/** 記住使用者上次選的整理範圍，重開 App 可以直接接續。 */
export function useScopeSelection(): ScopeController {
  const [scope, setScope] = useState<CleanupScope>(DEFAULT_SCOPE);
  const [ready, setReady] = useState(false);
  const [activated, setActivated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!alive.current) {
          return;
        }
        if (raw) {
          try {
            const saved = parseScope(JSON.parse(raw));
            if (saved) {
              setScope(saved);
              setRestored(true);
            }
          } catch {
            // 格式壞掉就用預設範圍，不要卡住流程。
          }
        }
        setReady(true);
      })
      .catch(() => {
        if (alive.current) {
          setReady(true);
        }
      });
  }, []);

  const select = useCallback((next: CleanupScope) => {
    setScope(next);
    // 只有使用者主動選定後才允許開始查詢相簿。
    setActivated(true);
    setRestored(true);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  /**
   * 停用目前範圍。
   * 刻意「不」清掉已保存的範圍與該範圍的 Session：
   * 相簿日後恢復可用時，之前的整理紀錄還在。
   */
  const deactivate = useCallback(() => setActivated(false), []);

  const raiseNotice = useCallback((message: string) => setNotice(message), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    scope,
    ready,
    activated,
    restored,
    select,
    deactivate,
    notice,
    raiseNotice,
    clearNotice,
  };
}
