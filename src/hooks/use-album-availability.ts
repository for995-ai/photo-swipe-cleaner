import { useCallback, useEffect, useRef, useState } from 'react';

import { getPhotoAccessAsync, isAlbumAvailableAsync } from '@/lib/photos';
import { scopeKey, type CleanupScope } from '@/lib/scope';

export type AlbumAvailabilityStatus =
  /** 目前範圍不是相簿，不需要檢查。 */
  | 'not-applicable'
  | 'checking'
  | 'available'
  /** 只有「完整存取」下清單裡真的找不到，才算確認不存在。 */
  | 'missing'
  /**
   * 有限存取下清單裡找不到。
   * limited 只保證能存取使用者挑選的照片，不保證 getAlbumsAsync 回傳完整清單，
   * 所以這種情況一律不得宣告相簿已刪除。
   */
  | 'unknown-limited'
  /** 查詢本身失敗，無法判定；不可當成已刪除。 */
  | 'unknown';

export type AlbumAvailability = {
  status: AlbumAvailabilityStatus;
  recheck: () => void;
};

/**
 * 檢查「指定相簿」範圍的相簿是否還在。
 *
 * 「找不到」的解讀取決於權限級別：
 * - full：清單完整，找不到就是真的不見了 → missing
 * - limited：清單可能不完整，找不到只能說無法確認 → unknown-limited
 *
 * 查詢失敗會重試一次，兩次都失敗才回 unknown，
 * 絕不會把暫時性的讀取錯誤誤判成相簿已刪除。
 */
export function useAlbumAvailability(
  scope: CleanupScope,
  enabled: boolean
): AlbumAvailability {
  const [status, setStatus] = useState<AlbumAvailabilityStatus>('not-applicable');
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const activeKey = scopeKey(scope);
  const albumId = scope.type === 'album' ? scope.albumId : null;

  useEffect(() => {
    if (albumId === null) {
      setStatus('not-applicable');
      return;
    }
    if (!enabled) {
      setStatus('checking');
      return;
    }

    let cancelled = false;
    setStatus('checking');

    const classify = async (): Promise<AlbumAvailabilityStatus> => {
      // 先確認權限級別：這決定「清單裡找不到」該怎麼解讀。
      let level: string;
      try {
        level = (await getPhotoAccessAsync()).level;
      } catch {
        return 'unknown';
      }
      if (level !== 'full' && level !== 'limited') {
        return 'unknown';
      }

      // 找不到時的結論：full 才敢說不見了，limited 只能說無法確認。
      const notFoundStatus: AlbumAvailabilityStatus =
        level === 'full' ? 'missing' : 'unknown-limited';

      try {
        return (await isAlbumAvailableAsync(albumId)) ? 'available' : notFoundStatus;
      } catch {
        // 查詢失敗給一次重試機會。
      }

      try {
        return (await isAlbumAvailableAsync(albumId)) ? 'available' : notFoundStatus;
      } catch {
        return 'unknown';
      }
    };

    void classify().then((next) => {
      if (!cancelled && alive.current) {
        setStatus(next);
      }
    });

    return () => {
      cancelled = true;
    };
    // activeKey 讓換相簿時重新檢查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId, enabled, activeKey, attempt]);

  const recheck = useCallback(() => setAttempt((value) => value + 1), []);

  return { status, recheck };
}
