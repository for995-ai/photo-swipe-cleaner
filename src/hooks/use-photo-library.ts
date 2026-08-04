import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  describeError,
  getPhotoAccessAsync,
  loadPhotoPageAsync,
  requestPhotoAccessAsync,
  type PhotoAccess,
  type PhotoPage,
  type RecentPhoto,
} from '@/lib/photos';

export type PhotoAccessController = {
  /** null 代表還在查詢中，尚未知道狀態。 */
  access: PhotoAccess | null;
  requesting: boolean;
  error: string | null;
  /** 重新查詢狀態，不會彈出系統對話框。 */
  refresh: () => Promise<void>;
  /** 只能由使用者的點擊事件觸發，會彈出系統對話框。 */
  request: () => Promise<void>;
};

/**
 * 追蹤相簿權限狀態。掛載時只「查詢」，絕不主動請求，
 * 因此 App 啟動不會自動跳出權限對話框。
 */
export function usePhotoAccess(): PhotoAccessController {
  const [access, setAccess] = useState<PhotoAccess | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await getPhotoAccessAsync();
      if (mounted.current) {
        setAccess(next);
        setError(null);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(describeError(cause, '無法讀取相簿權限狀態'));
      }
    }
  }, []);

  const request = useCallback(async () => {
    setRequesting(true);
    try {
      const next = await requestPhotoAccessAsync();
      if (mounted.current) {
        setAccess(next);
        setError(null);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(describeError(cause, '請求相簿權限失敗'));
      }
    } finally {
      if (mounted.current) {
        setRequesting(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();

    // 使用者可能到「設定」改了權限再切回來，回前景時重新查詢一次。
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  return { access, requesting, error, refresh, request };
}

/** 距離已載入陣列尾端剩幾張時就預先載入下一頁。 */
export const PREFETCH_THRESHOLD = 10;

export type PhotoPager = {
  /** 目前已載入的照片，依建立時間由新到舊，永遠只追加不覆蓋。 */
  photos: RecentPhoto[];
  /** 相簿回報的照片總數；有限存取時就是獲准的張數。 */
  totalCount: number;
  hasNextPage: boolean;
  loadingFirstPage: boolean;
  isLoadingMore: boolean;
  /** 第一頁就失敗（會擋住整理流程）。 */
  error: string | null;
  /** 載入後續分頁失敗（不擋目前的照片操作）。 */
  loadMoreError: string | null;
  loadMore: () => void;
  retryLoadMore: () => void;
  reload: () => void;
};

/**
 * 分頁讀取整個已授權的相簿。
 * 同一時間只允許一個請求在飛，且 hasNextPage 為 false 後不再發出請求。
 */
export function usePhotoPager(enabled: boolean): PhotoPager {
  const [photos, setPhotos] = useState<RecentPhoto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingFirstPage, setLoadingFirstPage] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const cursor = useRef<string | null>(null);
  /** 單一 in-flight 旗標：擋掉重複的 loadMore。 */
  const inFlight = useRef(false);
  /** 已見過的照片 id，用來去除重複項目。 */
  const seenIds = useRef<Set<string>>(new Set());
  /** hasNextPage 的同步鏡射，供事件回呼即時判斷。 */
  const moreAvailable = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 把一頁的結果追加到現有陣列，不覆蓋。 */
  const appendPage = useCallback((page: PhotoPage) => {
    const fresh = page.photos.filter((photo) => !seenIds.current.has(photo.id));
    for (const photo of fresh) {
      seenIds.current.add(photo.id);
    }

    if (fresh.length > 0) {
      setPhotos((current) => [...current, ...fresh]);
    }
    setTotalCount(page.totalCount);
    cursor.current = page.endCursor || null;

    // 沒有游標或這頁全是重複項目時就收尾，避免游標卡住造成無限請求。
    const more = page.hasNextPage && fresh.length > 0 && !!page.endCursor;
    moreAvailable.current = more;
    setHasNextPage(more);
  }, []);

  useEffect(() => {
    // 換一個 generation（或權限變動）就重置分頁狀態。
    cursor.current = null;
    inFlight.current = false;
    seenIds.current = new Set();
    moreAvailable.current = false;
    setPhotos([]);
    setTotalCount(0);
    setHasNextPage(false);
    setIsLoadingMore(false);
    setError(null);
    setLoadMoreError(null);

    if (!enabled) {
      setLoadingFirstPage(false);
      return;
    }

    let cancelled = false;
    setLoadingFirstPage(true);
    inFlight.current = true;

    loadPhotoPageAsync()
      .then((page) => {
        if (!cancelled) {
          appendPage(page);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(describeError(cause, '讀取相簿失敗'));
        }
      })
      .finally(() => {
        inFlight.current = false;
        if (!cancelled) {
          setLoadingFirstPage(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, generation, appendPage]);

  const loadMore = useCallback(() => {
    if (!enabled || inFlight.current || !moreAvailable.current || !cursor.current) {
      return;
    }

    inFlight.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    loadPhotoPageAsync(cursor.current)
      .then((page) => {
        if (alive.current) {
          appendPage(page);
        }
      })
      .catch((cause: unknown) => {
        if (alive.current) {
          // 停下自動載入，避免失敗後不斷重試；使用者可以手動重試。
          moreAvailable.current = false;
          setHasNextPage(false);
          setLoadMoreError(describeError(cause, '載入更多照片失敗'));
        }
      })
      .finally(() => {
        inFlight.current = false;
        if (alive.current) {
          setIsLoadingMore(false);
        }
      });
  }, [enabled, appendPage]);

  /** 分頁失敗後由使用者手動重試；游標還在，所以可以從斷點續讀。 */
  const retryLoadMore = useCallback(() => {
    if (inFlight.current || !cursor.current) {
      return;
    }
    moreAvailable.current = true;
    setHasNextPage(true);
    setLoadMoreError(null);
    loadMore();
  }, [loadMore]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  return {
    photos,
    totalCount,
    hasNextPage,
    loadingFirstPage,
    isLoadingMore,
    error,
    loadMoreError,
    loadMore,
    retryLoadMore,
    reload,
  };
}
