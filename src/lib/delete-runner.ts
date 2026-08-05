/**
 * 多批刪除執行器。
 *
 * ## 邊界
 *
 * 這是一個**非 React、無副作用來源**的模組：它自己不會讀寫儲存、不碰相簿、
 * 不知道 Expo 或 PhotoKit 存在。所有對外部世界的動作都由呼叫端注入
 * （見 `DeleteRunnerDependencies`），因此整個安全流程可以在純 Node 環境
 * 逐一分支驗證，不需要模擬器或實機。
 *
 * 批次大小也不是這裡決定的：呼叫端用 `MAX_DELETE_COUNT_PER_BATCH` 建好
 * `DeleteBatchPlan` 再傳進來，執行器**不重新規劃批次**，只照著計畫走。
 *
 * ## 核心安全原則
 *
 * 1. 一次只跑一批，絕不並行——`for` 迴圈逐批 await，結構上就不可能重疊。
 * 2. 任何一種停止原因（取消／失敗／保存失敗／進背景）都**立即停止**後續批次，
 *    不自動重試、不自動跳過、不在背景繼續。
 * 3. 照片一旦被 iPhone 回報刪除，該批 ID **一定**計入 successfulIds，
 *    即使之後的 Journal 或 Session 保存失敗也不回滾——記憶體與回報必須說實話。
 * 4. 每一個注入的 dependency 都包在 try/catch 內；沒有任何路徑會產生
 *    unhandled rejection。
 */
import { calculateBatchProgress, summarizeBatchRun } from '@/lib/delete-batches';
import type { BatchRunSummary, BatchStopReason, DeleteBatchPlan } from '@/lib/delete-batches';
import { createPreparedDeleteJournal, transitionDeleteJournal } from '@/lib/delete-journal';
import type {
  DeleteJournalClearResult,
  DeleteJournalEntryV1,
  DeleteJournalLoadResult,
  DeleteJournalPhase,
  DeleteJournalWriteResult,
} from '@/lib/delete-journal';

/** 單批刪除的結果。與 delete-service 的 DeleteOutcome 同形，但這裡不依賴它。 */
export type DeleteSingleBatchOutcome =
  | { status: 'deleted'; ids: string[] }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

/** Session 單批提交的結果。與 use-cleanup-session 的 CommitDeletedBatchResult 同形。 */
export type CommitBatchResult =
  | { ok: true; committedIds: string[] }
  | { ok: false; committedIds: string[]; message: string };

export type DeleteRunnerDependencies = {
  loadJournal: (scopeKey: string) => Promise<DeleteJournalLoadResult>;
  saveJournal: (entry: DeleteJournalEntryV1) => Promise<DeleteJournalWriteResult>;
  clearJournal: (scopeKey: string, expectedRunId: string) => Promise<DeleteJournalClearResult>;
  /** 由 hook 注入 deletePhotoAssetsAsync；執行器本身不認識 PhotoKit。 */
  deleteBatch: (ids: string[]) => Promise<DeleteSingleBatchOutcome>;
  commitDeletedBatch: (ids: string[]) => Promise<CommitBatchResult>;
  getCurrentScopeKey: () => string;
  getCurrentDiscardedIds: () => readonly string[];
  isAppActive: () => boolean;
  now: () => number;
  createRunId: () => string;
  onProgress: (event: DeleteRunnerProgressEvent) => void;
};

export type DeleteRunnerPhase =
  /** 啟動前的安全檢查。 */
  | 'preflight'
  /** 正在寫入本批的 prepared 紀錄。 */
  | 'preparing-journal'
  /** 已呼叫刪除，正在等 iPhone 的系統確認視窗。 */
  | 'waiting-for-system-confirmation'
  /** iPhone 回報已刪除，正在把紀錄轉成 photo-deleted。 */
  | 'marking-photo-deleted'
  /** 正在把本批寫進 Session。 */
  | 'committing-session'
  /** 正在清除本批的安全紀錄。 */
  | 'clearing-journal'
  /** 本批完整走完四個步驟。 */
  | 'batch-succeeded'
  /** 整趟中止。 */
  | 'stopped'
  /** 整趟正常跑完。 */
  | 'completed';

/**
 * 進度事件。
 *
 * 索引慣例與 delete-batches／delete-journal 一致：
 * `currentBatchIndex` 0-based、`currentBatchNumber` 1-based，
 * 尚未進入任何批次時分別是 -1 與 0。
 */
export type DeleteRunnerProgressEvent = {
  phase: DeleteRunnerPhase;
  runId: string;
  scopeKey: string;
  currentBatchIndex: number;
  currentBatchNumber: number;
  totalBatches: number;
  currentBatchSize: number;
  successfulCount: number;
  remainingCount: number;
  message: string | null;
};

/**
 * 執行結束時，安全紀錄**被認為**處於什麼狀態。
 *
 * `unavailable` 是「儲存層自己出問題，我們不知道紀錄現在長怎樣」，
 * 與 `none`（確定沒有紀錄）必須分開：前者不能當成安全，後者可以。
 */
export type DeleteRunnerJournalPhase = DeleteJournalPhase | 'none' | 'corrupt' | 'unavailable';

export type DeleteRunnerResult = {
  summary: BatchRunSummary;
  runId: string;
  scopeKey: string;
  journalPhase: DeleteRunnerJournalPhase;
  completedBatchCount: number;
  /**
   * 實際呼叫 deleteBatch 的次數，也就是 iPhone **實際**被要求系統確認的次數。
   * 刻意不用 totalBatches 頂替：中途停止時兩者不相等，拿計畫數字充當實際次數
   * 會讓使用者以為系統視窗出現過它其實沒出現的次數。
   */
  systemConfirmationCount: number;
};

export type RunDeleteBatchesParams = {
  plan: DeleteBatchPlan;
  scopeKey: string;
};

/** 啟動前：範圍已變。 */
const MESSAGE_SCOPE_CHANGED_BEFORE_START = '整理範圍已變更，未開始刪除。';
/** 批次之間：範圍已變。 */
const MESSAGE_SCOPE_CHANGED_MID_RUN = '整理範圍已變更，已停止後續刪除。';
const MESSAGE_DISCARDED_CHANGED = '待刪除清單已變更，請返回確認頁重新檢查。';
const MESSAGE_APP_BACKGROUNDED = 'App 已離開前景，已停止後續刪除。';
const MESSAGE_PLAN_INVALID = '刪除計畫不完整，未開始刪除。';
const MESSAGE_RUN_ID_INVALID = '無法建立刪除識別碼，未開始刪除。';
const MESSAGE_JOURNAL_PREPARED = '上一批刪除結果仍待確認，請先返回確認頁處理。';
const MESSAGE_JOURNAL_PHOTO_DELETED = '上一批照片已刪除，但進度尚未完成同步，請先恢復紀錄。';
const MESSAGE_JOURNAL_UNCERTAIN = '上一批刪除結果無法確認，請先處理安全紀錄。';
const MESSAGE_JOURNAL_CORRUPT = '刪除安全紀錄已損壞，請先返回確認頁處理。';
const MESSAGE_JOURNAL_LOAD_FAILED = '無法讀取刪除安全紀錄，請稍後再試一次。';
const MESSAGE_PREPARE_FAILED = '無法建立刪除安全紀錄，未開始刪除。';
const MESSAGE_PREPARE_SAVE_FAILED = '無法儲存刪除安全紀錄，已停止後續刪除。';
const MESSAGE_CANCELLED = '你已取消刪除，照片沒有變更。';
const MESSAGE_CANCELLED_CLEAR_FAILED =
  '你已取消刪除，但安全紀錄無法清除，因此不會繼續下一批。請返回確認頁重新檢查。';
/** 取消後 clear 回 cleared:false：同時交代「已取消」與「紀錄狀態不明」。 */
const MESSAGE_CANCELLED_CLEAR_UNCONFIRMED =
  '你已取消本批刪除，照片沒有因本批而變更；但無法確認安全紀錄是否已清除，因此已停止後續刪除。';
const MESSAGE_ID_MISMATCH = 'iPhone 回傳的刪除結果與本批資料不一致，已停止後續刪除。';
const MESSAGE_COMMIT_FAILED = '照片已刪除，但進度儲存失敗，已停止後續刪除。';
const MESSAGE_CLEAR_FAILED = '照片已刪除且進度已儲存，但安全紀錄無法清除，已停止後續刪除。';
/** 刪除成功後 clear 回 cleared:false。 */
const MESSAGE_CLEAR_UNCONFIRMED =
  '照片已刪除並更新進度，但無法確認安全紀錄是否已清除，已停止後續刪除。';
const MESSAGE_DELETE_THREW = '刪除過程發生未預期錯誤，已停止後續刪除。';

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * 呼叫任何注入的 dependency 都要走這裡。
 *
 * 同時吃下「同步 throw」與「Promise reject」，把兩者都變成值。
 * 這是本檔不會產生 unhandled rejection 的唯一理由。
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
 * 檢查計畫本身是否自洽。回傳錯誤說明，或 null 代表通過。
 *
 * 這裡刻意重做一次驗證而不是信任 planDeleteBatches：計畫從呼叫端傳進來之後
 * 可能被改過，而一份壞掉的計畫會直接決定「要刪哪些照片」。
 */
function findPlanProblem(plan: DeleteBatchPlan): string | null {
  if (typeof plan !== 'object' || plan === null) {
    return 'plan 不是物件';
  }
  if (!Array.isArray(plan.orderedUniqueIds) || !Array.isArray(plan.batches)) {
    return 'plan 的陣列欄位不正確';
  }
  if (!Number.isInteger(plan.batchSize) || plan.batchSize <= 0) {
    return 'batchSize 必須是大於 0 的整數';
  }
  if (plan.totalIds !== plan.orderedUniqueIds.length) {
    return 'totalIds 與 orderedUniqueIds 長度不一致';
  }
  if (plan.totalBatches !== plan.batches.length) {
    return 'totalBatches 與 batches 長度不一致';
  }

  const seen = new Set<string>();
  for (const id of plan.orderedUniqueIds) {
    if (!isNonEmptyString(id)) {
      return 'orderedUniqueIds 含有無效 ID';
    }
    if (seen.has(id)) {
      return 'orderedUniqueIds 含有重複 ID';
    }
    seen.add(id);
  }

  const flattened: string[] = [];
  for (const batch of plan.batches) {
    if (!Array.isArray(batch) || batch.length === 0) {
      return '含有空批次';
    }
    if (batch.length > plan.batchSize) {
      return '批次長度超過 batchSize';
    }
    for (const id of batch) {
      if (!isNonEmptyString(id)) {
        return '批次含有無效 ID';
      }
      flattened.push(id);
    }
  }

  if (flattened.length !== plan.orderedUniqueIds.length) {
    return 'batches 攤平後與 orderedUniqueIds 數量不符';
  }
  for (let index = 0; index < flattened.length; index += 1) {
    if (flattened[index] !== plan.orderedUniqueIds[index]) {
      return 'batches 攤平後與 orderedUniqueIds 不一致';
    }
  }

  return null;
}

/** 穩定去重並驗證 iPhone 回傳的 ID。任何一筆不合格就整批視為不可信（回 null）。 */
function sanitizeReturnedIds(ids: unknown): string[] | null {
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
      /** 停止時該回報的 journal 狀態。 */
      journalPhase: DeleteRunnerJournalPhase;
      /** `not-cleared` = ok:true 但沒清到東西；`failed` = 明確失敗或 throw。 */
      reason: 'not-cleared' | 'failed';
    };

/**
 * 判讀 clearJournal 的結果。三個呼叫端（取消、刪除成功、photo-deleted 保存失敗
 * 後的補救）都必須走這裡，否則 cleared:false 的語意很容易在三處再次分歧。
 *
 * **只有 `{ ok: true, cleared: true }` 算安全。** 這是本函式存在的理由：
 *
 * `{ ok: true, cleared: false }` 看起來像成功，其實代表「什麼都沒清掉」，
 * 而原因至少有四種——紀錄本來就不存在、runId 不相符、有另一筆更新的紀錄、
 * 或 storage 狀態與 Runner 的預期不一致。Runner 分不出是哪一種，所以一律
 * 當成「無法確認」：journalPhase 回報 `unavailable`，而不是 `none`。
 * 把它當成功會讓下一批在「本機可能還躺著一筆別人的 journal」的情況下開跑。
 *
 * `knownResidualPhase` 只在**明確失敗**（ok:false）時採用：那種情況下
 * clearJournal 已經告訴我們它沒有動手，所以上一次成功寫入的 phase 仍然成立，
 * 回報它比回報 `unavailable` 更精確，也讓後續恢復流程有更多資訊可用。
 * 相對地，clearJournal 自己 throw 時連「有沒有動到」都不知道，只能是 `unavailable`。
 */
function interpretClearResult(
  attempted: Attempt<DeleteJournalClearResult>,
  knownResidualPhase: DeleteRunnerJournalPhase
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

export async function runDeleteBatches(
  params: RunDeleteBatchesParams,
  dependencies: DeleteRunnerDependencies
): Promise<DeleteRunnerResult> {
  const { plan, scopeKey } = params;

  const successfulIds: string[] = [];
  let completedBatchCount = 0;
  let systemConfirmationCount = 0;
  let runId = '';

  /**
   * 發出進度事件。onProgress 出錯不得影響刪除流程——它只是通知，
   * 而此時可能已經有照片被刪掉了，因為一個 UI 回呼壞掉就中斷是更糟的結果。
   */
  const emit = (
    phase: DeleteRunnerPhase,
    currentBatchIndex: number,
    message: string | null
  ): void => {
    try {
      const progress = calculateBatchProgress({ plan, currentBatchIndex, successfulIds });
      dependencies.onProgress({
        phase,
        runId,
        scopeKey,
        currentBatchIndex: progress.currentBatchIndex,
        currentBatchNumber: progress.currentBatchNumber,
        totalBatches: progress.totalBatches,
        currentBatchSize: progress.currentBatchSize,
        successfulCount: progress.successfulCount,
        remainingCount: progress.remainingCount,
        message,
      });
    } catch {
      // 刻意吞掉：進度回報不是刪除流程的一部分。
    }
  };

  const finish = (
    stoppedReason: BatchStopReason,
    stoppedAtBatchIndex: number,
    message: string | null,
    journalPhase: DeleteRunnerJournalPhase
  ): DeleteRunnerResult => {
    emit(stoppedReason === 'done' ? 'completed' : 'stopped', stoppedAtBatchIndex, message);
    return {
      summary: summarizeBatchRun({
        plan,
        successfulIds,
        stoppedReason,
        stoppedAtBatchIndex,
        message,
      }),
      runId,
      scopeKey,
      journalPhase,
      completedBatchCount,
      systemConfirmationCount,
    };
  };

  // ---------------------------------------------------------------- 啟動前檢查

  emit('preflight', -1, null);

  // 1. 計畫必須自洽。壞掉就完全不碰任何副作用。
  const planProblem = findPlanProblem(plan);
  if (planProblem !== null) {
    return finish('failed', -1, MESSAGE_PLAN_INVALID, 'none');
  }

  // 2. 範圍必須仍是同一個。
  const scopeAtStart = await attempt(() => dependencies.getCurrentScopeKey());
  if (!scopeAtStart.ok || scopeAtStart.value !== scopeKey) {
    return finish('failed', -1, MESSAGE_SCOPE_CHANGED_BEFORE_START, 'none');
  }

  // 3. App 必須在前景。背景中不建立紀錄、不呼叫刪除。
  const activeAtStart = await attempt(() => dependencies.isAppActive());
  if (!activeAtStart.ok || activeAtStart.value !== true) {
    return finish('app-backgrounded', -1, MESSAGE_APP_BACKGROUNDED, 'none');
  }

  // 4. 已經有任何安全紀錄就不能開新的一趟——覆蓋掉它等於湮滅上一趟的證據。
  const existing = await attempt(() => dependencies.loadJournal(scopeKey));
  if (!existing.ok) {
    return finish('persistence-failed', -1, MESSAGE_JOURNAL_LOAD_FAILED, 'unavailable');
  }
  const loaded: DeleteJournalLoadResult = existing.value;
  if (loaded.status === 'loaded') {
    const message =
      loaded.entry.phase === 'prepared'
        ? MESSAGE_JOURNAL_PREPARED
        : loaded.entry.phase === 'photo-deleted'
          ? MESSAGE_JOURNAL_PHOTO_DELETED
          : MESSAGE_JOURNAL_UNCERTAIN;
    return finish('failed', -1, message, loaded.entry.phase);
  }
  if (loaded.status === 'corrupt') {
    return finish('failed', -1, MESSAGE_JOURNAL_CORRUPT, 'corrupt');
  }
  if (loaded.status === 'failed') {
    // 儲存層壞掉時不能假設「沒有紀錄」——那可能漏掉一筆真正的 photo-deleted。
    return finish('persistence-failed', -1, MESSAGE_JOURNAL_LOAD_FAILED, 'unavailable');
  }

  // 5. 整趟固定一個 runId，只產生一次。
  const createdRunId = await attempt(() => dependencies.createRunId());
  if (!createdRunId.ok || !isNonEmptyString(createdRunId.value)) {
    return finish('failed', -1, MESSAGE_RUN_ID_INVALID, 'none');
  }
  runId = createdRunId.value;

  // ---------------------------------------------------------------- 批次迴圈
  // for + await：任何時刻最多只有一批在飛，結構上不可能並行。

  for (let batchIndex = 0; batchIndex < plan.totalBatches; batchIndex += 1) {
    const batchIds = plan.batches[batchIndex];

    // --- 每批開始前重新確認三件事 ---

    const activeNow = await attempt(() => dependencies.isAppActive());
    if (!activeNow.ok || activeNow.value !== true) {
      // 本批還沒建立任何紀錄，所以 journal 是乾淨的。
      return finish('app-backgrounded', batchIndex, MESSAGE_APP_BACKGROUNDED, 'none');
    }

    const scopeNow = await attempt(() => dependencies.getCurrentScopeKey());
    if (!scopeNow.ok || scopeNow.value !== scopeKey) {
      return finish('failed', batchIndex, MESSAGE_SCOPE_CHANGED_MID_RUN, 'none');
    }

    const discardedNow = await attempt(() => dependencies.getCurrentDiscardedIds());
    if (!discardedNow.ok || !Array.isArray(discardedNow.value)) {
      return finish('failed', batchIndex, MESSAGE_DISCARDED_CHANGED, 'none');
    }
    const stillDiscarded = new Set(discardedNow.value);
    // 只要有一個 ID 不見了就整趟停止。刻意**不**把它過濾掉後繼續：
    // 使用者看到的張數與批次規劃都以原清單為準，偷偷改掉會讓畫面說謊。
    if (!batchIds.every((id) => stillDiscarded.has(id))) {
      return finish('failed', batchIndex, MESSAGE_DISCARDED_CHANGED, 'none');
    }

    // --- A. 建立 prepared ---

    emit('preparing-journal', batchIndex, null);
    const prepared = await attempt(() =>
      createPreparedDeleteJournal({
        runId,
        scopeKey,
        batchIndex,
        totalBatches: plan.totalBatches,
        batchIds,
        now: dependencies.now(),
      })
    );
    if (!prepared.ok) {
      return finish('failed', batchIndex, MESSAGE_PREPARE_FAILED, 'none');
    }

    // --- B. 保存 prepared。沒存成功就絕不呼叫刪除 ---

    const preparedSave = await attempt(() => dependencies.saveJournal(prepared.value));
    if (!preparedSave.ok) {
      // 保存本身 throw：不知道到底寫進去沒有。
      return finish('persistence-failed', batchIndex, MESSAGE_PREPARE_SAVE_FAILED, 'unavailable');
    }
    if (!preparedSave.value.ok) {
      // 乾淨地回報失敗：紀錄沒有寫進去。
      return finish('persistence-failed', batchIndex, MESSAGE_PREPARE_SAVE_FAILED, 'none');
    }

    // --- C. 呼叫刪除（iPhone 會在這裡跳出系統確認視窗） ---

    emit('waiting-for-system-confirmation', batchIndex, null);
    systemConfirmationCount += 1;
    const deleteAttempt = await attempt(() => dependencies.deleteBatch(batchIds));

    // deleteBatch 自己 throw 一律視為 failed（絕不是取消）。
    const outcome: DeleteSingleBatchOutcome = deleteAttempt.ok
      ? deleteAttempt.value
      : { status: 'failed', message: MESSAGE_DELETE_THREW };

    /** 把 prepared 轉成 uncertain 並保存，回傳最終該回報的 journalPhase。 */
    const markUncertain = async (reason: string): Promise<DeleteRunnerJournalPhase> => {
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
      // 本批完全沒刪成功：不 commit、不計入成功。
      // 本批的 journal 停在 prepared，所以明確失敗時已知殘留就是 prepared。
      const cleared = interpretClearResult(
        await attempt(() => dependencies.clearJournal(scopeKey, runId)),
        'prepared'
      );
      if (cleared.safe) {
        // 只有確定清掉了，才敢回報「乾淨的取消」。
        return finish('cancelled', batchIndex, MESSAGE_CANCELLED, 'none');
      }
      // 清不掉或清不確定都不能假裝乾淨。兩種都不會因此重新呼叫 PhotoKit。
      return finish(
        'persistence-failed',
        batchIndex,
        cleared.reason === 'not-cleared'
          ? MESSAGE_CANCELLED_CLEAR_UNCONFIRMED
          : MESSAGE_CANCELLED_CLEAR_FAILED,
        cleared.journalPhase
      );
    }

    // --- 失敗（含 deleteBatch 自己 throw） ---

    if (outcome.status !== 'deleted') {
      const failMessage = isNonEmptyString(outcome.message)
        ? outcome.message
        : MESSAGE_DELETE_THREW;
      const journalPhase = await markUncertain(failMessage);
      // uncertain 成功保存才算「已妥善記錄的失敗」；否則是保存層出問題。
      return journalPhase === 'uncertain'
        ? finish('failed', batchIndex, failMessage, 'uncertain')
        : finish('persistence-failed', batchIndex, failMessage, journalPhase);
    }

    // --- 已刪除 ---

    const returnedIds = sanitizeReturnedIds(outcome.ids);
    if (returnedIds === null || !sameIdSet(returnedIds, batchIds)) {
      // 回傳的集合與本批不符：不知道實際刪了什麼，一個 ID 都不能提交。
      const journalPhase = await markUncertain(MESSAGE_ID_MISMATCH);
      return finish('failed', batchIndex, MESSAGE_ID_MISMATCH, journalPhase);
    }

    // 照片從這一刻起已經真的不見了。以下任何失敗都不得回滾、不得少算。
    emit('marking-photo-deleted', batchIndex, null);
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
    // markedSaved 決定「萬一之後停下來，殘留的是 photo-deleted 還是 prepared」。
    const residualPhase: DeleteRunnerJournalPhase = markedSaved ? 'photo-deleted' : 'prepared';

    // 就算 photo-deleted 沒存成功也一定要 commit：照片已刪，
    // 記憶體 Session 必須反映真實狀態，否則使用者會看到不存在的照片。
    successfulIds.push(...returnedIds);
    emit('committing-session', batchIndex, null);
    const committed = await attempt(() => dependencies.commitDeletedBatch(returnedIds));

    // 不清除紀錄：它是重開後唯一能知道這批已刪的線索。
    if (!committed.ok) {
      return finish('persistence-failed', batchIndex, MESSAGE_COMMIT_FAILED, residualPhase);
    }
    if (!committed.value.ok) {
      const message = isNonEmptyString(committed.value.message)
        ? committed.value.message
        : MESSAGE_COMMIT_FAILED;
      return finish('persistence-failed', batchIndex, message, residualPhase);
    }

    emit('clearing-journal', batchIndex, null);
    const cleared = interpretClearResult(
      await attempt(() => dependencies.clearJournal(scopeKey, runId)),
      residualPhase
    );
    if (!cleared.safe) {
      // 照片已刪、Session 已提交，兩者都不回滾；只是不能再往下跑。
      //
      // 這裡也一併覆蓋了「photo-deleted 沒存成功但 commit 成功」的補救路徑：
      // 那種情況 residualPhase 是 prepared，但只要 clear 回 cleared:false，
      // interpretClearResult 仍會回報 unavailable——Session 存好了**不代表**
      // prepared 紀錄一定已經被清掉，不可以這樣推論。
      return finish(
        'persistence-failed',
        batchIndex,
        cleared.reason === 'not-cleared' ? MESSAGE_CLEAR_UNCONFIRMED : MESSAGE_CLEAR_FAILED,
        cleared.journalPhase
      );
    }

    // 四個步驟全部走完才算一批完成，也才能開始下一批。
    completedBatchCount += 1;
    emit('batch-succeeded', batchIndex, null);
  }

  return finish('done', plan.totalBatches - 1, null, 'none');
}
