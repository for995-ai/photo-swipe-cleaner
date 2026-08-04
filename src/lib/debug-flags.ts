/**
 * 人工測試用的故障注入旗標。
 *
 * 全部預設關閉，且每個注入點都包在 `if (__DEV__)` 裡，
 * production bundle 會把這些分支整段移除，不會影響正式行為。
 *
 * 使用方式：在開發機直接改下面的值，存檔後 Fast Refresh 生效；測完記得改回預設值。
 * 這是為了取代「關 Wi-Fi／停掉 Metro」這種會連帶弄壞其他東西的測試方式。
 */
export const DEBUG_FLAGS = {
  /**
   * 大於 0 時，第 N 次之後的 getAssetInfoAsync 查詢一律失敗。
   * 例如設 0 → 第一次查詢就失敗，可觀察「重查權限 → 重試一次 → 標記無法取得」。
   * 設 -1 代表停用（預設）。
   */
  DEBUG_FAIL_ASSET_INFO_AFTER: -1,

  /** true 時，下一次載入分頁（loadMore）會失敗一次，之後自動恢復正常。 */
  DEBUG_FAIL_LOAD_MORE_ONCE: false,
};

let assetInfoCalls = 0;

/** getAssetInfoAsync 的注入點。非 __DEV__ 時整段不存在。 */
export function maybeFailAssetInfo(id: string): void {
  if (__DEV__) {
    const limit = DEBUG_FLAGS.DEBUG_FAIL_ASSET_INFO_AFTER;
    if (limit >= 0) {
      assetInfoCalls += 1;
      if (assetInfoCalls > limit) {
        throw new Error(`[DEBUG] 注入 getAssetInfoAsync 失敗（第 ${assetInfoCalls} 次，id=${id}）`);
      }
    }
  }
}

/** loadMore 的注入點，只失敗一次。非 __DEV__ 時整段不存在。 */
export function maybeFailLoadMore(): void {
  if (__DEV__) {
    if (DEBUG_FLAGS.DEBUG_FAIL_LOAD_MORE_ONCE) {
      DEBUG_FLAGS.DEBUG_FAIL_LOAD_MORE_ONCE = false;
      throw new Error('[DEBUG] 注入 loadMore 失敗一次');
    }
  }
}

/** 重設注入計數，方便反覆測試。 */
export function resetDebugCounters(): void {
  if (__DEV__) {
    assetInfoCalls = 0;
  }
}
