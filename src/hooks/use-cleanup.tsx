/**
 * 把權限、分頁與整理進度提升到 root layout 共用。
 *
 * 這樣照片整理頁與待刪除確認頁看到的是同一份記憶體狀態：
 * 在兩頁之間來回不會重新讀取相簿，也不可能清掉整理進度。
 */
import { createContext, useContext, type ReactNode } from 'react';

import { useCleanupSession, type CleanupSession } from '@/hooks/use-cleanup-session';
import {
  usePhotoAccess,
  usePhotoPager,
  type PhotoAccessController,
  type PhotoPager,
} from '@/hooks/use-photo-library';

export type CleanupContextValue = {
  access: PhotoAccessController;
  /** 是否已取得可讀取相簿的權限（完整或有限）。 */
  granted: boolean;
  pager: PhotoPager;
  session: CleanupSession;
};

const CleanupContext = createContext<CleanupContextValue | null>(null);

export function CleanupProvider({ children }: { children: ReactNode }) {
  const access = usePhotoAccess();
  const level = access.access?.level;
  const granted = level === 'full' || level === 'limited';

  // 掛載時只查詢權限、不請求，所以這裡不會讓 App 啟動就跳出對話框。
  const pager = usePhotoPager(granted);
  const session = useCleanupSession(pager.photos, granted, pager.totalCount);

  return (
    <CleanupContext.Provider value={{ access, granted, pager, session }}>
      {children}
    </CleanupContext.Provider>
  );
}

export function useCleanup(): CleanupContextValue {
  const value = useContext(CleanupContext);
  if (!value) {
    throw new Error('useCleanup 必須在 CleanupProvider 內使用');
  }
  return value;
}
