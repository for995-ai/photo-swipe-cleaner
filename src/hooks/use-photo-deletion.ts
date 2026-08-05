/**
 * 把單次刪除交易核心接上真實服務的薄型 Hook。
 *
 * 這裡刻意「薄」：所有安全判斷都留在已經逐一驗證過的純模組裡
 * （delete-journal／delete-runner），本檔只負責三件事：
 *
 * 1. 把真實服務注入 runDeleteTransaction（Journal 存取、PhotoKit 刪除、Session 提交）
 * 2. 用 AppState 確認「交易開始前」App 在前景——開始後就不再檢查
 * 3. 啟動時檢查安全紀錄，並且**只**自動恢復 photo-deleted 這一種
 *
 * 本檔不認識 UI，也不接受 router 或 component；scope 與 session 都由呼叫端傳入。
 * deleteAssetsAsync 仍然只存在於 delete-service.ts，這裡只呼叫
 * deletePhotoAssetsAsync，不 import expo-media-library。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  clearCorruptDeleteJournalAsync,
  clearDeleteJournalAsync,
  loadDeleteJournalAsync,
  saveDeleteJournalAsync,
  type DeleteJournalEntryV1,
} from '@/lib/delete-journal';
import {
  runDeleteTransaction,
  type DeleteTransactionProgressEvent,
  type DeleteTransactionResult,
} from '@/lib/delete-runner';
import { deletePhotoAssetsAsync } from '@/lib/delete-service';
import type { CommitDeletedBatchResult } from '@/hooks/use-cleanup-session';
import type { SessionState } from '@/lib/session';

/** Hook 只需要 Session 的這三個能力，不必依賴整個 useCleanupSession。 */
export type PhotoDeletionSessionPort = {
  commitDeletedBatch: (
    ids: readonly string[],
    expectedScopeKey?: string
  ) => Promise<CommitDeletedBatchResult>;
  getStateSnapshot: () => Readonly<SessionState>;
  getScopeKeySnapshot: () => string | null;
};

export type UsePhotoDeletionParams = {
  scopeKey: string;
  sessionReady: boolean;
  session: PhotoDeletionSessionPort;
};

export type PhotoDeletionStatus =
  /** Session 還沒還原完成，什麼都不能做。 */
  | 'waiting-for-session'
  /** 正在讀取／恢復安全紀錄。 */
  | 'checking-recovery'
  /** 沒有殘留紀錄，可以開始刪除。 */
  | 'ready'
  /** 正在執行一次刪除交易。 */
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
/**
 * 使用者已經自行確認過結果之後，可以執行的三種人工解除動作。
 *
 * 這三種都**不會**呼叫 PhotoKit：它們只是把「使用者已經知道真實結果」這件事
 * 記進 Session 與安全紀錄。判斷照片到底刪掉了沒有，是使用者的責任，
 * 因為只有他能打開 iPhone「照片」App 去看。
 */
export type ManualRecoveryAction =
  /** 使用者確認照片仍在 → 上一次沒刪成功，只要清掉紀錄。 */
  | 'confirmed-still-present'
  /** 使用者確認照片已刪 → 要把這些照片補記進 Session，再清紀錄。 */
  | 'confirmed-deleted'
  /** 使用者同意丟棄損壞的紀錄。 */
  | 'cleared-corrupt';

export type ManualRecoveryResult =
  | { ok: true; action: ManualRecoveryAction }
  | { ok: false; action: ManualRecoveryAction | null; message: string };

export type DeleteRecoveryState =
  | { kind: 'idle' }
  | { kind: 'checking'; scopeKey: string }
  /** 正在把 photo-deleted 的照片補提交進 Session。 */
  | { kind: 'recovering-photo-deleted'; scopeKey: string; entry: DeleteJournalEntryV1 }
  /** 正在執行使用者發起的人工解除。 */
  | {
      kind: 'resolving-manual';
      scopeKey: string;
      action: ManualRecoveryAction;
      message: string;
    }
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

export type UsePhotoDeletionResult = {
  status: PhotoDeletionStatus;
  recovery: DeleteRecoveryState;
  progress: DeleteTransactionProgressEvent | null;
  result: DeleteTransactionResult | null;
  isRunning: boolean;
  isRecovering: boolean;
  /** 為 true 時 UI 應該擋住整理範圍切換。 */
  isScopeLocked: boolean;
  canStart: boolean;
  startDeleteRun: (ids: readonly string[]) => Promise<DeleteTransactionResult | null>;
  retryRecovery: () => void;
  resetRunResult: () => void;
  /**
   * 使用者已確認「這些照片仍存在」，因此上一次並未成功刪除。
   *
   * - 本函式**不會**顯示任何確認視窗；呼叫端必須先取得使用者明確確認。
   * - 本函式**絕不**呼叫 PhotoKit。
   * - 只清除安全紀錄，完全不動 Session。
   */
  confirmPhotosStillPresent: () => Promise<ManualRecoveryResult>;
  /**
   * 使用者已確認「這些照片已經刪除」。
   *
   * - 本函式**不會**顯示任何確認視窗；呼叫端必須先取得使用者明確確認。
   * - 本函式**絕不**呼叫 PhotoKit —— 照片是使用者自己看過確認的。
   * - 把紀錄裡的照片清單補進 Session，成功後才清除紀錄。
   */
  confirmPhotosDeleted: () => Promise<ManualRecoveryResult>;
  /**
   * 使用者同意丟棄損壞的安全紀錄。
   *
   * - 本函式**不會**顯示任何確認視窗；呼叫端必須先取得使用者明確確認。
   * - 本函式**絕不**呼叫 PhotoKit，也不動 Session。
   * - 只有當本機資料與使用者看到的那一筆一字不差時才會清除。
   */
  confirmClearCorruptJournal: () => Promise<ManualRecoveryResult>;
};

const MESSAGE_BLOCKED_PREPARED = '上一次刪除結果仍待確認，請返回確認頁重新檢查照片。';
const MESSAGE_BLOCKED_UNCERTAIN = '上一次刪除結果無法確認，請重新檢查待刪照片。';
const MESSAGE_BLOCKED_CORRUPT = '刪除安全紀錄無法讀取，請先確認照片狀態。';
const MESSAGE_RECOVERY_CLEAR_PENDING = '照片刪除進度已更新，但安全紀錄尚未清除，請再試一次。';
const MESSAGE_RUN_FAILED = '刪除流程發生未預期錯誤，已停止。';
const MESSAGE_MANUAL_REJECTED = '目前狀態無法執行這個操作，請重新檢查後再試。';
const MESSAGE_MANUAL_CLEAR_UNCONFIRMED = '無法確認安全紀錄是否已清除，請再試一次。';
const MESSAGE_MANUAL_COMMIT_FAILED = '無法更新刪除進度，請再試一次。';
const MESSAGE_MANUAL_CORRUPT_CHANGED = '安全紀錄已經變更，已重新檢查，請確認目前狀態。';
const MESSAGE_RESOLVING_STILL_PRESENT = '正在解除上一次的安全紀錄…';
const MESSAGE_RESOLVING_DELETED = '正在更新已刪除照片的進度…';
const MESSAGE_RESOLVING_CORRUPT = '正在清除損壞的安全紀錄…';

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

/** 取出 recovery 狀態的 scopeKey；`idle` 沒有範圍。 */
function recoveryScopeKeyOf(state: DeleteRecoveryState): string | null {
  return state.kind === 'idle' ? null : state.scopeKey;
}

/** 取出 recovery 狀態帶的 journal entry；沒有就回 null。 */
function recoveryEntryOf(state: DeleteRecoveryState): DeleteJournalEntryV1 | null {
  switch (state.kind) {
    case 'recovering-photo-deleted':
    case 'blocked-prepared':
    case 'blocked-uncertain':
    case 'blocked-photo-deleted':
      return state.entry;
    default:
      return null;
  }
}

/**
 * 只有這兩個 blocked 狀態可以走「照片仍存在／照片已刪除」的人工路徑。
 * 回傳字面型別，讓呼叫端能安全地重建同一種狀態。
 */
function manualBlockedKindOf(
  state: DeleteRecoveryState
): 'blocked-prepared' | 'blocked-uncertain' | null {
  if (state.kind === 'blocked-prepared' || state.kind === 'blocked-uncertain') {
    return state.kind;
  }
  return null;
}

/** 兩個進度事件是否完全相同（用來避免無意義的 re-render）。 */
function progressSignature(event: DeleteTransactionProgressEvent): string {
  return [
    event.phase,
    event.runId,
    event.scopeKey,
    event.totalPhotos,
    event.successfulCount,
    event.remainingCount,
    event.message ?? '',
  ].join('|');
}

export function usePhotoDeletion({
  scopeKey,
  sessionReady,
  session,
}: UsePhotoDeletionParams): UsePhotoDeletionResult {
  const [status, setStatus] = useState<PhotoDeletionStatus>('waiting-for-session');
  const [recovery, setRecovery] = useState<DeleteRecoveryState>({ kind: 'idle' });
  const [progress, setProgress] = useState<DeleteTransactionProgressEvent | null>(null);
  const [result, setResult] = useState<DeleteTransactionResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  /** 同步的重入鎖：setState 太慢，擋不住連點。 */
  const runningRef = useRef(false);
  /**
   * 人工解除的同步鎖。與 runningRef 互斥：Runner 執行中不能人工解除，
   * 人工解除中也不能開新的 Runner。兩者都不靠畫面的 disabled 來保證。
   */
  const manualRecoveryRef = useRef(false);
  /**
   * 損壞紀錄的原始字串，只保存在這裡。
   *
   * 刻意不放進公開的 recovery state：它是內部資料，一旦進到 state 就有機會
   * 被印進畫面或 log。清除時用它來證明「要刪的就是使用者看到的那一筆」。
   * scope 改變或重新檢查時一定會被清成 null（見 inspectJournal 開頭）。
   */
  const corruptRawRef = useRef<{ scopeKey: string; rawValue: string; generation: number } | null>(
    null
  );
  /** unmount 後不得再 setState。 */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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

  /**
   * 只在**交易開始前**被 Runner 呼叫一次。
   *
   * 交易送出之後就不再檢查：iOS 的系統確認視窗本身會把 App 推成 `inactive`，
   * 那不是錯誤，也沒有「下一批」需要等前景恢復。
   */
  const isAppActive = useCallback(() => appStateRef.current === 'active', []);

  const isRecovering =
    recovery.kind === 'checking' ||
    recovery.kind === 'recovering-photo-deleted' ||
    recovery.kind === 'resolving-manual';

  /**
   * 啟動時的安全紀錄檢查。
   *
   * 只有 photo-deleted 會被自動恢復；其餘狀態一律只阻擋並回報，
   * 絕不自動呼叫 PhotoKit、不自動清除資料。
   */
  const inspectJournal = useCallback(async (targetScopeKey: string, generation: number) => {
    const alive = () => mountedRef.current && generationRef.current === generation;
    /** 每一步之前都要重新確認：Session 仍對齊這個範圍，而且這一輪還沒作廢。 */
    const stillAligned = () =>
      alive() && sessionRef.current.getScopeKeySnapshot() === targetScopeKey;

    // 每次重新檢查都先讓舊的 corrupt 快照失效，避免拿過期的字串去清除。
    corruptRawRef.current = null;
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
      // 原始字串只留在私有 ref，供之後的人工精確清除使用。
      corruptRawRef.current = {
        scopeKey: targetScopeKey,
        rawValue: loaded.rawValue,
        generation,
      };
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
        // 沒提交成功就不能清紀錄——那是重開後唯一能知道這些照片已刪的線索。
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
    // 與人工解除互斥：不能一邊解除一邊重新檢查。
    if (runningRef.current || manualRecoveryRef.current || !sessionReady || !scopeKey) {
      return;
    }
    if (sessionRef.current.getScopeKeySnapshot() !== scopeKey) {
      return;
    }
    generationRef.current += 1;
    void inspectJournal(scopeKey, generationRef.current);
  }, [scopeKey, sessionReady, inspectJournal]);

  /**
   * 三個人工解除 API 共用的前置檢查與收尾。
   *
   * `allowedKinds` 限定只有特定的 blocked 狀態才能執行對應動作——
   * 例如在 `ready` 或 `blocked-photo-deleted` 呼叫「確認照片仍存在」是沒有
   * 意義的，一律安全拒絕而不是靜默做點什麼。
   */
  const runManualRecovery = useCallback(
    async (
      action: ManualRecoveryAction,
      allowedKinds: readonly DeleteRecoveryState['kind'][],
      resolvingMessage: string,
      work: (context: {
        scopeKey: string;
        generation: number;
        alive: () => boolean;
        stillAligned: () => boolean;
      }) => Promise<ManualRecoveryResult>
    ): Promise<ManualRecoveryResult> => {
      // 同步鎖先關門，再做其他檢查——連點時第二次呼叫必須立刻被擋掉。
      if (manualRecoveryRef.current || runningRef.current) {
        return { ok: false, action, message: MESSAGE_MANUAL_REJECTED };
      }
      if (!sessionReady || !scopeKey) {
        return { ok: false, action, message: MESSAGE_MANUAL_REJECTED };
      }
      if (!allowedKinds.includes(recovery.kind) || recoveryScopeKeyOf(recovery) !== scopeKey) {
        return { ok: false, action, message: MESSAGE_MANUAL_REJECTED };
      }
      const capturedScopeKey = scopeKey;
      if (sessionRef.current.getScopeKeySnapshot() !== capturedScopeKey) {
        return { ok: false, action, message: MESSAGE_MANUAL_REJECTED };
      }

      manualRecoveryRef.current = true;
      const generation = generationRef.current;
      const alive = () => mountedRef.current && generationRef.current === generation;
      const stillAligned = () =>
        alive() &&
        scopeKeyRef.current === capturedScopeKey &&
        sessionRef.current.getScopeKeySnapshot() === capturedScopeKey;

      if (alive()) {
        setRecovery({
          kind: 'resolving-manual',
          scopeKey: capturedScopeKey,
          action,
          message: resolvingMessage,
        });
        setStatus('checking-recovery');
      }

      try {
        return await work({ scopeKey: capturedScopeKey, generation, alive, stillAligned });
      } catch {
        // 任何意外都轉成安全失敗，並且重新檢查一次讓畫面回到真實狀態。
        if (alive()) {
          generationRef.current += 1;
          void inspectJournal(capturedScopeKey, generationRef.current);
        }
        return { ok: false, action, message: MESSAGE_MANUAL_REJECTED };
      } finally {
        manualRecoveryRef.current = false;
      }
    },
    [recovery, scopeKey, sessionReady, inspectJournal]
  );

  /** 重新檢查一次 Journal，讓畫面回到本機的真實狀態。 */
  const refreshAfterManual = useCallback(
    (targetScopeKey: string) => {
      generationRef.current += 1;
      void inspectJournal(targetScopeKey, generationRef.current);
    },
    [inspectJournal]
  );

  const confirmPhotosStillPresent = useCallback(async (): Promise<ManualRecoveryResult> => {
    const entry = recoveryEntryOf(recovery);
    // 把 kind 收窄成字面型別後帶進閉包，之後重建 blocked 狀態才是型別安全的。
    const blockedKind = manualBlockedKindOf(recovery);
    if (!entry || !blockedKind) {
      return { ok: false, action: 'confirmed-still-present', message: MESSAGE_MANUAL_REJECTED };
    }
    return runManualRecovery(
      'confirmed-still-present',
      ['blocked-prepared', 'blocked-uncertain'],
      MESSAGE_RESOLVING_STILL_PRESENT,
      async ({ scopeKey: captured, alive, stillAligned }) => {
        if (!stillAligned()) {
          return {
            ok: false,
            action: 'confirmed-still-present',
            message: MESSAGE_MANUAL_REJECTED,
          };
        }
        // 照片還在 → 上一次沒刪成功 → Session 一個字都不用改，只清紀錄。
        const cleared = await clearDeleteJournalAsync(entry.scopeKey, entry.runId);
        if (!alive()) {
          return {
            ok: false,
            action: 'confirmed-still-present',
            message: MESSAGE_MANUAL_REJECTED,
          };
        }
        if (!cleared.ok || !cleared.cleared) {
          // 維持原本的 blocked 狀態，不標 ready，也不自動重試。
          setRecovery({
            kind: blockedKind,
            scopeKey: entry.scopeKey,
            message: MESSAGE_MANUAL_CLEAR_UNCONFIRMED,
            entry,
          });
          setStatus('blocked');
          return {
            ok: false,
            action: 'confirmed-still-present',
            message: MESSAGE_MANUAL_CLEAR_UNCONFIRMED,
          };
        }
        refreshAfterManual(captured);
        return { ok: true, action: 'confirmed-still-present' };
      }
    );
  }, [recovery, runManualRecovery, refreshAfterManual]);

  const confirmPhotosDeleted = useCallback(async (): Promise<ManualRecoveryResult> => {
    const entry = recoveryEntryOf(recovery);
    const blockedKind = manualBlockedKindOf(recovery);
    if (!entry || !blockedKind) {
      return { ok: false, action: 'confirmed-deleted', message: MESSAGE_MANUAL_REJECTED };
    }
    return runManualRecovery(
      'confirmed-deleted',
      ['blocked-prepared', 'blocked-uncertain'],
      MESSAGE_RESOLVING_DELETED,
      async ({ scopeKey: captured, alive, stillAligned }) => {
        const blocked = (message: string): ManualRecoveryResult => {
          if (alive()) {
            setRecovery({ kind: blockedKind, scopeKey: entry.scopeKey, message, entry });
            setStatus('blocked');
          }
          return { ok: false, action: 'confirmed-deleted', message };
        };

        if (!stillAligned()) {
          return { ok: false, action: 'confirmed-deleted', message: MESSAGE_MANUAL_REJECTED };
        }

        // 先看 Session 是不是已經記過了——重複執行必須是 idempotent 的。
        const snapshot = sessionRef.current.getStateSnapshot();
        const deleted = new Set(snapshot.deletedIds);
        const discarded = new Set(snapshot.discardedIds);
        const alreadyCommitted =
          entry.batchIds.every((id) => deleted.has(id)) &&
          entry.batchIds.every((id) => !discarded.has(id));

        if (!alreadyCommitted) {
          const committed = await sessionRef.current.commitDeletedBatch(
            entry.batchIds,
            entry.scopeKey
          );
          if (!alive()) {
            return { ok: false, action: 'confirmed-deleted', message: MESSAGE_MANUAL_REJECTED };
          }
          if (!committed.ok) {
            // 沒記進 Session 就不能清紀錄。
            return blocked(committed.message || MESSAGE_MANUAL_COMMIT_FAILED);
          }
        }

        if (!stillAligned()) {
          // 已提交的結果不回滾，但也不在新範圍上動紀錄。
          return { ok: false, action: 'confirmed-deleted', message: MESSAGE_MANUAL_REJECTED };
        }

        const cleared = await clearDeleteJournalAsync(entry.scopeKey, entry.runId);
        if (!alive()) {
          return { ok: false, action: 'confirmed-deleted', message: MESSAGE_MANUAL_REJECTED };
        }
        if (!cleared.ok || !cleared.cleared) {
          // Session 已經更新，不回滾；紀錄保留給下一次重試。
          return blocked(MESSAGE_RECOVERY_CLEAR_PENDING);
        }

        refreshAfterManual(captured);
        return { ok: true, action: 'confirmed-deleted' };
      }
    );
  }, [recovery, runManualRecovery, refreshAfterManual]);

  const confirmClearCorruptJournal = useCallback(async (): Promise<ManualRecoveryResult> => {
    const snapshot = corruptRawRef.current;
    if (
      !snapshot ||
      snapshot.scopeKey !== scopeKey ||
      snapshot.generation !== generationRef.current
    ) {
      // 沒有有效的 raw 快照就沒有可以安全刪除的目標。
      return { ok: false, action: 'cleared-corrupt', message: MESSAGE_MANUAL_REJECTED };
    }
    return runManualRecovery(
      'cleared-corrupt',
      ['blocked-corrupt'],
      MESSAGE_RESOLVING_CORRUPT,
      async ({ scopeKey: captured, alive, stillAligned }) => {
        if (!stillAligned()) {
          return { ok: false, action: 'cleared-corrupt', message: MESSAGE_MANUAL_REJECTED };
        }
        const cleared = await clearCorruptDeleteJournalAsync(captured, snapshot.rawValue);
        if (!alive()) {
          return { ok: false, action: 'cleared-corrupt', message: MESSAGE_MANUAL_REJECTED };
        }
        if (!cleared.ok || !cleared.cleared) {
          // raw 已變、清除失敗都走這裡：重新讀一次，讓畫面反映本機現在真正的內容。
          refreshAfterManual(captured);
          return {
            ok: false,
            action: 'cleared-corrupt',
            message: cleared.ok ? MESSAGE_MANUAL_CORRUPT_CHANGED : MESSAGE_MANUAL_CLEAR_UNCONFIRMED,
          };
        }
        refreshAfterManual(captured);
        return { ok: true, action: 'cleared-corrupt' };
      }
    );
  }, [recovery, scopeKey, runManualRecovery, refreshAfterManual]);

  const resetRunResult = useCallback(() => {
    // 只清畫面狀態：不碰 Journal、不碰 Session、不呼叫 PhotoKit。
    setProgress(null);
    setResult(null);
    lastProgressSignatureRef.current = null;
    setStatus((current) => (current === 'completed' || current === 'stopped' ? 'ready' : current));
  }, []);

  const canStart =
    sessionReady &&
    !isRunning &&
    !isRecovering &&
    recovery.kind === 'ready' &&
    recovery.scopeKey === scopeKey;

  const startDeleteRun = useCallback(
    async (ids: readonly string[]): Promise<DeleteTransactionResult | null> => {
      // 同步鎖先關門，再做其他檢查——連點時第二次呼叫必須立刻被擋掉。
      // 人工解除進行中也一律拒絕：兩者共用同一份 Journal，不能同時動。
      if (runningRef.current || manualRecoveryRef.current) {
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

      // 不做任何分批規劃：使用者選多少張就一次全部送出。
      // 去重與 ID 驗證由 runDeleteTransaction 自己處理（它不會 throw）。
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
        const runResult = await runDeleteTransaction(
          { photoIds: ids, scopeKey: capturedScopeKey },
          {
            loadJournal: loadDeleteJournalAsync,
            saveJournal: saveDeleteJournalAsync,
            clearJournal: clearDeleteJournalAsync,
            // 全專案唯一的刪除入口仍在 delete-service；這裡只是把它接上去。
            // 一次呼叫、一次系統確認。
            deletePhotos: deletePhotoAssetsAsync,
            commitDeleted: (deletedIds) =>
              sessionRef.current.commitDeletedBatch(deletedIds, capturedScopeKey),
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
        // runDeleteTransaction 本身已經把所有 dependency 例外吃掉了，
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
      confirmPhotosStillPresent,
      confirmPhotosDeleted,
      confirmClearCorruptJournal,
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
      confirmPhotosStillPresent,
      confirmPhotosDeleted,
      confirmClearCorruptJournal,
    ]
  );
}
