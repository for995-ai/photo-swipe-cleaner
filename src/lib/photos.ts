/**
 * 相簿權限與照片讀取的唯一入口（Expo SDK 54 的 expo-media-library API）。
 *
 * 設計原則：
 * - 只有 requestPhotoAccessAsync() 會讓 iOS 彈出系統權限對話框，
 *   其餘查詢一律使用 getPermissionsAsync()，不會打擾使用者。
 * - getAssetsAsync() 回傳的 uri 是 ph:// 參照，交給 expo-image 依容器尺寸載入。
 * - getAssetInfoAsync() 只用於「按 ID 查單張」的唯讀查詢，且一律明確帶入
 *   shouldDownloadFromNetwork: false（預設是 true）以避免下載 iCloud 原始資產；
 *   回傳值只取 ph:// 的 uri 與尺寸／時間，刻意不使用 localUri，不觸碰原始檔。
 * - 本檔案刻意不 import 任何刪除或修改相簿的 API。
 */
import * as Linking from 'expo-linking';
import {
  MediaType,
  PermissionStatus,
  SortBy,
  addListener,
  getAssetInfoAsync,
  getAssetsAsync,
  getPermissionsAsync,
  presentPermissionsPickerAsync,
  requestPermissionsAsync,
  type PermissionResponse,
} from 'expo-media-library';

import { maybeFailAssetInfo, maybeFailLoadMore } from '@/lib/debug-flags';

/** 每頁讀取的照片數。整個相簿靠分頁逐批取得，不會一次載入全部。 */
export const PHOTO_PAGE_SIZE = 60;

export type PhotoAccessLevel =
  /** 尚未詢問過使用者。 */
  | 'undetermined'
  /** 完整存取整個相簿。 */
  | 'full'
  /** 有限存取：使用者只挑選了部分照片。 */
  | 'limited'
  /** 拒絕，或被系統／家長控管限制。 */
  | 'denied';

export type PhotoAccess = {
  level: PhotoAccessLevel;
  /** false 代表系統不會再彈出對話框，只能前往「設定」調整。 */
  canAskAgain: boolean;
};

export type RecentPhoto = {
  id: string;
  /**
   * iOS 為 ph:// URI。交給 expo-image 後，它會依容器尺寸向 PHImageManager
   * 要求剛好夠用的解析度，不會載入原始大圖。
   */
  uri: string;
  width: number | null;
  height: number | null;
  /** 相簿不一定有建立時間，缺失時為 null。 */
  createdAt: number | null;
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function toPhotoAccess(response: PermissionResponse): PhotoAccess {
  const canAskAgain = response.canAskAgain;

  if (response.status === PermissionStatus.UNDETERMINED) {
    return { level: 'undetermined', canAskAgain: true };
  }

  if (response.granted) {
    // accessPrivileges 只有 iOS 14+／Android 14+ 會提供，其餘平台視為完整存取。
    return {
      level: response.accessPrivileges === 'limited' ? 'limited' : 'full',
      canAskAgain,
    };
  }

  // 使用者拒絕，或 iOS 家長控管的「受限制」狀態，兩者都無法自行再次詢問。
  return { level: 'denied', canAskAgain };
}

/** 只查詢目前狀態，不會彈出系統權限對話框。 */
export async function getPhotoAccessAsync(): Promise<PhotoAccess> {
  return toPhotoAccess(await getPermissionsAsync());
}

/** 由使用者主動按下按鈕後才呼叫，這是唯一會彈出系統對話框的函式。 */
export async function requestPhotoAccessAsync(): Promise<PhotoAccess> {
  return toPhotoAccess(await requestPermissionsAsync());
}

/** 開啟系統設定，讓使用者手動開啟相簿權限。 */
export async function openSystemSettingsAsync(): Promise<void> {
  await Linking.openSettings();
}

/** 有限存取時，讓使用者追加可存取的照片（iOS 14+）。 */
export async function pickMorePhotosAsync(): Promise<void> {
  await presentPermissionsPickerAsync(['photo']);
}

export type PhotoPage = {
  photos: RecentPhoto[];
  /** 下一頁要用的游標；空字串代表沒有可續讀的位置。 */
  endCursor: string;
  hasNextPage: boolean;
  /** 相簿中符合條件的照片總數（系統回報的估計值）。 */
  totalCount: number;
};

/**
 * 讀取一頁照片：排除影片、依建立時間由新到舊。
 * 傳入上一頁的 endCursor 就會接著往下讀，不會重讀已取得的照片。
 */
export async function loadPhotoPageAsync(after?: string): Promise<PhotoPage> {
  if (after) {
    maybeFailLoadMore();
  }

  const page = await getAssetsAsync({
    first: PHOTO_PAGE_SIZE,
    // 只取照片，影片與其他媒體都不會進來。
    mediaType: [MediaType.photo],
    // 第二個元素 false 代表遞減，也就是由新到舊。
    sortBy: [[SortBy.creationTime, false]],
    ...(after ? { after } : {}),
  });

  return {
    photos: page.assets.map((asset) => ({
      id: asset.id,
      uri: asset.uri,
      width: normalizeDimension(asset.width),
      height: normalizeDimension(asset.height),
      createdAt: normalizeCreationTime(asset.creationTime),
    })),
    endCursor: page.endCursor ?? '',
    hasNextPage: page.hasNextPage,
    totalCount: page.totalCount,
  };
}

/**
 * 按 ID 查單張照片（唯讀）。用於確認尚未載入的 ID 是否仍存在，
 * 不需要為此把整個相簿的分頁讀完。
 *
 * shouldDownloadFromNetwork 必須明確給 false：預設值是 true，會為了取得
 * localUri 而下載 iCloud 原始資產。這裡只需要 ph:// 參照，所以一律關掉。
 *
 * 找不到資產時回傳 null；查詢本身失敗會 throw，交由呼叫端決定是否重試。
 */
export async function resolvePhotoByIdAsync(id: string): Promise<RecentPhoto | null> {
  maybeFailAssetInfo(id);

  const info = await getAssetInfoAsync(id, { shouldDownloadFromNetwork: false });
  if (!info || typeof info.id !== 'string' || typeof info.uri !== 'string' || !info.uri) {
    return null;
  }

  // isNetworkAsset 為 true（照片只存在 iCloud）仍算有效資產：
  // 這裡不下載原始檔，顯示時交給 expo-image 用 ph:// 取需要的尺寸。
  return {
    id: info.id,
    uri: info.uri,
    width: normalizeDimension(info.width),
    height: normalizeDimension(info.height),
    createdAt: normalizeCreationTime(info.creationTime),
  };
}

export type LibraryChange = {
  /** false 代表變動範圍太大，應該重新載入相簿 metadata。 */
  hasIncrementalChanges: boolean;
  insertedIds: string[];
  deletedIds: string[];
  updatedIds: string[];
};

/** 訂閱相簿變動。呼叫端必須在 unmount 時 remove()。 */
export function addPhotoLibraryListener(handler: (change: LibraryChange) => void): {
  remove: () => void;
} {
  const subscription = addListener((event) => {
    handler({
      hasIncrementalChanges: event.hasIncrementalChanges,
      insertedIds: (event.insertedAssets ?? []).map((asset) => asset.id),
      deletedIds: (event.deletedAssets ?? []).map((asset) => asset.id),
      updatedIds: (event.updatedAssets ?? []).map((asset) => asset.id),
    });
  });
  return { remove: () => subscription.remove() };
}

function normalizeDimension(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeCreationTime(creationTime: number | undefined): number | null {
  if (typeof creationTime !== 'number' || !Number.isFinite(creationTime) || creationTime <= 0) {
    return null;
  }
  return creationTime;
}

/** 照片日期缺失或無法解析時，回傳「日期不明」而不是空字串。 */
export function formatPhotoDate(createdAt: number | null): string {
  if (createdAt === null) {
    return '日期不明';
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '日期不明';
  }

  const pad = (value: number) => String(value).padStart(2, '0');
  const weekday = WEEKDAYS[date.getDay()];
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日（週${weekday}）${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 把未知的錯誤物件轉成可以直接顯示的繁體中文訊息。 */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return `${fallback}（${error.message}）`;
  }
  return fallback;
}
