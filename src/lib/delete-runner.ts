/**
 * 單次刪除交易執行器。
 *
 * ## 為什麼不再分批（Beta 0.5 F.2）
 *
 * 先前的版本會把待刪照片切成每 20 張一批依序送出。實機測試顯示那個設計行不通：
 * 每一次 `deleteAssetsAsync` 都會讓 iOS 彈出系統確認視窗，而系統視窗會把 App
 * 推到 `inactive`，於是「下一批開始前必須是 active」的檢查永遠不成立 ——
 * 21 張只會刪掉 20 張，45 張要使用者手動操作三次。
 *
 * 現在改成**一次交易**：使用者選多少張，就一次全部送進 `deletePhotoAssetsAsync`，
 * iPhone 只要求一次確認。沒有第二批，所以也不再需要「批次之間」的任何協調。
 *
 * ## 邊界
 *
 * 這是一個非 React、無副作用來源的模組：自己不讀寫儲存、不碰相簿、不知道 Expo
 * 或 PhotoKit 存在。所有對外部世界的動作都由呼叫端注入，因此整個安全流程可以在
 * 純 Node 環境逐一分支驗證。
 *
 * ## 核心安全原則
 *
 * 1. `deletePhotoAssetsAsync` 只呼叫一次，絕不迴圈、絕不 chunk。
 * 2. 照片一旦被 iPhone 回報刪除，`successfulIds` 就是全部送出的 ID，
 *    即使之後的 Journal 或 Session 保存失敗也不回滾。
 * 3. 每一個注入的 dependency 都包在 try/catch 內，沒有任何路徑產生
 *    unhandled rejection。
 * 4. 沒有任何張數上限。
 */
import { createPreparedDeleteJournal, transitionDeleteJournal } from '@/lib/delete-journal';
import type {
  DeleteJournalClearResult,
  DeleteJournalEntryV1,
  DeleteJournalLoadResult,
  DeleteJournalPhase,
  DeleteJournalWriteResult,
} from '@/lib/delete-journal';

/** 單次刪除的結果。與 delete-service 的 DeleteOutcome 同形，但這裡不依賴它。 */
export type DeletePhotosOutcome =
  | { status: 'deleted'; ids: string[] }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

/** Session 提交的結果。與 use-cleanup-session 的 CommitDeletedBatchResult 同形。 */
export type CommitDeletedResult =
  | { ok: true; committedIds: string[] }
  | { ok: false; committedIds: string[]; message: string };

/**
 * 為什麼停下來。
 *
 * `app-backgrounded` 只會發生在**交易開始之前**：一旦 PhotoKit 已經被呼叫，
 * 系統確認視窗本身就會讓 App 變成 inactive，那不是錯誤，也不會影響結果判定。
 */
export type DeleteStopReason =
  /** 交易完整走完。 */
  | 'done'
  /** 使用者在 iPhone 系統確認視窗按了取消。 */
  | 'cancelled'
  /** 刪除失敗（含權限失效、iOS 回報非取消錯誤）。 */
  | 'failed'
  /** 安全紀錄或進度沒能寫進本機。 */
  | 'persistence-failed'
  /** 交易還沒開始時 App 就不在前景。 */
  | 'app-backgrounded';

/**
 * 交易結果。
 *
 * 只有兩種：全部刪掉，或一張都沒刪。因為只有一次 native 呼叫，
 * **不存在「部分成功」**——PhotoKit 要嘛整批成功要嘛整批沒動。
 */
export type DeleteTransactionOutcome = 'completed' | 'nothing-deleted';

export type DeleteTransactionSummary = {
  outcome: DeleteTransactionOutcome;
  /** 已確認刪除的 ID；成功時就是全部送出的 ID，失敗或取消時為空。 */
  successfulIds: string[];
  /** 仍留在待刪清單的 ID；依原始順序。 */
  remainingIds: string[];
  stoppedReason: DeleteStopReason;
  /** 給使用者看的補充說明；沒有就是 null。 */
  message: string | null;
};

export type DeleteTransactionDependencies = {
  loadJournal: (scopeKey: string) => Promise<DeleteJournalLoadResult>;
  saveJournal: (entry: DeleteJournalEntryV1) => Promise<DeleteJournalWriteResult>;
  clearJournal: (scopeKey: string, expectedRunId: string) => Promise<DeleteJournalClearResult>;
  /** 由 hook 注入 deletePhotoAssetsAsync；執行器本身不認識 PhotoKit。 */
  deletePhotos: (ids: string[]) => Promise<DeletePhotosOutcome>;
  commitDeleted: (ids: string[]) => Promise<CommitDeletedResult>;
  getCurrentScopeKey: () => string;
  getCurrentDiscardedIds: () => readonly string[];
  /** 只在交易開始前檢查一次。 */
  isAppActive: () => boolean;
  now: () => number;
  createRunId: () => string;
  onProgress: (event: DeleteTransactionProgressEvent) => void;
};

export type DeleteTransactionPhase =
  /** 交易開始前的安全檢查。 */
  | 'preflight'
  /** 正在寫入 prepared 安全紀錄。 */
  | 'preparing-journal'
  /** 已呼叫刪除，正在等 iPhone 的系統確認視窗。 */
  | 'waiting-for-system-confirmation'
  /** iPhone 回報已刪除，正在把紀錄轉成 photo-deleted。 */
  | 'marking-photo-deleted'
  /** 正在把結果寫進 Session。 */
  | 'committing-session'
  /** 正在清除安全紀錄。 */
  | 'clearing-journal'
  /** 交易中止。 */
  | 'stopped'
  /** 交易正常完成。 */
  | 'completed';

/** 進度事件。只描述一次交易的整體進度。 */
export type DeleteTransactionProgressEvent = {
  phase: DeleteTransactionPhase;
  runId: string;
  scopeKey: string;
  /** 本次交易總共要刪幾張（去重後）。 */
  totalPhotos: number;
  successfulCount: number;
  remainingCount: number;
  message: string | null;
};

/**
 * 執行結束時，安全紀錄**被認為**處於什麼狀態。
 *
 * `unavailable` 是「儲存層自己出問題，我們不知道紀錄現在長怎樣」，
 * 與 `none`（確定沒有紀錄）必須分開：前者不能當成安全。
 */
export type DeleteTransactionJournalPhase =
  | DeleteJournalPhase
  | 'none'
  | 'corrupt'
  | 'unavailable';

export type DeleteTransactionResult = {
  summary: DeleteTransactionSummary;
  runId: string;
  scopeKey: string;
  journalPhase: DeleteTransactionJournalPhase;
  /**
   * 實際呼叫 deletePhotos 的次數，也就是 iPhone 實際被要求系統確認的次數。
   * 只有 0（沒送出）或 1（送出過）兩種值。
   */
  systemConfirmationCount: number;
};

export type RunDeleteTransactionParams = {
  /** 使用者選取的全部照片 ID。執行器會自己去重，不需要呼叫端先處理。 */
  photoIds: readonly string[];
  scopeKey: string;
};

const MESSAGE_SCOPE_CHANGED = '整理範圍已變更，未開始刪除。';
const MESSAGE_DISCARDED_CHANGED = '待刪除清單已變更，請返回確認頁重新檢查。';
const MESSAGE_APP_BACKGROUNDED = 'App 不在前景，未開始刪除。';
const MESSAGE_NO_VALID_IDS = '沒有可刪除的照片，未開始刪除。';
const MESSAGE_JOURNAL_PREPARED = '上一次刪除結果仍待確認，請先返回確認頁處理。';
const MESSAGE_JOURNAL_PHOTO_DELETED = '上一次的照片已刪除，但進度尚未完成同步，請先恢復紀錄。';
const MESSAGE_JOURNAL_UNCERTAIN = '上一次刪除結果無法確認，請先處理安全紀錄。';
const MESSAGE_JOURNAL_CORRUPT = '刪除安全紀錄已損壞，請先返回確認頁處理。';
const MESSAGE_JOURNAL_LOAD_FAILED = '無法讀取刪除安全紀錄，請稍後再試一次。';
const MESSAGE_RUN_ID_INVALID = '無法建立刪除識別碼，未開始刪除。';
const MESSAGE_PREPARE_FAILED = '無法建立刪除安全紀錄，未開始刪除。';
const MESSAGE_PREPARE_SAVE_FAILED = '無法儲存刪除安全紀錄，未開始刪除。';
const MESSAGE_CANCELLED = '你已取消刪除，照片沒有變更。';
const MESSAGE_CANCELLED_CLEAR_FAILED =
  '你已取消刪除，但安全紀錄無法清除。照片沒有變更，請返回確認頁重新檢查。';
const MESSAGE_CANCELLED_CLEAR_UNCONFIRMED =
  '你已取消刪除，照片沒有變更；但無法確認安全紀錄是否已清除，請返回確認頁重新檢查。';
const MESSAGE_ID_MISMATCH = 'iPhone 回傳的刪除結果與送出的清單不一致，未更新任何進度。';
const MESSAGE_COMMIT_FAILED = '照片已刪除，但進度儲存失敗，請重新嘗試恢復。';
const MESSAGE_CLEAR_FAILED = '照片已刪除且進度已儲存，但安全紀錄無法清除。';
const MESSAGE_CLEAR_UNCONFIRMED = '照片已刪除並更新進度，但無法確認安全紀錄是否已清除。';
const MESSAGE_DELETE_THREW = '刪除過程發生未預期錯誤，未更新任何進度。';

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * 呼叫任何注入的 dependency 都要走這裡。
 * 同時吃下「同步 throw」與「Promise reject」，把兩者都變成值。
 */
async function attempt<T>(fn: () => T | Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 穩定去重：保留每個 ID 第一次出現的位置，不排序、不修改輸入。
 * 任何一筆不合格就整批視為不可信（回 null）——寧可不刪，也不送出可疑清單。
 */
function sanitizeIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids)) {
    return null;
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (!isNonEmptyString(id)) {
      return null;
    }
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique.length > 0 ? unique : null;
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

type ClearInterpretation =
  | { safe: true }
  | {
      safe: false;
      journalPhase: DeleteTransactionJournalPhase;
      reason: 'not-cleared' | 'failed';
    };

/**
 * 判讀 clearJournal 的結果。三個呼叫端（取消、刪除成功、photo-deleted 保存失敗
 * 後的補救）都必須走這裡，否則 cleared:false 的語意很容易在三處分歧。
 *
 * **只有 `{ ok: true, cleared: true }` 算安全。**
 *
 * `{ ok: true, cleared: false }` 看起來像成功，其實代表「什麼都沒清掉」，
 * 原因至少有四種——紀錄本來就不存在、runId 不相符、有另一筆更新的紀錄、
 * 或 storage 狀態與預期不一致。分不出是哪一種，就一律當「無法確認」。
 *
 * `knownResidualPhase` 只在**明確失敗**（ok:false）時採用：那種情況
 * clearJournal 已經告訴我們它沒有動手，所以上一次成功寫入的 phase 仍然成立。
 * 相對地 clearJournal 自己 throw 時連「有沒有動到」都不知道，只能是 unavailable。
 */
function interpretClearResult(
  attempted: Attempt<DeleteJournalClearResult>,
  knownResidualPhase: DeleteTransactionJournalPhase
): ClearInterpretation {
  if (!attempted.ok) {
    return { safe: false, journalPhase: 'unavailable', reason: 'failed' };
  }
  const result = attempted.value;
  if (!result.ok) {
    return { safe: false, journalPhase: knownResidualPhase, reason: 'failed' };
  }
  if (!result.cleared) {
    return { safe: false, journalPhase: 'unavailable', reason: 'not-cleared' };
  }
  return { safe: true };
}

export async function runDeleteTransaction(
  params: RunDeleteTransactionParams,
  dependencies: DeleteTransactionDependencies
): Promise<DeleteTransactionResult> {
  const { photoIds, scopeKey } = params;

  let successfulIds: string[] = [];
  let systemConfirmationCount = 0;
  let runId = '';

  // 去重後的完整清單。這就是「一次交易」的內容，之後不會再被切分。
  const targetIds = sanitizeIds(photoIds);
  const totalPhotos = targetIds ? targetIds.length : 0;

  /**
   * 發出進度事件。onProgress 出錯不得影響刪除流程——它只是通知，
   * 而此時可能已經有照片被刪掉了。
   */
  const emit = (phase: DeleteTransactionPhase, message: string | null): void => {
    try {
      dependencies.onProgress({
        phase,
        runId,
        scopeKey,
        totalPhotos,
        successfulCount: successfulIds.length,
        remainingCount: Math.max(totalPhotos - successfulIds.length, 0),
        message,
      });
    } catch {
      // 刻意吞掉：進度回報不是刪除流程的一部分。
    }
  };

  const finish = (
    stoppedReason: DeleteStopReason,
    message: string | null,
    journalPhase: DeleteTransactionJournalPhase
  ): DeleteTransactionResult => {
    emit(stoppedReason === 'done' ? 'completed' : 'stopped', message);
    const successful = new Set(successfulIds);
    const remainingIds = (targetIds ?? []).filter((id) => !successful.has(id));
    return {
      summary: {
        outcome: successfulIds.length > 0 ? 'completed' : 'nothing-deleted',
        successfulIds: [...successfulIds],
        remainingIds,
        stoppedReason,
        message,
      },
      runId,
      scopeKey,
      journalPhase,
      systemConfirmationCount,
    };
  };

  // ---------------------------------------------------------------- 交易開始前檢查

  emit('preflight', null);

  // 1. 必須有可刪除的 ID。
  if (targetIds === null) {
    return finish('failed', MESSAGE_NO_VALID_IDS, 'none');
  }

  // 2. 範圍必須仍是同一個。
  const scopeAtStart = await attempt(() => dependencies.getCurrentScopeKey());
  if (!scopeAtStart.ok || scopeAtStart.value !== scopeKey) {
    return finish('failed', MESSAGE_SCOPE_CHANGED, 'none');
  }

  // 3. 送出的每一張都必須還在待刪清單裡。少一張就整次停止，
  //    刻意**不**偷偷過濾掉後繼續：使用者看到的張數必須與實際送出的一致。
  const discardedNow = await attempt(() => dependencies.getCurrentDiscardedIds());
  if (!discardedNow.ok || !Array.isArray(discardedNow.value)) {
    return finish('failed', MESSAGE_DISCARDED_CHANGED, 'none');
  }
  const stillDiscarded = new Set(discardedNow.value);
  if (!targetIds.every((id) => stillDiscarded.has(id))) {
    return finish('failed', MESSAGE_DISCARDED_CHANGED, 'none');
  }

  // 4. App 必須在前景。這是**唯一**一次 AppState 檢查：交易一旦送出，
  //    系統確認視窗本身就會讓 App 變 inactive，那不是錯誤。
  const activeAtStart = await attempt(() => dependencies.isAppActive());
  if (!activeAtStart.ok || activeAtStart.value !== true) {
    return finish('app-backgrounded', MESSAGE_APP_BACKGROUNDED, 'none');
  }

  // 5. 已經有任何安全紀錄就不能開新交易——覆蓋掉它等於湮滅上一次的證據。
  const existing = await attempt(() => dependencies.loadJournal(scopeKey));
  if (!existing.ok) {
    return finish('persistence-failed', MESSAGE_JOURNAL_LOAD_FAILED, 'unavailable');
  }
  const loaded: DeleteJournalLoadResult = existing.value;
  if (loaded.status === 'loaded') {
    const message =
      loaded.entry.phase === 'prepared'
        ? MESSAGE_JOURNAL_PREPARED
        : loaded.entry.phase === 'photo-deleted'
          ? MESSAGE_JOURNAL_PHOTO_DELETED
          : MESSAGE_JOURNAL_UNCERTAIN;
    return finish('failed', message, loaded.entry.phase);
  }
  if (loaded.status === 'corrupt') {
    return finish('failed', MESSAGE_JOURNAL_CORRUPT, 'corrupt');
  }
  if (loaded.status === 'failed') {
    return finish('persistence-failed', MESSAGE_JOURNAL_LOAD_FAILED, 'unavailable');
  }

  // 6. 一次交易一個 runId。
  const createdRunId = await attempt(() => dependencies.createRunId());
  if (!createdRunId.ok || !isNonEmptyString(createdRunId.value)) {
    return finish('failed', MESSAGE_RUN_ID_INVALID, 'none');
  }
  runId = createdRunId.value;

  // ---------------------------------------------------------------- A. 建立 prepared

  emit('preparing-journal', null);
  const prepared = await attempt(() =>
    createPreparedDeleteJournal({
      runId,
      scopeKey,
      // Journal v1 的欄位名稱保留相容性：單次交易固定是第 0 筆、共 1 筆。
      // UI 不會再顯示「第幾批」，但舊紀錄仍然讀得回來。
      batchIndex: 0,
      totalBatches: 1,
      batchIds: targetIds,
      now: dependencies.now(),
    })
  );
  if (!prepared.ok) {
    return finish('failed', MESSAGE_PREPARE_FAILED, 'none');
  }

  // ---------------------------------------------------------------- B. 保存 prepared

  const preparedSave = await attempt(() => dependencies.saveJournal(prepared.value));
  if (!preparedSave.ok) {
    // 保存本身 throw：不知道到底寫進去沒有。
    return finish('persistence-failed', MESSAGE_PREPARE_SAVE_FAILED, 'unavailable');
  }
  if (!preparedSave.value.ok) {
    // 乾淨地回報失敗：紀錄沒有寫進去，也還沒碰 PhotoKit。
    return finish('persistence-failed', MESSAGE_PREPARE_SAVE_FAILED, 'none');
  }

  // ---------------------------------------------------------------- C. 一次送出全部照片

  emit('waiting-for-system-confirmation', null);
  systemConfirmationCount += 1;
  const deleteAttempt = await attempt(() => dependencies.deletePhotos(targetIds));

  // deletePhotos 自己 throw 一律視為 failed（絕不是取消）。
  const outcome: DeletePhotosOutcome = deleteAttempt.ok
    ? deleteAttempt.value
    : { status: 'failed', message: MESSAGE_DELETE_THREW };

  /** 把 prepared 轉成 uncertain 並保存，回傳最終該回報的 journalPhase。 */
  const markUncertain = async (reason: string): Promise<DeleteTransactionJournalPhase> => {
    const uncertain = await attempt(() =>
      transitionDeleteJournal(prepared.value, {
        nextPhase: 'uncertain',
        now: dependencies.now(),
        message: reason,
      })
    );
    if (!uncertain.ok) {
      // 轉換失敗：prepared 還在，絕不自動清除它。
      return 'prepared';
    }
    const saved = await attempt(() => dependencies.saveJournal(uncertain.value));
    if (!saved.ok) {
      return 'unavailable';
    }
    return saved.value.ok ? 'uncertain' : 'prepared';
  };

  // --- 取消 ---

  if (outcome.status === 'cancelled') {
    // 一張都沒刪：不 commit、不計入成功。
    const cleared = interpretClearResult(
      await attempt(() => dependencies.clearJournal(scopeKey, runId)),
      'prepared'
    );
    if (cleared.safe) {
      return finish('cancelled', MESSAGE_CANCELLED, 'none');
    }
    // 清不掉或清不確定都不能假裝乾淨，但照片確實沒有變更。
    return finish(
      'persistence-failed',
      cleared.reason === 'not-cleared'
        ? MESSAGE_CANCELLED_CLEAR_UNCONFIRMED
        : MESSAGE_CANCELLED_CLEAR_FAILED,
      cleared.journalPhase
    );
  }

  // --- 失敗（含 deletePhotos 自己 throw）---

  if (outcome.status !== 'deleted') {
    const failMessage = isNonEmptyString(outcome.message) ? outcome.message : MESSAGE_DELETE_THREW;
    const journalPhase = await markUncertain(failMessage);
    return journalPhase === 'uncertain'
      ? finish('failed', failMessage, 'uncertain')
      : finish('persistence-failed', failMessage, journalPhase);
  }

  // --- 已刪除 ---

  const returnedIds = sanitizeIds(outcome.ids);
  if (returnedIds === null || !sameIdSet(returnedIds, targetIds)) {
    // 回傳的集合與送出的不符：不知道實際刪了什麼，一個 ID 都不能提交。
    const journalPhase = await markUncertain(MESSAGE_ID_MISMATCH);
    return finish('failed', MESSAGE_ID_MISMATCH, journalPhase);
  }

  // 照片從這一刻起已經真的不見了。以下任何失敗都不得回滾、不得少算。
  emit('marking-photo-deleted', null);
  const marked = await attempt(() =>
    transitionDeleteJournal(prepared.value, {
      nextPhase: 'photo-deleted',
      now: dependencies.now(),
      message: null,
    })
  );

  let markedSaved = false;
  if (marked.ok) {
    const markedSave = await attempt(() => dependencies.saveJournal(marked.value));
    markedSaved = markedSave.ok && markedSave.value.ok;
  }
  // 決定「萬一之後停下來，殘留的是 photo-deleted 還是 prepared」。
  const residualPhase: DeleteTransactionJournalPhase = markedSaved ? 'photo-deleted' : 'prepared';

  // 就算 photo-deleted 沒存成功也一定要 commit：照片已刪，
  // 記憶體 Session 必須反映真實狀態。
  successfulIds = [...returnedIds];
  emit('committing-session', null);
  const committed = await attempt(() => dependencies.commitDeleted(returnedIds));

  // 不清除紀錄：它是重開後唯一能知道這些照片已刪的線索。
  if (!committed.ok) {
    return finish('persistence-failed', MESSAGE_COMMIT_FAILED, residualPhase);
  }
  if (!committed.value.ok) {
    const message = isNonEmptyString(committed.value.message)
      ? committed.value.message
      : MESSAGE_COMMIT_FAILED;
    return finish('persistence-failed', message, residualPhase);
  }

  emit('clearing-journal', null);
  const cleared = interpretClearResult(
    await attempt(() => dependencies.clearJournal(scopeKey, runId)),
    residualPhase
  );
  if (!cleared.safe) {
    // 照片已刪、Session 已提交，兩者都不回滾；只是紀錄沒清乾淨。
    //
    // 這裡也一併覆蓋了「photo-deleted 沒存成功但 commit 成功」的補救路徑：
    // 那種情況 residualPhase 是 prepared，但只要 clear 回 cleared:false，
    // interpretClearResult 仍會回報 unavailable——Session 存好了**不代表**
    // prepared 紀錄一定已經被清掉。
    return finish(
      'persistence-failed',
      cleared.reason === 'not-cleared' ? MESSAGE_CLEAR_UNCONFIRMED : MESSAGE_CLEAR_FAILED,
      cleared.journalPhase
    );
  }

  return finish('done', null, 'none');
}
