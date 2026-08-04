/**
 * Phase 4A：全專案唯一允許呼叫 MediaLibrary.deleteAssetsAsync 的模組。
 *
 * 規則：
 * - 呼叫端（Review 頁）不得直接接觸 MediaLibrary。
 * - 一次最多 MAX_TEST_DELETE_COUNT 張，服務層自己也會再擋一次，
 *   即使 UI 條件被繞過也不可能大量刪除。
 * - 只呼叫一次 deleteAssetsAsync，避免連續彈出多個 iOS 系統確認視窗。
 * - 只有嚴格 === true 才算成功，其餘一律不動任何資料。
 *
 * iOS 行為（SDK 54）：成功 resolve true；失敗與「使用者在系統視窗取消」
 * 都會 reject（RemoveAssetsException），所以取消要靠錯誤內容判斷。
 */
import { deleteAssetsAsync } from 'expo-media-library';

import { describeError } from '@/lib/photos';

/** Phase 4A 安全上限。 */
export const MAX_TEST_DELETE_COUNT = 5;

export type DeleteOutcome =
  /** iOS 回報成功刪除。 */
  | { status: 'deleted'; ids: string[] }
  /** 使用者在系統確認視窗取消。 */
  | { status: 'cancelled' }
  /** 其他失敗；一律不視為成功。 */
  | { status: 'failed'; message: string };

/**
 * PhotoKit 的使用者取消是 PHPhotosError.userCancelled（3072）。
 * Expo 只把 localizedDescription 包成字串，所以這裡用內容特徵判斷。
 * 判斷錯只會影響顯示文字 —— 兩條路徑都完全不修改任何資料。
 */
function looksCancelled(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  return /3072|cancel/i.test(message) || message.includes('取消');
}

export async function deletePhotoAssetsAsync(ids: string[]): Promise<DeleteOutcome> {
  const unique = Array.from(new Set(ids));

  if (unique.length === 0) {
    return { status: 'failed', message: '沒有可刪除的照片，照片清單沒有變更' };
  }
  if (unique.length > MAX_TEST_DELETE_COUNT) {
    return {
      status: 'failed',
      message: `每次最多刪除 ${MAX_TEST_DELETE_COUNT} 張照片，照片清單沒有變更`,
    };
  }

  try {
    // 唯一一次呼叫。
    const result = await deleteAssetsAsync(unique);
    if (result === true) {
      return { status: 'deleted', ids: unique };
    }
    return { status: 'failed', message: '刪除未完成，照片清單沒有變更' };
  } catch (cause) {
    if (looksCancelled(cause)) {
      return { status: 'cancelled' };
    }
    return { status: 'failed', message: describeError(cause, '刪除未完成，照片清單沒有變更') };
  }
}
