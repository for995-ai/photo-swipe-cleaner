/**
 * 把安全分批刪除核心接上真實服務的薄型 Hook。
 *
 * 這裡刻意「薄」：所有安全判斷都留在已經逐一驗證過的純模組裡
 * （delete-batches／delete-journal／delete-runner），本檔只負責三件事：
 *
 * 1. 把真實服務注入 runDeleteBatches（Journal 存取、PhotoKit 刪除、Session 提交）
 * 2. 用 AppState 決定「現在能不能開始下一批」
 * 3. 啟動時檢查安全紀錄，並且**只**自動恢復 photo-deleted 這一種
 *
 * 本檔不認識 UI，也不接受 router 或 component；scope 與 session 都由呼叫端傳入。
 * deleteAssetsAsync 仍然只存在於 delete-service.ts，這裡只呼叫
 * deletePhotoAssetsAsync，不 import expo-media-library。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { planDeleteBatches } from '@/lib/delete-batches';
import {
  clearDeleteJournalAsync,
  loadDeleteJournalAsync,
  saveDeleteJournalAsync,
  type DeleteJournalEntryV1,
} from '@/lib/delete-journal';
import { runDeleteBatches, type DeleteRunnerProgressEvent, type DeleteRunnerResult } from '@/lib/delete-runner';
import { MAX_DELETE_COUNT_PER_BATCH, deletePhotoAssetsAsync } from '@/lib/delete-service';
import type { CommitDeletedBatchResult } from '@/hooks/use-cleanup-session';
import type { SessionState } from '@/lib/session';

/** Hook 只需要 Session 的這三個能力，不必依賴整個 useCleanupSession。 */
export type BatchDeletionSessionPort = {
  commitDeletedBatch: (
    ids: readonly string[],
    expectedScopeKey?: string
  ) => Promise<CommitDeletedBatchResult>;
  getStateSnapshot: () => Readonly<SessionState>;
  getScopeKeySnapshot: () => string | null;
};

export type UseBatchDeletionParams = {
  scopeKey: string;
  sessionReady: boolean;
  session: BatchDeletionSessionPort;
};

export type BatchDeletionHookStatus =
  /** Session 還沒還原完成，什麼都不能做。 */
  | 'waiting-for-session'
  /** 正在讀取／恢復安全紀錄。 */
  | 'checking-recovery'
  /** 沒有殘留紀錄，可以開始刪除。 */
  | 'ready'
  /** 正在跑一趟分批刪除。 */
  | 'running'
  /** 上一趟完整跑完。 */
  | 'completed'
  /** 上一趟中途停止。 */
  | 'stopped'
  /** 有殘留紀錄需要使用者處理，不能開始刪除。 */
  | 'blocked';

/**
 * 恢復流程的狀態。
 *
 * 刻意分成多個具名狀態而不是一個 error 字串：Review 必須能區分
 * 「可以自動恢復」「只能由使用者處理」「儲存層壞掉可重試」，
 * 混成一個字串就沒辦法決定要顯示什麼按鈕。
 */
export type DeleteRecoveryState =
  | { kind: 'idle' }
  | { kind: 'checking'; scopeKey: string }
  /** 正在把 photo-deleted 的批次補提交進 Session。 */
  | { kind: 'recovering-photo-deleted'; scopeKey: string; entry: DeleteJournalEntryV1 }
  /** 沒有殘留紀錄。recoveredIds 是本次自動恢復補回來的張數。 */
  | { kind: 'ready'; scopeKey: string; recoveredIds: number }
  | { kind: 'blocked-prepared'; scopeKey: string; message: string; entry: DeleteJournalEntryV1 }
  | { kind: 'blocked-uncertain'; scopeKey: string; message: string; entry: DeleteJournalEntryV1 }
  | { kind: 'blocked-corrupt'; scopeKey: string; message: string }
  /** photo-deleted 自動恢復沒完成（commit 或 clear 失敗），可重試。 */
  | {
      kind: 'blocked-photo-deleted';
      scopeKey: string;
      message: string;
      entry: DeleteJournalEntryV1;
    }
  | { kind: 'storage-failed'; scopeKey: string; message: string };

export type UseBatchDeletionResult = {
  status: BatchDeletionHookStatus;
  recovery: DeleteRecoveryState;
  progress: DeleteRunnerProgressEvent | null;
  result: DeleteRunnerResult | null;
  isRunning: boolean;
  isRecovering: boolean;
  /** 為 true 時 UI 應該擋住整理範圍切換。 */
  isScopeLocked: boolean;
  canStart: boolean;
  startDeleteRun: (ids: readonly string[]) => Promise<DeleteRunnerResult | null>;
  retryRecovery: () => void;
  resetRunResult: () => void;
};

const MESSAGE_BLOCKED_PREPARED = '上一批刪除結果仍待確認，請返回確認頁重新檢查照片。';
const MESSAGE_BLOCKED_UNCERTAIN = '上一批刪除結果無法確認，請重新檢查待刪照片。';
const MESSAGE_BLOCKED_CORRUPT = '刪除安全紀錄無法讀取，請先確認照片狀態。';
const MESSAGE_RECOVERY_CLEAR_PENDING = '照片刪除進度已更新，但安全紀錄尚未清除，請再試一次。';
const MESSAGE_RUN_FAILED = '刪除流程發生未預期錯誤，已停止。';

/**
 * runId 產生器。
 *
 * 時間戳保證跨 process 不撞，模組層的單調 counter 保證同一個 process 內
 * 就算同一毫秒連續產生也不會重複。刻意不用 Math.random 當唯一性來源，
 * 也不為此引入 UUID 套件——這個字串只寫進安全紀錄，不會顯示給使用者。
 */
let runIdCounter = 0;
function createRunId(): string {
  runIdCounter += 1;
  return `delete-run-${Date.now().toString(36)}-${runIdCounter.toString(36)}`;
}

/** 兩個進度事件是否完全相同（用來避免無意義的 re-render）。 */
function progressSignature(event: DeleteRunnerProgressEvent): string {
  return [
    event.phase,
    event.runId,
    event.scopeKey,
    event.currentBatchIndex,
    event.successfulCount,
    event.remainingCount,
    event.message ?? '',
  ].join('|');
}

export function useBatchDeletion({
  scopeKey,
  sessionReady,
  session,
}: UseBatchDeletionParams): UseBatchDeletionResult {
  const [status, setStatus] = useState<BatchDeletionHookStatus>('waiting-for-session');
  const [recovery, setRecovery] = useState<DeleteRecoveryState>({ kind: 'idle' });
  const [progress, setProgress] = useState<DeleteRunnerProgressEvent | null>(null);
  const [result, setResult] = useState<DeleteRunnerResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  /** 同步的重入鎖：setState 太慢，擋不住連點。 */
  const runningRef = useRef(false);
  /**
   * 世代編號。scope 改變或重新檢查時就 +1，任何非同步流程回來時都要比對；
   * 對不上就代表它屬於已經作廢的那一輪，結果一律丟棄。
   */
  const generationRef = useRef(0);
  const lastProgressSignatureRef = useRef<string | null>(null);

  // session 物件每次 render 都可能是新的；用 ref 讓非同步流程讀到最新的一份，
  // 又不必把它放進 effect 依賴而造成反覆重跑。
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // 非同步流程要比對「現在的 scopeKey」，但 useCallback 閉包裡的是建立當下那一份，
  // 所以另外鏡射一個 ref。
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
    });
    return () => subscription.remove();
  }, []);

  const isAppActive = useCallback(() => appStateRef.current === 'active', []);

  const isRecovering =
    recovery.kind === 'checking' || recovery.kind === 'recovering-photo-deleted';

  /**
   * 啟動時的安全紀錄檢查。
   *
   * 只有 photo-deleted 會被自動恢復；其餘狀態一律只阻擋並回報，
   * 絕不自動呼叫 PhotoKit、不自動清除資料。
   */
  const inspectJournal = useCallback(async (targetScopeKey: string, generation: number) => {
    const alive = () => generationRef.current === generation;
    /** 每一步之前都要重新確認：Session 仍對齊這個範圍，而且這一輪還沒作廢。 */
    const stillAligned = () =>
      alive() && sessionRef.current.getScopeKeySnapshot() === targetScopeKey;

    setRecovery({ kind: 'checking', scopeKey: targetScopeKey });
    setStatus('checking-recovery');

    let loaded;
    try {
      loaded = await loadDeleteJournalAsync(targetScopeKey);
    } catch {
      if (!alive()) return;
      setRecovery({
        kind: 'storage-failed',
        scopeKey: targetScopeKey,
        message: '無法讀取刪除安全紀錄，請稍後再試一次。',
      });
      setStatus('blocked');
      return;
    }

    if (!alive()) return;

    if (loaded.status === 'none') {
      setRecovery({ kind: 'ready', scopeKey: targetScopeKey, recoveredIds: 0 });
      setStatus('ready');
      return;
    }
    if (loaded.status === 'failed') {
      setRecovery({ kind: 'storage-failed', scopeKey: targetScopeKey, message: loaded.message });
      setStatus('blocked');
      return;
    }
    if (loaded.status === 'corrupt') {
      // 不自動清除：損壞的紀錄可能是唯一能說明上一輪刪到哪裡的線索。
      setRecovery({
        kind: 'blocked-corrupt',
        scopeKey: targetScopeKey,
        message: MESSAGE_BLOCKED_CORRUPT,
      });
      setStatus('blocked');
      return;
    }

    const entry = loaded.entry;

    if (entry.phase === 'prepared') {
      // 結果無法確認：不重刪、不提交，交給使用者回確認頁自己看。
      setRecovery({
        kind: 'blocked-prepared',
        scopeKey: targetScopeKey,
        message: MESSAGE_BLOCKED_PREPARED,
        entry,
      });
      setStatus('blocked');
      return;
    }
    if (entry.phase === 'uncertain') {
      setRecovery({
        kind: 'blocked-uncertain',
        scopeKey: targetScopeKey,
        message: MESSAGE_BLOCKED_UNCERTAIN,
        entry,
      });
      setStatus('blocked');
      return;
    }

    // --- photo-deleted：唯一可以自動恢復的狀態 ---
    // 照片確定已經被 iPhone 刪掉了，缺的只是 Session 紀錄與紀錄清除，
    // 兩者都不需要再碰 PhotoKit。
    setRecovery({ kind: 'recovering-photo-deleted', scopeKey: targetScopeKey, entry });
    setStatus('checking-recovery');

    const blockPhotoDeleted = (message: string) => {
      setRecovery({ kind: 'blocked-photo-deleted', scopeKey: targetScopeKey, message, entry });
      setStatus('blocked');
    };

    if (!stillAligned()) return;

    // 先看 Session 是不是其實已經提交過了（上次死在 clear 那一步）。
    const snapshot = sessionRef.current.getStateSnapshot();
    const deleted = new Set(snapshot.deletedIds);
    const discarded = new Set(snapshot.discardedIds);
    const alreadyCommitted =
      entry.batchIds.every((id) => deleted.has(id)) &&
      entry.batchIds.every((id) => !discarded.has(id));

    if (!alreadyCommitted) {
      let committed: CommitDeletedBatchResult;
      try {
        committed = await sessionRef.current.commitDeletedBatch(entry.batchIds, entry.scopeKey);
      } catch {
        if (!alive()) return;
        blockPhotoDeleted('無法更新刪除進度，請再試一次。');
        return;
      }
      if (!alive()) return;
      if (!committed.ok) {
        // 沒提交成功就不能清紀錄——那是重開後唯一能知道這批已刪的線索。
        blockPhotoDeleted(committed.message);
        return;
      }
    }

    // 清除前再確認一次：commit 期間使用者可能已經切走。
    if (!stillAligned()) return;

    let cleared;
    try {
      cleared = await clearDeleteJournalAsync(entry.scopeKey, entry.runId);
    } catch {
      if (!alive()) return;
      blockPhotoDeleted(MESSAGE_RECOVERY_CLEAR_PENDING);
      return;
    }
    if (!alive()) return;

    // 與 Runner 同一套語意：只有 cleared:true 算安全。
    // cleared:false 可能代表紀錄不存在、runId 不符或有更新的紀錄，分不出來就不能當成功。
    if (!cleared.ok || !cleared.cleared) {
      blockPhotoDeleted(MESSAGE_RECOVERY_CLEAR_PENDING);
      return;
    }

    setRecovery({
      kind: 'ready',
      scopeKey: targetScopeKey,
      recoveredIds: entry.batchIds.length,
    });
    setStatus('ready');
  }, []);

  // 啟動檢查：mount、scopeKey 改變、sessionReady 由 false 變 true 時各觸發一次。
  useEffect(() => {
    if (!sessionReady) {
      generationRef.current += 1;
      setRecovery({ kind: 'idle' });
      setStatus('waiting-for-session');
      return;
    }
    if (!scopeKey) {
      return;
    }
    // Session 還沒對齊這個範圍就先不動：現在讀到的 discardedIds 屬於舊範圍。
    if (session.getScopeKeySnapshot() !== scopeKey) {
      generationRef.current += 1;
      setRecovery({ kind: 'idle' });
      setStatus('waiting-for-session');
      return;
    }
    if (runningRef.current) {
      return;
    }

    generationRef.current += 1;
    void inspectJournal(scopeKey, generationRef.current);
    // session 物件本身每次 render 都可能換新的，故意不放進依賴；
    // 需要最新的一份時一律走 sessionRef。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, sessionReady, inspectJournal]);

  const retryRecovery = useCallback(() => {
    if (runningRef.current || !sessionReady || !scopeKey) {
      return;
    }
    if (sessionRef.current.getScopeKeySnapshot() !== scopeKey) {
      return;
    }
    generationRef.current += 1;
    void inspectJournal(scopeKey, generationRef.current);
  }, [scopeKey, sessionReady, inspectJournal]);

  const resetRunResult = useCallback(() => {
    // 只清畫面狀態：不碰 Journal、不碰 Session、不呼叫 PhotoKit。
    setProgress(null);
    setResult(null);
    lastProgressSignatureRef.current = null;
    setStatus((current) => (current === 'completed' || current === 'stopped' ? 'ready' : current));
  }, []);

  const canStart =
    sessionReady && !isRunning && recovery.kind === 'ready' && recovery.scopeKey === scopeKey;

  const startDeleteRun = useCallback(
    async (ids: readonly string[]): Promise<DeleteRunnerResult | null> => {
      // 同步鎖先關門，再做其他檢查——連點時第二次呼叫必須立刻被擋掉。
      if (runningRef.current) {
        return null;
      }
      if (!sessionReady || !scopeKey) {
        return null;
      }
      if (!Array.isArray(ids) || ids.length === 0) {
        return null;
      }
      const capturedScopeKey = scopeKey;
      if (sessionRef.current.getScopeKeySnapshot() !== capturedScopeKey) {
        return null;
      }

      let plan;
      try {
        // 批次大小一律取自 delete-service 的常數，這裡不寫死任何數字，
        // 也不新增使用者可見的上限。planDeleteBatches 遇到壞資料會 throw。
        plan = planDeleteBatches(ids, MAX_DELETE_COUNT_PER_BATCH);
      } catch {
        return null;
      }
      if (plan.totalBatches === 0) {
        return null;
      }

      runningRef.current = true;
      const generation = generationRef.current;
      const stillCurrent = () =>
        generationRef.current === generation && scopeKeyRef.current === capturedScopeKey;

      setIsRunning(true);
      setResult(null);
      setProgress(null);
      lastProgressSignatureRef.current = null;
      setStatus('running');

      try {
        const runResult = await runDeleteBatches(
          { plan, scopeKey: capturedScopeKey },
          {
            loadJournal: loadDeleteJournalAsync,
            saveJournal: saveDeleteJournalAsync,
            clearJournal: clearDeleteJournalAsync,
            // 全專案唯一的刪除入口仍在 delete-service；這裡只是把它接上去。
            deleteBatch: deletePhotoAssetsAsync,
            commitDeletedBatch: (batchIds) =>
              sessionRef.current.commitDeletedBatch(batchIds, capturedScopeKey),
            // 每次都重讀 ref，不用 render 閉包裡的舊值。
            getCurrentScopeKey: () => sessionRef.current.getScopeKeySnapshot() ?? '',
            getCurrentDiscardedIds: () => [...sessionRef.current.getStateSnapshot().discardedIds],
            isAppActive,
            now: () => Date.now(),
            createRunId,
            onProgress: (event) => {
              if (!stillCurrent()) {
                return;
              }
              const signature = progressSignature(event);
              if (lastProgressSignatureRef.current === signature) {
                return;
              }
              lastProgressSignatureRef.current = signature;
              setProgress(event);
            },
          }
        );

        // 範圍已經換掉時不要把舊結果套到新畫面上。
        if (stillCurrent()) {
          setResult(runResult);
          setStatus(runResult.summary.outcome === 'completed' ? 'completed' : 'stopped');
        }
        return runResult;
      } catch {
        // runDeleteBatches 本身已經把所有 dependency 例外吃掉了，
        // 這裡只是最後一道保險：絕不讓它變成 unhandled rejection，
        // 也絕不自己捏造「已刪除」的 ID。殘留紀錄留給恢復流程處理。
        if (stillCurrent()) {
          setProgress(null);
          setResult(null);
          setStatus('stopped');
          setRecovery({
            kind: 'storage-failed',
            scopeKey: capturedScopeKey,
            message: MESSAGE_RUN_FAILED,
          });
        }
        return null;
      } finally {
        runningRef.current = false;
        setIsRunning(false);
      }
    },
    [scopeKey, sessionReady, isAppActive]
  );

  const isScopeLocked =
    status === 'checking-recovery' || status === 'running' || isRecovering || isRunning;

  return useMemo(
    () => ({
      status,
      recovery,
      progress,
      result,
      isRunning,
      isRecovering,
      isScopeLocked,
      canStart,
      startDeleteRun,
      retryRecovery,
      resetRunResult,
    }),
    [
      status,
      recovery,
      progress,
      result,
      isRunning,
      isRecovering,
      isScopeLocked,
      canStart,
      startDeleteRun,
      retryRecovery,
      resetRunResult,
    ]
  );
}
