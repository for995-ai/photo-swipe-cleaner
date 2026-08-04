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
import { useAlbumAvailability, type AlbumAvailability } from '@/hooks/use-album-availability';
import { useScopeSelection, type ScopeController } from '@/hooks/use-scope';

export type CleanupContextValue = {
  access: PhotoAccessController;
  /** 是否已取得可讀取相簿的權限（完整或有限）。 */
  granted: boolean;
  /** 目前選擇的整理範圍。 */
  scopeController: ScopeController;
  /** 「指定相簿」範圍的相簿是否還在。 */
  albumAvailability: AlbumAvailability;
  pager: PhotoPager;
  session: CleanupSession;
};

const CleanupContext = createContext<CleanupContextValue | null>(null);

export function CleanupProvider({ children }: { children: ReactNode }) {
  const access = usePhotoAccess();
  const level = access.access?.level;
  const granted = level === 'full' || level === 'limited';

  const scopeController = useScopeSelection();

  // 掛載時只查詢權限、不請求，所以這裡不會讓 App 啟動就跳出對話框。
  //
  // pager 需要三個條件都成立才會查詢相簿：
  // 有讀取權限、範圍已從本機還原、且使用者這一輪已在範圍頁選定範圍。
  // 少了任何一項就完全不呼叫 getAssetsAsync。
  const activated = granted && scopeController.ready && scopeController.activated;

  // 「指定相簿」要先確認相簿還在才查詢。
  // iOS 在 album id 找不到時會靜默退化成「整個相簿」，
  // 所以驗證通過前絕對不能讓 pager 開始讀取，否則會顯示錯誤範圍的照片。
  const albumAvailability = useAlbumAvailability(scopeController.scope, activated);
  // 白名單而非黑名單：只有這兩個狀態放行，
  // checking／missing／unknown／unknown-limited 一律讓 pager 停用。
  // 日後若新增狀態，預設也是「不查詢」這一邊。
  const albumReady =
    albumAvailability.status === 'not-applicable' || albumAvailability.status === 'available';

  const pagerEnabled = activated && albumReady;

  // Session 只讀 AsyncStorage、不碰相簿，所以不需要等 activated：
  // 範圍頁要靠它判斷「目前範圍是否已有進度」才能在切換前提醒。
  const sessionEnabled = granted && scopeController.ready;

  const pager = usePhotoPager(pagerEnabled, scopeController.scope);
  const session = useCleanupSession(
    pager.photos,
    sessionEnabled,
    pager.totalCount,
    scopeController.scope
  );

  return (
    <CleanupContext.Provider
      value={{ access, granted, scopeController, albumAvailability, pager, session }}>
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
