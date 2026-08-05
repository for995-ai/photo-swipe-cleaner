/**
 * 分批刪除的「規劃」與「彙總」純邏輯。
 *
 * 這個檔案刻意保持零依賴：不 import React、React Native、Expo、AsyncStorage，
 * 也不 import delete-service。原因有兩個：
 * - 可以在純 Node 環境直接驗證，不必啟動 App 或模擬器
 * - 批次規劃只是「決定要刪哪些、分幾次」的算術，本身不該有能力真的刪掉任何東西
 *
 * 因此本檔完全沒有副作用：不寫入儲存、不呼叫相簿 API、不修改任何輸入陣列。
 *
 * 批次大小一律由呼叫端傳入，本檔不硬編碼任何數字。未來 Review 會傳入
 * delete-service 的 MAX_DELETE_COUNT_PER_BATCH，而「單批不得超過上限」的
 * 最後一道防線仍然留在 delete-service 自己身上——這裡算錯也不可能繞過它。
 */

/**
 * 索引慣例（全檔一致）：
 * - `batchIndex`：內部用，**0-based**。第一批是 0。
 * - `batchNumber`：顯示用，**1-based**。第一批是 1，可直接填進「第 X / M 批」。
 * - `batchIndex === -1` 是保留值，代表「一批都還沒開始」或「沒有東西可刪」。
 */

/**
 * 輸入驗證策略（兩種，刻意不同）：
 *
 * 1. 建立計畫的路徑（`dedupeIdsInOrder`／`planDeleteBatches`）→ **拋錯**。
 *    照片 ID 理論上一定是非空字串，批次大小一定是正整數。這裡收到壞資料
 *    代表上游已經壞了；靜默吞掉只會讓問題延後到真正呼叫刪除 API 的地方才爆，
 *    那時候的風險高得多。
 *
 * 2. 回報的路徑（`calculateBatchProgress`／`summarizeBatchRun`）→ **過濾與夾範圍**，不拋錯。
 *    `calculateBatchProgress` 會在畫面 render 期間被呼叫，拋錯會直接白屏；
 *    `summarizeBatchRun` 是在照片「已經被刪掉之後」才呼叫的，此時拋錯會讓我們
 *    連「刪了哪些」都回報不出來，比一個怪數字危險太多。
 *    而且這兩個函式的職責本來就是「只承認計畫內的 ID」，過濾就是正確行為。
 */

/** 一次分批刪除的完整計畫。建立之後不再變動。 */
export type DeleteBatchPlan = {
  /** 去重後、保持原始待刪順序的完整 ID 清單。 */
  orderedUniqueIds: string[];
  /** 依序切好的批次；每批長度都 > 0 且 <= batchSize。0 張時為空陣列。 */
  batches: string[][];
  /** = orderedUniqueIds.length，也就是去重後的張數（不是輸入長度）。 */
  totalIds: number;
  /** = batches.length。 */
  totalBatches: number;
  /** 建立這份計畫時採用的單批上限。 */
  batchSize: number;
};

/**
 * 為什麼停下來。
 *
 * `done` 以外的每一個原因都代表「後續批次一律不再執行」：
 * 不自動重試、不自動跳過、不自動繼續。要繼續必須由使用者重新發起。
 */
export type BatchStopReason =
  /** 所有批次都跑完了。 */
  | 'done'
  /** 使用者在 iPhone 系統確認視窗按了取消。 */
  | 'cancelled'
  /** 某一批刪除失敗（含權限在中途失效）。 */
  | 'failed'
  /** 進度保存失敗；停下來以免 App 重開後重複刪除同一批。 */
  | 'persistence-failed'
  /** App 離開前景；不在背景啟動新的批次。 */
  | 'app-backgrounded';

/**
 * 整趟分批刪除的結果。
 *
 * `partially-completed` 只代表「跨批次部分完成」，例如 4 批裡成功了 2 批。
 * 它**不**代表單次 deleteAssetsAsync 能回報「這 20 張裡成功 13 張」：
 * iOS 只回傳一個 boolean，單一批次永遠是全成功或全不成功。
 */
export type BatchRunOutcome = 'completed' | 'partially-completed' | 'nothing-deleted';

/** 一趟分批刪除跑完（或中途停止）後的彙總結果。 */
export type BatchRunSummary = {
  outcome: BatchRunOutcome;
  /** 已確認刪除成功、且存在於計畫內的 ID；去重並依計畫順序排列。 */
  successfulIds: string[];
  /** 尚未刪除、仍應留在待刪清單的 ID；依計畫順序排列。 */
  remainingIds: string[];
  stoppedReason: BatchStopReason;
  /** 停在第幾批（0-based）。-1 代表一批都沒開始。 */
  stoppedAtBatchIndex: number;
  /** 給使用者看的補充說明；沒有就是 null。 */
  message: string | null;
};

/** 分批刪除進行中的顯示用進度。純粹由計畫與成功清單推導，不自己記狀態。 */
export type BatchProgress = {
  /** 正在處理第幾批（0-based）。-1 代表尚未開始或沒有東西可刪。 */
  currentBatchIndex: number;
  /** 顯示用批號（1-based）。沒有進行中的批次時為 0。 */
  currentBatchNumber: number;
  totalBatches: number;
  /** 這一批有幾張。沒有進行中的批次時為 0。 */
  currentBatchSize: number;
  /** 已成功刪除幾張（去重、且只計算計畫內的 ID）。 */
  successfulCount: number;
  /**
   * 還有幾張沒處理。
   * 一律用 orderedUniqueIds 扣掉成功數算出來，不用「批號 × batchSize」去猜——
   * 那種算法在最後一批不足量、或某批被跳過時都會算錯。
   */
  remainingCount: number;
};

/**
 * 照片 ID 必須是非空字串。
 *
 * 只有空白的字串也視為無效：PhotoKit 不可能給出這種 ID，
 * 而它一旦混進批次就會變成一次無意義的刪除請求。
 * 這裡不 trim 也不改寫傳進來的值，只負責判斷合不合格。
 */
function assertValidId(value: unknown, index: number): string {
  if (typeof value !== 'string') {
    throw new TypeError(`照片 ID 必須是字串，第 ${index} 筆收到 ${typeof value}`);
  }
  if (value.trim().length === 0) {
    throw new TypeError(`照片 ID 不可為空字串或只有空白，第 ${index} 筆不合格`);
  }
  return value;
}

/**
 * 批次大小必須是大於 0 的整數。
 *
 * 刻意不設上限：上限屬於 delete-service 的職責（目前是 20），
 * 在這裡再寫一個數字只會出現兩個真相來源。
 */
function assertValidBatchSize(batchSize: number): void {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError(`batchSize 必須是大於 0 的整數，收到 ${String(batchSize)}`);
  }
}

/**
 * 穩定去重：保留每個 ID 第一次出現的位置，不排序、不修改輸入。
 *
 * 順序很重要——它就是使用者當初左滑的順序，Review 的縮圖網格與
 * 刪除批次都依賴它，所以這裡絕對不能為了去重而重排。
 */
export function dedupeIdsInOrder(ids: readonly string[]): string[] {
  if (!Array.isArray(ids)) {
    throw new TypeError('ids 必須是陣列');
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (let index = 0; index < ids.length; index += 1) {
    const id = assertValidId(ids[index], index);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result;
}

/**
 * 把待刪 ID 切成依序執行的批次。
 *
 * 先去重再切片，所以同一個 ID 不可能落在兩個批次裡。
 * 迴圈條件保證每一批都至少有一張（start 一定小於長度），因此不會產生空批次；
 * `slice` 每次都回傳新陣列，輸入完全不受影響。
 */
export function planDeleteBatches(ids: readonly string[], batchSize: number): DeleteBatchPlan {
  assertValidBatchSize(batchSize);

  const orderedUniqueIds = dedupeIdsInOrder(ids);
  const batches: string[][] = [];

  for (let start = 0; start < orderedUniqueIds.length; start += batchSize) {
    batches.push(orderedUniqueIds.slice(start, start + batchSize));
  }

  return {
    orderedUniqueIds,
    batches,
    totalIds: orderedUniqueIds.length,
    totalBatches: batches.length,
    batchSize,
  };
}

/**
 * 數出「計畫內」且去重的成功張數。
 *
 * 迭代 orderedUniqueIds（本身已去重）而不是迭代傳進來的陣列，
 * 所以重複的成功 ID 只會被算一次，計畫外的 ID 一張都不會被算到。
 */
function countPlanMembers(plan: DeleteBatchPlan, ids: readonly string[]): number {
  const claimed = new Set(ids);
  let count = 0;
  for (const id of plan.orderedUniqueIds) {
    if (claimed.has(id)) {
      count += 1;
    }
  }
  return count;
}

/**
 * 把批號夾進合法範圍 [-1, totalBatches - 1]。
 * 空計畫只剩 -1 一個合法值。
 */
function normalizeBatchIndex(index: number, totalBatches: number): number {
  if (totalBatches === 0 || !Number.isInteger(index) || index < 0) {
    return -1;
  }
  return Math.min(index, totalBatches - 1);
}

/** 由計畫與目前成功清單推導顯示用進度。不拋錯，超出範圍的批號一律夾回來。 */
export function calculateBatchProgress({
  plan,
  currentBatchIndex,
  successfulIds,
}: {
  plan: DeleteBatchPlan;
  currentBatchIndex: number;
  successfulIds: readonly string[];
}): BatchProgress {
  const index = normalizeBatchIndex(currentBatchIndex, plan.totalBatches);
  const successfulCount = countPlanMembers(plan, successfulIds);

  return {
    currentBatchIndex: index,
    currentBatchNumber: index >= 0 ? index + 1 : 0,
    totalBatches: plan.totalBatches,
    currentBatchSize: index >= 0 ? plan.batches[index].length : 0,
    successfulCount,
    remainingCount: plan.totalIds - successfulCount,
  };
}

/**
 * 判定整趟結果。三條規則的順序不能調換：
 *
 * 1. 沒有任何成功 → `nothing-deleted`。
 *    必須排第一，否則「空計畫 + done」會被第 2 條誤判成 completed。
 * 2. 全部處理完 **而且** 是正常跑完 → `completed`。
 *    stoppedReason 不是 done 就不給 completed：沒跑完的流程不該宣稱完成。
 * 3. 其餘（有成功但沒跑完，或還有剩餘）→ `partially-completed`。
 */
function decideOutcome(
  successfulCount: number,
  remainingCount: number,
  stoppedReason: BatchStopReason
): BatchRunOutcome {
  if (successfulCount === 0) {
    return 'nothing-deleted';
  }
  if (remainingCount === 0 && stoppedReason === 'done') {
    return 'completed';
  }
  return 'partially-completed';
}

/**
 * 彙總一趟分批刪除的結果。
 *
 * 成功與剩餘兩份清單都由「單次走過 orderedUniqueIds」產生，這個作法本身就
 * 保證了三件事，不需要額外檢查：
 * - 兩份清單都是原始待刪順序
 * - 兩份清單沒有交集
 * - 兩份清單的聯集正好等於計畫的 ID（計畫外的 ID 沒有機會進入迴圈）
 *
 * 因此 successfulIds 的順序是「計畫順序」而不是呼叫端傳入的順序：
 * 這樣 successfulIds ++ remainingIds 永遠是 orderedUniqueIds 的一個穩定切分。
 */
export function summarizeBatchRun({
  plan,
  successfulIds,
  stoppedReason,
  stoppedAtBatchIndex,
  message,
}: {
  plan: DeleteBatchPlan;
  successfulIds: readonly string[];
  stoppedReason: BatchStopReason;
  stoppedAtBatchIndex: number;
  message: string | null;
}): BatchRunSummary {
  const claimed = new Set(successfulIds);
  const successful: string[] = [];
  const remaining: string[] = [];

  for (const id of plan.orderedUniqueIds) {
    if (claimed.has(id)) {
      successful.push(id);
    } else {
      remaining.push(id);
    }
  }

  return {
    outcome: decideOutcome(successful.length, remaining.length, stoppedReason),
    successfulIds: successful,
    remainingIds: remaining,
    stoppedReason,
    stoppedAtBatchIndex: normalizeBatchIndex(stoppedAtBatchIndex, plan.totalBatches),
    message,
  };
}
