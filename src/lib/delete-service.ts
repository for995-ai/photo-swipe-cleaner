/**
 * 全專案唯一允許呼叫 MediaLibrary.deleteAssetsAsync 的模組。
 *
 * 規則：
 * - 呼叫端（Review 頁）不得直接接觸 MediaLibrary。
 * - **不設張數上限**：使用者選多少就一次送多少。Beta 0.5 起 App 不再自行分批，
 *   因為每一次 deleteAssetsAsync 都會讓 iOS 彈出一次系統確認視窗，分批等於
 *   逼使用者確認多次，而且系統視窗造成的 AppState 變化會讓多批流程無法自動接續。
 * - 只呼叫一次 deleteAssetsAsync，所以 iPhone 只會要求一次確認。
 * - 只有嚴格 === true 才算成功，其餘一律不動任何資料。
 *
 * iOS 行為（SDK 54）：成功 resolve true；失敗與「使用者在系統視窗取消」
 * 都會 reject（RemoveAssetsException），所以取消要靠錯誤內容判斷。
 */
import { deleteAssetsAsync } from 'expo-media-library';

import { describeError } from '@/lib/photos';

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

export async function deletePhotoAssetsAsync(ids: readonly string[]): Promise<DeleteOutcome> {
  if (!Array.isArray(ids)) {
    return { status: 'failed', message: '沒有可刪除的照片，照片清單沒有變更' };
  }

  // 穩定去重：保留第一次出現的順序，不排序、不修改呼叫端的陣列。
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    // 空字串或只有空白的 ID 不可能是有效的 PhotoKit local identifier。
    if (typeof id !== 'string' || id.trim().length === 0) {
      return { status: 'failed', message: '待刪除清單有無效項目，照片清單沒有變更' };
    }
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }

  if (unique.length === 0) {
    return { status: 'failed', message: '沒有可刪除的照片，照片清單沒有變更' };
  }

  try {
    // 唯一一次呼叫，一次送出全部照片 —— iPhone 只會要求一次系統確認。
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
