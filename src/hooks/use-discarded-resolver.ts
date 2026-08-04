import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  addPhotoLibraryListener,
  getPhotoAccessAsync,
  resolvePhotoByIdAsync,
  type LibraryChange,
  type RecentPhoto,
} from '@/lib/photos';

/** 最多同時 4 個查詢，不要一次 Promise.all 幾百筆。 */
const RESOLVE_CONCURRENCY = 4;

type ResolveOutcome =
  | { status: 'resolved'; photo: RecentPhoto }
  | { status: 'unavailable' }
  /** 權限在查詢途中失效：不能把它當成「資產不存在」。 */
  | { status: 'permission-lost' };

/**
 * 查一個 ID。失敗時先重新檢查相簿權限，再重試一次；
 * 第二次仍失敗才視為無法取得。
 */
async function resolveOnce(id: string): Promise<ResolveOutcome> {
  try {
    const photo = await resolvePhotoByIdAsync(id);
    return photo ? { status: 'resolved', photo } : { status: 'unavailable' };
  } catch {
    const access = await getPhotoAccessAsync();
    if (access.level !== 'full' && access.level !== 'limited') {
      return { status: 'permission-lost' };
    }
    try {
      const photo = await resolvePhotoByIdAsync(id);
      return photo ? { status: 'resolved', photo } : { status: 'unavailable' };
    } catch {
      return { status: 'unavailable' };
    }
  }
}

export type DiscardedResolution = {
  /** 已解析、可顯示縮圖的照片，順序與 discardedIds 一致。 */
  resolved: RecentPhoto[];
  /** 尚在載入或查詢中的 ID，絕不會被自動移除。 */
  pendingIds: string[];
  /** 已明確確認無法取得的 ID。 */
  unavailableIds: string[];
  /** 是否有查詢正在進行。 */
  resolving: boolean;
  /** 權限在查詢途中失效，已暫停查詢。 */
  blocked: boolean;
  /** 重新查詢所有目前標為無法取得的 ID。 */
  retryUnavailable: () => void;
  /** 照片已被系統刪除後，把 ID 從解析快取移除。 */
  dropFromCache: (ids: string[]) => void;
};

/**
 * 把 discardedIds 解析成「可顯示／解析中／無法取得」三態。
 *
 * 先用 pager 已載入的照片對照，剩下的才按 ID 逐筆查詢，
 * 因此不需要為了驗證少數遺失的 ID 而把整個相簿分頁讀完。
 */
export function useDiscardedResolver({
  discardedIds,
  loadedPhotos,
  enabled,
  pagerBusy,
  onFullReloadNeeded,
}: {
  discardedIds: string[];
  loadedPhotos: RecentPhoto[];
  enabled: boolean;
  /** pager 還在載入時先不查詢，讓自然分頁去填。 */
  pagerBusy: boolean;
  onFullReloadNeeded: () => void;
}): DiscardedResolution {
  const [extra, setExtra] = useState<Map<string, RecentPhoto>>(() => new Map());
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());
  const [resolving, setResolving] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const draining = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadedById = useMemo(
    () => new Map(loadedPhotos.map((photo) => [photo.id, photo])),
    [loadedPhotos]
  );

  useEffect(() => {
    if (!enabled || pagerBusy || blocked || draining.current) {
      return;
    }

    const queue = discardedIds.filter(
      (id) => !loadedById.has(id) && !extra.has(id) && !unavailable.has(id)
    );
    if (queue.length === 0) {
      return;
    }

    draining.current = true;
    setResolving(true);

    let cursor = 0;
    const worker = async () => {
      while (alive.current) {
        const index = cursor;
        cursor += 1;
        if (index >= queue.length) {
          return;
        }

        const id = queue[index];
        const outcome = await resolveOnce(id);
        if (!alive.current) {
          return;
        }

        if (outcome.status === 'resolved') {
          setExtra((current) => new Map(current).set(id, outcome.photo));
        } else if (outcome.status === 'unavailable') {
          setUnavailable((current) => new Set(current).add(id));
        } else {
          // 權限失效：保持解析中並停下來，等權限恢復或使用者手動重試。
          setBlocked(true);
          return;
        }
      }
    };

    void Promise.all(Array.from({ length: RESOLVE_CONCURRENCY }, () => worker())).finally(() => {
      draining.current = false;
      if (alive.current) {
        setResolving(false);
      }
    });
    // extra／unavailable 變動會讓這個 effect 再跑一次，把剩下的 ID 收乾。
  }, [enabled, pagerBusy, blocked, discardedIds, loadedById, extra, unavailable]);

  // 相簿變動監聽；unmount 時移除。
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handle = (change: LibraryChange) => {
      if (!change.hasIncrementalChanges) {
        // 變動範圍太大（例如使用者改了有限存取的選取範圍）。
        // 重新載入相簿 metadata 並清掉解析快取，但完全不動任何決策 ID。
        setExtra(new Map());
        setUnavailable(new Set());
        setBlocked(false);
        onFullReloadNeeded();
        return;
      }

      if (change.deletedIds.length > 0) {
        const deleted = new Set(change.deletedIds);
        setExtra((current) => {
          const next = new Map(current);
          for (const id of deleted) {
            next.delete(id);
          }
          return next;
        });
        setUnavailable((current) => {
          const next = new Set(current);
          for (const id of deleted) {
            next.add(id);
          }
          return next;
        });
      }

      // 更新過的資產（例如剛完成 iCloud 下載）給它一次重新查詢的機會。
      // 新增的資產不需要任何處理，更不會清掉既有進度。
      if (change.updatedIds.length > 0) {
        const updated = new Set(change.updatedIds);
        setUnavailable((current) => {
          if (![...updated].some((id) => current.has(id))) {
            return current;
          }
          const next = new Set(current);
          for (const id of updated) {
            next.delete(id);
          }
          return next;
        });
      }
    };

    const subscription = addPhotoLibraryListener(handle);
    return () => subscription.remove();
  }, [enabled, onFullReloadNeeded]);

  const retryUnavailable = useCallback(() => {
    setUnavailable(new Set());
    setBlocked(false);
  }, []);

  const dropFromCache = useCallback((ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    const drop = new Set(ids);
    setExtra((current) => {
      const next = new Map(current);
      for (const id of drop) {
        next.delete(id);
      }
      return next;
    });
    setUnavailable((current) => {
      const next = new Set(current);
      for (const id of drop) {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const resolution = useMemo(() => {
    const resolved: RecentPhoto[] = [];
    const pendingIds: string[] = [];
    const unavailableIds: string[] = [];

    for (const id of discardedIds) {
      const photo = loadedById.get(id) ?? extra.get(id);
      if (photo) {
        resolved.push(photo);
      } else if (unavailable.has(id)) {
        unavailableIds.push(id);
      } else {
        pendingIds.push(id);
      }
    }

    return { resolved, pendingIds, unavailableIds };
  }, [discardedIds, loadedById, extra, unavailable]);

  return { ...resolution, resolving, blocked, retryUnavailable, dropFromCache };
}
