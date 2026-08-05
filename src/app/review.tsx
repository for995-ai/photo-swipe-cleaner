import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon, WarnIcon } from '@/components/icons';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelNotice } from '@/components/pixel/pixel-notice';
import { PixelSpinner } from '@/components/pixel/pixel-spinner';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { AppButton, Body, Caption, Screen } from '@/components/ui';
import { useCleanup } from '@/hooks/use-cleanup';
import { useDiscardedResolver } from '@/hooks/use-discarded-resolver';
import { usePhotoDeletion } from '@/hooks/use-photo-deletion';
import type {
  DeleteStopReason,
  DeleteTransactionPhase,
  DeleteTransactionResult,
  DeleteTransactionSummary,
} from '@/lib/delete-runner';
import { formatPhotoDate, type RecentPhoto } from '@/lib/photos';
import { scopeKey } from '@/lib/scope';
import { border, colors, iconSize, radius, shadow, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

const COLUMNS = 3;

/**
 * 每個執行階段對應的說明文字。
 *
 * 全部都是真實狀態，沒有百分比也沒有預估時間——處理時間完全取決於
 * 使用者在 iPhone 系統確認視窗上的反應速度與照片數量，任何估計都是假的。
 */
const PHASE_TEXT: Record<DeleteTransactionPhase, string> = {
  preflight: '正在檢查刪除條件…',
  'preparing-journal': '正在建立刪除安全紀錄…',
  'waiting-for-system-confirmation': '正在等待 iPhone 系統確認…',
  'marking-photo-deleted': '正在記錄刪除結果…',
  'committing-session': '正在儲存整理進度…',
  'clearing-journal': '正在完成安全檢查…',
  stopped: '已停止刪除。',
  completed: '已完成刪除。',
};

/** progress 還沒到、或 phase 是未知值時的保底文字。 */
const PHASE_FALLBACK_TEXT = '正在處理刪除…';

const STOP_TITLE: Record<DeleteStopReason, string> = {
  done: '刪除已結束',
  cancelled: '你已取消刪除',
  failed: '本次刪除未完成',
  'persistence-failed': '進度或安全紀錄尚未完成儲存',
  'app-backgrounded': 'App 不在前景，未開始刪除',
};

/**
 * 停止原因的語氣。
 *
 * `persistence-failed` 預設是 danger，但 Runner 在「使用者取消 + 紀錄清不掉」
 * 時也會用這個原因，那種情況主因其實是使用者自己取消，用紅色失敗語氣會誤導。
 */
function stopTone(summary: DeleteTransactionSummary): 'warning' | 'danger' {
  switch (summary.stoppedReason) {
    case 'cancelled':
    case 'app-backgrounded':
    case 'done':
      return 'warning';
    case 'persistence-failed':
      return summary.message?.includes('你已取消') ? 'warning' : 'danger';
    case 'failed':
      return 'danger';
  }
}

/**
 * 行內文字按鈕（重新查詢／移出清單）的觸控補償。
 * 這些按鈕跟 Caption 排在同一行，把它們撐到 44pt 高會壓縮下方的縮圖網格，
 * 所以改用 hitSlop 把實際可點範圍補到 44×44pt 以上。
 */
const RETRY_HIT_SLOP = { top: 14, bottom: 14, left: 12, right: 12 } as const;

/** 成功狀態的靜態像素星星：兩條交叉色塊，沒有動畫。 */
function PixelStar({ size, color }: { size: number; color: string }) {
  const arm = Math.max(2, Math.round(size / 5 / 2) * 2);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.star, { width: size, height: size }]}>
      <View style={{ position: 'absolute', width: size, height: arm, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: arm, height: size, backgroundColor: color }} />
    </View>
  );
}

/** Grid 一格的四種狀態。資料全部來自現有 resolver 與 Session，不重新計算。 */
type GridItem =
  | { key: string; kind: 'resolved'; photo: RecentPhoto; resolvedIndex: number }
  | { key: string; kind: 'pending' }
  | { key: string; kind: 'unavailable' }
  | { key: string; kind: 'deleted' };

export default function ReviewScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { granted, pager, session, scopeController } = useCleanup();
  const activeScopeKey = scopeKey(scopeController.scope);

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  /** 人工恢復操作的回饋訊息。Hook 的 recovery 狀態由 Hook 自己管，這裡只顯示結果。 */
  const [uiMessage, setUiMessage] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(
    null
  );

  /**
   * 確認視窗的同步單例鎖。
   *
   * Hook 的 runningRef／manualRecoveryRef 能保證「只有一趟真的執行」，但擋不住
   * 「連點三次就排出三個原生確認視窗」——那會讓使用者連續看到三次破壞性確認，
   * 前一個關掉後下一個又冒出來，看起來像要刪三次。
   *
   * 這裡必須用 ref 而不是 state：同一個 event loop 內的連點不會等到 re-render，
   * state 更新來不及擋。四類確認視窗共用同一把鎖，所以彼此也互斥。
   */
  const confirmationAlertOpenRef = useRef(false);

  /**
   * 刪除只由這個 Hook 執行：AppState、安全紀錄、Session 提交全部在 Hook 與其
   * 底層純模組裡。Review 不自己碰 PhotoKit、不自己寫迴圈、不自己切分清單。
   */
  const sessionPort = useMemo(
    () => ({
      commitDeletedBatch: session.commitDeletedBatch,
      getStateSnapshot: session.getStateSnapshot,
      getScopeKeySnapshot: session.getScopeKeySnapshot,
    }),
    [session.commitDeletedBatch, session.getStateSnapshot, session.getScopeKeySnapshot]
  );
  const deletion = usePhotoDeletion({
    scopeKey: activeScopeKey,
    sessionReady: session.ready,
    session: sessionPort,
  });

  /**
   * 先用 pager 已載入的照片對照，剩下的才按 ID 逐筆查詢。
   * 不會為了驗證少數遺失的 ID 而把整個相簿的分頁讀完。
   */
  const resolution = useDiscardedResolver({
    discardedIds: session.state.discardedIds,
    loadedPhotos: pager.photos,
    enabled: granted,
    pagerBusy: pager.loadingFirstPage || pager.isLoadingMore,
    onFullReloadNeeded: pager.reload,
  });

  const resolvedCount = resolution.resolved.length;
  const pendingCount = resolution.pendingIds.length;
  const unavailableCount = resolution.unavailableIds.length;

  /** 全部解析完成、沒有待處理項目，才允許進入刪除。 */
  const readyForDeletion =
    resolvedCount > 0 && pendingCount === 0 && unavailableCount === 0 && !resolution.resolving;

  /**
   * 刪除是否可以開始。
   *
   * **完全沒有張數上限**：1、20、21、45、100、500 張都走同一條單次交易路徑。
   * App 不再分批，所以也沒有任何「每批最多幾張」的概念。
   *
   * deletion.canStart 已經涵蓋 sessionReady、recovery 必須是 ready、
   * recovery 的範圍必須與目前範圍相同、沒有交易或人工恢復正在執行。
   */
  const canDelete =
    readyForDeletion && deletion.canStart && !deletion.isRunning && !deletion.isRecovering;

  const runResult = deletion.result;
  const progress = deletion.progress;
  const recovery = deletion.recovery;
  const isBusy = deletion.isRunning || deletion.isRecovering;

  /** 這次刪除交易完整跑完。 */
  const showRunCompleted =
    deletion.status === 'completed' && runResult?.summary.outcome === 'completed';
  /** 這一趟中途停止。 */
  const showRunStopped = deletion.status === 'stopped' && runResult !== null;
  /** 沒有進行中的 run 結果，但待刪清單已清空且刪過照片（例如稍後再回到本頁）。 */
  const showLegacySummary =
    !showRunCompleted &&
    !showRunStopped &&
    session.discardedCount === 0 &&
    session.deletedCount > 0;

  /** 需要使用者處理的殘留安全紀錄。 */
  const blockedRecoveryKind =
    recovery.kind === 'blocked-prepared' ||
    recovery.kind === 'blocked-uncertain' ||
    recovery.kind === 'blocked-corrupt' ||
    recovery.kind === 'blocked-photo-deleted' ||
    recovery.kind === 'storage-failed'
      ? recovery.kind
      : null;

  /** 正在載入或恢復：鎖住操作並顯示 spinner。 */
  const recoveryLoadingText =
    deletion.status === 'waiting-for-session'
      ? '正在載入整理進度…'
      : recovery.kind === 'checking'
        ? '正在檢查刪除安全紀錄…'
        : recovery.kind === 'recovering-photo-deleted'
          ? '正在恢復已完成的刪除進度…'
          : recovery.kind === 'resolving-manual'
            ? recovery.message
            : null;

  /** 沒有待刪除項目、也沒有進行中的刪除時就不要顯示刪除區塊。 */
  const showDeleteZone =
    session.discardedCount > 0 && !showRunCompleted && !showRunStopped && !blockedRecoveryKind;

  /** 導覽與清單編輯是否鎖住。 */
  const navigationLocked = deletion.isScopeLocked;

  // 開發期自檢：待刪除總數必須永遠等於三種狀態之和。
  useEffect(() => {
    if (__DEV__) {
      const sum = resolvedCount + pendingCount + unavailableCount;
      if (sum !== session.discardedCount) {
        console.warn('[review] 待刪除統計不變式被破壞', {
          discardedCount: session.discardedCount,
          resolvedCount,
          pendingCount,
          unavailableCount,
        });
      }
    }
  }, [resolvedCount, pendingCount, unavailableCount, session.discardedCount]);

  // 3 欄響應式：格子邊長由實際可用寬度算出，不寫死任何 iPhone 尺寸。
  const horizontalPadding =
    Math.max(insets.left, spacing.lg) + Math.max(insets.right, spacing.lg);
  const gap = spacing.sm;
  const cellSize = Math.floor((width - horizontalPadding - gap * (COLUMNS - 1)) / COLUMNS);
  /** 2px 描邊算在 cellSize 之內，所以照片本身要再扣掉左右邊框。 */
  const cellInnerSize = cellSize - border.width * 2;

  // 改為保留後清單會變短，把預覽索引夾回範圍，清空就關掉預覽。
  useEffect(() => {
    if (previewIndex === null) {
      return;
    }
    if (resolvedCount === 0) {
      setPreviewIndex(null);
    } else if (previewIndex > resolvedCount - 1) {
      setPreviewIndex(resolvedCount - 1);
    }
  }, [previewIndex, resolvedCount]);

  const previewPhoto = previewIndex === null ? undefined : resolution.resolved[previewIndex];

  /**
   * Grid 資料：可檢視 -> 解析中 -> 無法取得 -> 已刪除。
   * 只是把既有的三個 resolver 陣列與 Session 的 deletedIds 攤平成一份清單，
   * 沒有重新判斷任何狀態；已改為保留的照片本來就不在 discardedIds 裡，所以不會出現。
   */
  const gridItems = useMemo<GridItem[]>(() => {
    const items: GridItem[] = resolution.resolved.map((photo, resolvedIndex) => ({
      key: `resolved:${photo.id}`,
      kind: 'resolved',
      photo,
      resolvedIndex,
    }));
    for (const id of resolution.pendingIds) {
      items.push({ key: `pending:${id}`, kind: 'pending' });
    }
    for (const id of resolution.unavailableIds) {
      items.push({ key: `unavailable:${id}`, kind: 'unavailable' });
    }
    for (const id of session.state.deletedIds) {
      items.push({ key: `deleted:${id}`, kind: 'deleted' });
    }
    return items;
  }, [
    resolution.resolved,
    resolution.pendingIds,
    resolution.unavailableIds,
    session.state.deletedIds,
  ]);

  /**
   * 開一個受單例鎖保護的確認視窗。四個確認 Alert 全部走這裡。
   *
   * 鎖的生命週期：
   * - 進入時同步檢查，已經有視窗就直接 return（連點的第二、三次會走到這裡）
   * - 開啟前同步上鎖
   * - 取消／返回一律立即解鎖
   * - 確認則等 onConfirm settle 後在 finally 解鎖，所以 handler 執行期間
   *   （例如整次刪除交易還在跑）也不會被開出第二個視窗
   * - `Alert.alert` 自己同步 throw 時也要解鎖，否則會永久鎖死
   *
   * `cancelable: false` 是必要的：Android 允許點視窗外面關閉，那條路徑不會觸發
   * 任何 callback，鎖就再也解不開。
   */
  const openGuardedConfirmation = ({
    title,
    message,
    cancelLabel,
    confirmLabel,
    destructive,
    onConfirm,
  }: {
    title: string;
    message: string;
    cancelLabel: string;
    confirmLabel: string;
    destructive: boolean;
    onConfirm: () => void | Promise<unknown>;
  }) => {
    if (confirmationAlertOpenRef.current) {
      return;
    }
    confirmationAlertOpenRef.current = true;

    const release = () => {
      confirmationAlertOpenRef.current = false;
    };

    try {
      Alert.alert(
        title,
        message,
        [
          { text: cancelLabel, style: 'cancel', onPress: release },
          {
            text: confirmLabel,
            style: destructive ? 'destructive' : 'default',
            onPress: () => {
              // 鎖一路維持到 onConfirm settle；失敗或 reject 也一定解鎖。
              void (async () => {
                try {
                  await onConfirm();
                } finally {
                  release();
                }
              })();
            },
          },
        ],
        { cancelable: false }
      );
    } catch {
      release();
    }
  };

  const handleKeepInstead = (photoId: string) => {
    // 刪除或恢復進行中不允許改動待刪清單。
    if (isBusy) {
      return;
    }
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync().catch(() => {});
    }
    session.keepInstead(photoId);
  };

  const handleForgetUnavailable = () => {
    const ids = resolution.unavailableIds;
    if (ids.length === 0 || isBusy) {
      return;
    }
    // 不在規格要求的四個之列，但同樣是「可連點的確認視窗」且會改動 Session，
    // 所以走同一把鎖：與刪除／人工恢復的確認視窗互斥。
    openGuardedConfirmation({
      title: `處理 ${ids.length} 筆無法取得的項目？`,
      message:
        '這些照片已不在你授權的相簿中，會從本次的待刪除清單移除。相簿本身不會有任何變動。',
      cancelLabel: '取消',
      confirmLabel: '移出清單',
      // 維持原本的普通確認樣式：只動待刪清單，不刪照片。
      destructive: false,
      onConfirm: () => {
        session.forget(ids);
      },
    });
  };

  /**
   * 啟動單次刪除交易。系統確認與 Session 提交都在 Hook 裡，
   * 這裡只負責把「真正成功的 ID」反映到 resolver 快取與相簿分頁。
   */
  const startRun = async (ids: string[]) => {
    setUiMessage(null);
    try {
      const result = await deletion.startDeleteRun(ids);
      if (!result) {
        // 沒有啟動或提早停止：不假設成功，畫面交給 Hook 的 status／recovery 決定。
        return;
      }
      const successful = result.summary.successfulIds;
      if (successful.length > 0) {
        // 只丟掉確定刪掉的 ID —— 不是全部 ids、不是 remainingIds。
        // 這兩步失敗都不代表刪除失敗，也絕不回滾 Session（Hook 已提交）。
        resolution.dropFromCache(successful);
        pager.reload();
      }
    } catch {
      setUiMessage({ tone: 'danger', text: '刪除流程發生未預期錯誤，已停止。' });
    }
  };

  const handleRequestDelete = () => {
    if (!canDelete) {
      return;
    }
    // 只把「可檢視」的 id 送進刪除流程。
    const ids = resolution.resolved.map((photo) => photo.id);
    if (ids.length === 0) {
      return;
    }
    const totalPhotos = ids.length;

    openGuardedConfirmation({
      title: '確認刪除照片？',
      message: `準備一次刪除 ${totalPhotos} 張照片。iPhone 會要求你確認一次。照片會移至「最近刪除」，通常可在 30 天內復原。處理期間請保持 App 開啟。`,
      cancelLabel: '取消',
      confirmLabel: '開始刪除',
      destructive: true,
      onConfirm: () => startRun(ids),
    });
  };

  /** 停止後重試：重新從目前的 resolver 清單開始，不沿用上一次的 ID 快照。 */
  const handleRetryRemaining = () => {
    setUiMessage(null);
    deletion.resetRunResult();
    // 不自動開始 —— 使用者要再按一次刪除按鈕並通過 App 內確認。
  };

  const handleContinueAfterRun = () => {
    setUiMessage(null);
    deletion.resetRunResult();
    pager.reload();
    router.back();
  };

  const handleSaveAndGoHome = async () => {
    await session.saveNow();
    router.dismissAll();
  };

  /** 三個人工恢復操作共用的收尾：成功就清訊息並重讀相簿，失敗只顯示訊息。 */
  const applyManualResult = (
    result: { ok: true } | { ok: false; message: string },
    failTone: 'warning' | 'danger'
  ) => {
    if (result.ok) {
      // Hook 會自己重新檢查安全紀錄；這裡不竄改 recovery。
      setUiMessage(null);
      pager.reload();
      return;
    }
    setUiMessage({ tone: failTone, text: result.message });
  };

  const confirmStillPresent = () => {
    openGuardedConfirmation({
      title: '確認照片仍存在？',
      message:
        '請確認你已經在 iPhone「照片」App 看過，這些照片目前仍存在。繼續後只會解除安全紀錄，不會刪除照片，也不會改變待刪清單。',
      cancelLabel: '返回檢查',
      confirmLabel: '確認仍存在',
      // 只解除紀錄、不動照片也不動 Session，所以不是破壞性操作。
      destructive: false,
      onConfirm: async () => {
        const result = await deletion.confirmPhotosStillPresent();
        applyManualResult(result, 'warning');
      },
    });
  };

  const confirmAlreadyDeleted = () => {
    openGuardedConfirmation({
      title: '確認照片已刪除？',
      message:
        '請確認你已經在 iPhone「照片」App 看過，這些照片已經不在相簿中。繼續後會把這些照片記錄為已刪除，但不會再次呼叫 iPhone 刪除功能。',
      cancelLabel: '返回檢查',
      confirmLabel: '確認已刪除',
      destructive: true,
      onConfirm: async () => {
        const result = await deletion.confirmPhotosDeleted();
        applyManualResult(result, 'danger');
      },
    });
  };

  const confirmClearCorrupt = () => {
    openGuardedConfirmation({
      title: '確認清除損壞紀錄？',
      message:
        '這個操作只會清除目前完全相同的損壞安全紀錄，不會刪除照片。如果紀錄已經變更，App 不會清除。',
      cancelLabel: '取消',
      confirmLabel: '確認清除',
      destructive: true,
      onConfirm: async () => {
        const result = await deletion.confirmClearCorruptJournal();
        applyManualResult(result, 'danger');
      },
    });
  };

  const handleRetryRecovery = () => {
    setUiMessage(null);
    deletion.retryRecovery();
  };

  /** 本地訊息（人工操作的回饋）。成功時會被清掉。 */
  const renderUiMessage = () =>
    uiMessage === null ? null : (
      <PixelNotice
        tone={uiMessage.tone}
        compact
        icon={
          <WarnIcon
            size={iconSize.sm}
            fill={uiMessage.tone === 'warning' ? colors.warning : colors.discard}
          />
        }>
        {uiMessage.text}
      </PixelNotice>
    );

  /** 五種需要使用者處理的殘留紀錄。全部都不會自動碰 PhotoKit。 */
  const renderBlockedRecovery = () => {
    if (recovery.kind === 'blocked-prepared' || recovery.kind === 'blocked-uncertain') {
      const isUncertain = recovery.kind === 'blocked-uncertain';
      const { entry } = recovery;
      return (
        <View style={styles.recoveryWrap}>
          <PixelNotice
            tone={isUncertain ? 'danger' : 'warning'}
            title={isUncertain ? '上一次刪除結果無法確認' : '上一次刪除結果待確認'}
            icon={
              <WarnIcon
                size={iconSize.sm}
                fill={isUncertain ? colors.discard : colors.warning}
              />
            }>
            {isUncertain
              ? '刪除過程曾發生錯誤，App 無法判斷這些照片是否已經刪除。請先在 iPhone「照片」App 逐一確認，再選擇正確結果。'
              : 'App 無法確認上一次刪除是否已經完成。請先打開 iPhone「照片」App，檢查這些照片是否仍存在，再選擇下方結果。'}
          </PixelNotice>
          {/* 只顯示張數。不顯示 runId，也不顯示任何原始儲存內容。 */}
          <View style={styles.stats}>
            <PixelBadge label="涉及照片" value={entry.batchIds.length} tone="discard" />
          </View>
          {renderUiMessage()}
          <AppButton
            label="我已確認照片仍存在"
            variant="secondary"
            disabled={isBusy}
            onPress={confirmStillPresent}
          />
          <AppButton
            label="我已確認照片已刪除"
            variant="danger"
            disabled={isBusy}
            onPress={confirmAlreadyDeleted}
          />
        </View>
      );
    }

    if (recovery.kind === 'blocked-corrupt') {
      return (
        <View style={styles.recoveryWrap}>
          <PixelNotice
            tone="danger"
            title="刪除安全紀錄損壞"
            icon={<WarnIcon size={iconSize.sm} fill={colors.discard} />}>
            App 無法讀取上一次的安全紀錄。請先自行確認相簿狀態。清除後 App
            只會移除這筆損壞紀錄，不會刪除任何照片，也不會修改整理進度。
          </PixelNotice>
          {renderUiMessage()}
          <AppButton
            label="清除損壞的安全紀錄"
            variant="danger"
            disabled={isBusy}
            onPress={confirmClearCorrupt}
          />
        </View>
      );
    }

    // blocked-photo-deleted 與 storage-failed：只能重試恢復，不提供任何再次刪除的入口。
    const isPhotoDeleted = recovery.kind === 'blocked-photo-deleted';
    return (
      <View style={styles.recoveryWrap}>
        <PixelNotice
          tone="danger"
          title={isPhotoDeleted ? '刪除進度尚未同步完成' : '無法讀取刪除安全紀錄'}
          icon={<WarnIcon size={iconSize.sm} fill={colors.discard} />}>
          {isPhotoDeleted
            ? '照片刪除進度尚未完成同步。App 不會再次刪除照片，請重新嘗試恢復進度。'
            : '目前無法讀取刪除安全紀錄。請保持 App 開啟後再試一次。'}
        </PixelNotice>
        {renderUiMessage()}
        <AppButton
          label="重新嘗試恢復"
          variant="secondary"
          disabled={isBusy}
          onPress={handleRetryRecovery}
        />
      </View>
    );
  };

  /** 停止摘要。tone 依停止原因決定，取消不用失敗紅字。 */
  const renderStoppedSummary = (
    summary: DeleteTransactionSummary,
    result: DeleteTransactionResult
  ) => {
    const tone = stopTone(summary);
    const cancelled = summary.stoppedReason === 'cancelled';
    const nothingDeleted = summary.successfulIds.length === 0;
    return (
      <View style={styles.recoveryWrap}>
        <PixelNotice
          tone={tone}
          title={STOP_TITLE[summary.stoppedReason]}
          icon={
            <WarnIcon
              size={iconSize.sm}
              fill={tone === 'warning' ? colors.warning : colors.discard}
            />
          }>
          {summary.message ?? '刪除已停止。'}
        </PixelNotice>
        <View style={styles.stats}>
          <PixelBadge label="成功刪除" value={summary.successfulIds.length} tone="keep" />
          <PixelBadge label="仍待刪除" value={summary.remainingIds.length} tone="discard" />
        </View>
        <View style={styles.stats}>
          <PixelBadge label="系統確認" value={result.systemConfirmationCount} tone="neutral" />
        </View>
        <Caption>
          {nothingDeleted
            ? cancelled
              ? '沒有任何照片被刪除，你選的照片仍留在待刪清單裡。App 不會自動重試。'
              : '這次沒有假設任何照片已被刪除，你選的照片仍留在待刪清單裡。App 不會自動重試。'
            : '已成功刪除的照片不會恢復，已移到 iPhone「最近刪除」。'}
        </Caption>
        {renderUiMessage()}
        {/*
          只有在「recovery 是 ready」**且**「這一趟沒有留下安全紀錄」時，才提供
          重新刪除的入口。

          journalPhase !== 'none' 代表本機還躺著一筆未清掉的紀錄；Runner 的
          preflight 會因此拒絕開新的一趟，所以這裡給重試按鈕只會讓使用者白按一次。
          此時要給的是「重新檢查安全紀錄」，讓 Hook 重新判斷並帶出正確的恢復畫面。
        */}
        {recovery.kind === 'ready' && result.journalPhase === 'none' ? (
          summary.remainingIds.length > 0 ? (
            <AppButton label="重新嘗試刪除" disabled={isBusy} onPress={handleRetryRemaining} />
          ) : null
        ) : result.journalPhase !== 'none' ? (
          <AppButton
            label="重新檢查安全紀錄"
            variant="secondary"
            disabled={isBusy}
            onPress={handleRetryRecovery}
          />
        ) : null}
      </View>
    );
  };

  const renderCell = (item: GridItem) => {
    const boxSize = { width: cellSize, height: cellSize };

    if (item.kind === 'resolved') {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`待刪除照片 ${item.resolvedIndex + 1}，可檢視，點兩下放大`}
          onPress={() => setPreviewIndex(item.resolvedIndex)}>
          {({ pressed }) => (
            <PixelSurface
              cornerRadius={radius.sm}
              shadowOffset={0}
              clip
              style={[boxSize, pressed && styles.cellPressed]}>
              <Image
                source={{ uri: item.photo.uri }}
                style={{ width: cellInnerSize, height: cellInnerSize }}
                contentFit="cover"
                allowDownscaling
                recyclingKey={item.photo.id}
                cachePolicy="memory-disk"
                transition={100}
              />
            </PixelSurface>
          )}
        </Pressable>
      );
    }

    if (item.kind === 'pending') {
      return (
        <View accessible accessibilityLabel="待刪除照片，解析中">
          <PixelSurface
            background={colors.surfaceAlt}
            cornerRadius={radius.sm}
            shadowOffset={0}
            style={[boxSize, styles.cellState]}>
            <PixelSpinner size={iconSize.sm} />
            <Text
              style={[typeStyle(typeAccent.micro, width), styles.cellStateText]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              解析中
            </Text>
          </PixelSurface>
        </View>
      );
    }

    if (item.kind === 'unavailable') {
      return (
        <View accessible accessibilityLabel="待刪除照片，無法取得">
          <PixelSurface
            background={colors.surfaceAlt}
            outlineColor={colors.discardText}
            cornerRadius={radius.sm}
            shadowOffset={0}
            style={[boxSize, styles.cellState]}>
            <WarnIcon size={iconSize.md} fill={colors.warning} />
            <Text
              style={[typeStyle(typeAccent.micro, width), styles.cellStateText]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              無法取得
            </Text>
          </PixelSurface>
        </View>
      );
    }

    return (
      <View accessible accessibilityLabel="照片，已刪除">
        <PixelSurface
          background={colors.surface}
          outlineColor={colors.keepText}
          cornerRadius={radius.sm}
          shadowOffset={0}
          style={[boxSize, styles.cellState]}>
          <CheckIcon size={iconSize.md} fill={colors.keep} />
          <Text
            style={[typeStyle(typeAccent.micro, width), styles.cellStateText, styles.cellStateDone]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            已刪除
          </Text>
        </PixelSurface>
      </View>
    );
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Text
          style={[typeStyle(typeAccent.screenHeading, width), styles.heading]}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          確認待刪除照片
        </Text>
        <Caption>
          {`本次已處理 ${session.processedCount} 張。以下照片還沒有被刪除，按下刪除後 iPhone 會再要求一次確認。`}
        </Caption>

        {/* 主要整理統計：正常尺寸，是這一區的重點。 */}
        <View style={styles.stats}>
          <PixelBadge label="已保留" value={session.keptCount} tone="keep" />
          <PixelBadge label="待刪除" value={session.discardedCount} tone="discard" />
          <PixelBadge label="已刪除" value={session.deletedCount} tone="neutral" />
        </View>

        {session.discardedCount > 0 ? (
          // 照片解析狀態：包在較淡的容器裡並加點陣分隔線，視覺層級明顯低一階。
          <PixelSurface background={colors.surfaceAlt} shadowOffset={0} style={styles.resolveGroup}>
            <View style={styles.dotDivider}>
              {Array.from({ length: 24 }, (_, index) => (
                <View key={index} style={styles.dot} />
              ))}
            </View>
            <Text
              style={[typeStyle(typeAccent.micro, width), styles.groupLabel]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              照片解析狀態
            </Text>
            <View style={styles.stats}>
              <PixelBadge label="可檢視" value={resolvedCount} tone="info" />
              <PixelBadge label="解析中" value={pendingCount} tone="warning" />
              <PixelBadge label="無法取得" value={unavailableCount} tone="neutral" />
            </View>
          </PixelSurface>
        ) : null}
      </View>

      <View style={styles.stage}>
        {!granted ? (
          <PixelNotice
            tone="warning"
            title="尚未取得相簿權限"
            icon={<WarnIcon size={iconSize.sm} fill={colors.warning} />}>
            請先回到權限頁允許存取相簿。
          </PixelNotice>
        ) : recoveryLoadingText !== null ? (
          // 載入 / 自動恢復 / 人工解除進行中：鎖住操作，只顯示真實狀態。
          <View style={styles.centered}>
            <PixelSpinner size={iconSize.md} />
            <Caption>{recoveryLoadingText}</Caption>
          </View>
        ) : blockedRecoveryKind !== null ? (
          <View style={styles.emptyWrap}>{renderBlockedRecovery()}</View>
        ) : showRunCompleted && runResult ? (
          <View style={styles.emptyWrap}>
            <PixelSurface
              outlineWidth={border.widthThick}
              outlineColor={colors.keepText}
              style={styles.successCard}>
              <View style={styles.starRow}>
                <PixelStar size={10} color={colors.warning} />
                <CheckIcon size={iconSize.lg} fill={colors.keep} />
                <PixelStar size={10} color={colors.warning} />
              </View>
              <Text
                style={[typeStyle(typeAccent.sectionTitle, width), styles.successTitle]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                已完成刪除
              </Text>
              <View style={styles.stats}>
                <PixelBadge
                  label="成功刪除"
                  value={runResult.summary.successfulIds.length}
                  tone="keep"
                />
                <PixelBadge
                  label="系統確認"
                  value={runResult.systemConfirmationCount}
                  tone="neutral"
                />
              </View>
              <View style={styles.stats}>
                <PixelBadge label="剩餘待刪" value={session.discardedCount} tone="discard" />
              </View>
              <Caption>照片已移到 iPhone「照片」App 的「最近刪除」，可在那裡復原。</Caption>
            </PixelSurface>
          </View>
        ) : showRunStopped && runResult ? (
          <View style={styles.emptyWrap}>{renderStoppedSummary(runResult.summary, runResult)}</View>
        ) : showLegacySummary ? (
          <View style={styles.emptyWrap}>
            <PixelSurface
              outlineWidth={border.widthThick}
              outlineColor={colors.keepText}
              style={styles.successCard}>
              <View style={styles.starRow}>
                <PixelStar size={10} color={colors.warning} />
                <CheckIcon size={iconSize.lg} fill={colors.keep} />
                <PixelStar size={10} color={colors.warning} />
              </View>
              <Text
                style={[typeStyle(typeAccent.sectionTitle, width), styles.successTitle]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                {`已成功刪除 ${session.deletedCount} 張照片`}
              </Text>
              <View style={styles.stats}>
                <PixelBadge label="已保留" value={session.keptCount} tone="keep" />
                <PixelBadge label="待刪除" value={session.discardedCount} tone="discard" />
              </View>
              <View style={styles.stats}>
                <PixelBadge label="已刪除" value={session.deletedCount} tone="neutral" />
                <PixelBadge label="無法取得" value={unavailableCount} tone="warning" />
              </View>
              <Caption>照片已移到 iPhone「照片」App 的「最近刪除」，可在那裡復原。</Caption>
            </PixelSurface>
          </View>
        ) : session.discardedCount === 0 ? (
          <View style={styles.emptyWrap}>
            <PixelSurface style={styles.empty}>
              <Text
                style={[typeStyle(typeAccent.sectionTitle, width), styles.emptyTitle]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                目前沒有待刪除的照片
              </Text>
              <Body muted>你還沒有把任何照片標記為待刪除，或都已經改回保留了。</Body>
              <Caption>回到整理頁往左滑，就會把照片加入待刪除清單。</Caption>
            </PixelSurface>
          </View>
        ) : (
          <>
            {pendingCount > 0 ? (
              <View style={styles.statusRow}>
                {resolution.blocked ? null : <PixelSpinner size={iconSize.sm} />}
                <Caption>
                  {resolution.blocked
                    ? `相簿權限有變動，已暫停查詢（${resolvedCount} / ${session.discardedCount}）`
                    : `正在準備待刪除照片 ${resolvedCount} / ${session.discardedCount}`}
                </Caption>
                {resolution.blocked ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="重新查詢無法確認的照片"
                    hitSlop={RETRY_HIT_SLOP}
                    onPress={resolution.retryUnavailable}>
                    <Text
                      style={[typeStyle(typeAccent.micro, width), styles.retry]}
                      maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                      重新查詢
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : unavailableCount > 0 ? (
              <View style={styles.statusRow}>
                <Caption>{`已確認 ${unavailableCount} 筆無法取得`}</Caption>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重新查詢無法取得的照片"
                  hitSlop={RETRY_HIT_SLOP}
                  onPress={resolution.retryUnavailable}>
                  <Text
                    style={[typeStyle(typeAccent.micro, width), styles.retry]}
                    maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                    重新查詢
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`把 ${unavailableCount} 筆無法取得的項目移出待刪除清單`}
                  hitSlop={RETRY_HIT_SLOP}
                  onPress={handleForgetUnavailable}>
                  <Text
                    style={[typeStyle(typeAccent.micro, width), styles.retry]}
                    maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                    移出清單
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Caption>
                {readyForDeletion
                  ? `${resolvedCount} 張已全部解析完成．點縮圖可放大檢視`
                  : '點縮圖可放大檢視'}
              </Caption>
            )}

            {resolvedCount === 0 && gridItems.length === 0 ? (
              <View style={styles.emptyWrap}>
                <PixelSurface style={styles.empty}>
                  <Text
                    style={[typeStyle(typeAccent.sectionTitle, width), styles.emptyTitle]}
                    maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                    {pendingCount > 0 ? '正在解析待刪除照片' : '沒有可顯示的待刪除照片'}
                  </Text>
                  <Body muted>
                    {pendingCount > 0
                      ? '正在按 ID 查詢這些照片，查完之前不會清除任何標記。'
                      : '待刪除的照片都已不在你授權的相簿中，可以用上方的「移出清單」處理。'}
                  </Body>
                </PixelSurface>
              </View>
            ) : (
              <FlatList
                data={gridItems}
                keyExtractor={(item) => item.key}
                numColumns={COLUMNS}
                style={styles.grid}
                columnWrapperStyle={{ gap }}
                contentContainerStyle={{ gap, paddingTop: spacing.xs }}
                showsVerticalScrollIndicator={false}
                // 虛擬化 + 依格子尺寸解碼，不會一次載入所有原始大圖。
                initialNumToRender={18}
                windowSize={5}
                removeClippedSubviews
                renderItem={({ item }) => renderCell(item)}
              />
            )}
          </>
        )}
      </View>

      <View style={styles.footer}>
        {showDeleteZone ? (
          <PixelSurface
            outlineWidth={border.widthThick}
            outlineColor={colors.discardText}
            style={styles.dangerZone}>
            <View style={styles.dangerHeader}>
              <PixelBadge label="安全刪除模式" tone="discard" />
            </View>
            <Caption>
              你選擇的照片會一次送出刪除。iPhone
              會要求你確認一次，照片之後會移至「最近刪除」。
            </Caption>

            {deletion.isRunning ? (
              // 執行中：只顯示真實狀態，沒有百分比、沒有預估時間。
              <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={
                  progress
                    ? `本次準備刪除 ${progress.totalPhotos} 張。已成功刪除 ${progress.successfulCount} 張，尚未處理 ${progress.remainingCount} 張。${PHASE_TEXT[progress.phase] ?? PHASE_FALLBACK_TEXT}`
                    : '正在處理刪除'
                }
                style={styles.progressBox}>
                <View style={styles.statusRow}>
                  <PixelSpinner size={iconSize.sm} />
                  <Caption>{progress ? `本次準備刪除 ${progress.totalPhotos} 張` : PHASE_FALLBACK_TEXT}</Caption>
                </View>
                {progress ? (
                  <>
                    <View style={styles.stats}>
                      <PixelBadge
                        label="已成功刪除"
                        value={progress.successfulCount}
                        tone="keep"
                      />
                      <PixelBadge
                        label="尚未處理"
                        value={progress.remainingCount}
                        tone="discard"
                      />
                    </View>
                    <Caption>{PHASE_TEXT[progress.phase] ?? PHASE_FALLBACK_TEXT}</Caption>
                  </>
                ) : null}
              </View>
            ) : (
              <>
                {renderUiMessage()}
                {!readyForDeletion ? (
                  <Caption>需先完成解析並處理無法取得的項目，才能刪除。</Caption>
                ) : null}
              </>
            )}

            <AppButton
              label={
                deletion.isRunning
                  ? '正在刪除…'
                  : resolvedCount > 0
                    ? `刪除 ${resolvedCount} 張照片`
                    : '尚無可刪除的照片'
              }
              variant="danger"
              disabled={!canDelete}
              onPress={handleRequestDelete}
            />
          </PixelSurface>
        ) : null}

        {showRunCompleted || showLegacySummary ? (
          <>
            <AppButton
              label="繼續整理"
              disabled={navigationLocked}
              onPress={handleContinueAfterRun}
            />
            <AppButton
              label="返回首頁"
              variant="secondary"
              disabled={navigationLocked}
              onPress={() => void handleSaveAndGoHome()}
            />
          </>
        ) : (
          <>
            <AppButton
              label="儲存進度並返回首頁"
              disabled={navigationLocked}
              onPress={() => void handleSaveAndGoHome()}
            />
            <AppButton
              label="返回繼續整理"
              variant="secondary"
              disabled={navigationLocked}
              onPress={() => router.back()}
            />
          </>
        )}
      </View>

      <Modal
        visible={previewPhoto !== undefined}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreviewIndex(null)}>
        {/* accessibilityViewIsModal：VoiceOver 焦點鎖在預覽內，不會跑回底下的網格。 */}
        <View accessibilityViewIsModal style={styles.modal}>
          {previewPhoto && previewIndex !== null ? (
            <View
              style={[
                styles.modalInner,
                {
                  paddingTop: insets.top + spacing.md,
                  paddingBottom: insets.bottom + spacing.md,
                  paddingLeft: Math.max(insets.left, spacing.md),
                  paddingRight: Math.max(insets.right, spacing.md),
                },
              ]}>
              <View style={styles.modalHeader}>
                <Caption>{`${previewIndex + 1} / ${resolvedCount}`}</Caption>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="關閉預覽"
                  hitSlop={12}
                  onPress={() => setPreviewIndex(null)}
                  style={styles.closeHit}>
                  <Text
                    style={[typeStyle(typeAccent.button, width), styles.close]}
                    maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                    關閉
                  </Text>
                </Pressable>
              </View>

              {/* 照片放在深色中性底上比較好看；硬陰影由 PixelSurface 畫在裁切層外面。 */}
              <PixelSurface
                background={colors.outline}
                wrapperStyle={styles.modalPhotoWrapper}
                style={styles.modalPhotoBox}
                clip>
                <Image
                  source={{ uri: previewPhoto.uri }}
                  style={styles.modalPhoto}
                  // 全螢幕預覽維持 aspectFit，不裁切照片。
                  contentFit="contain"
                  allowDownscaling
                  recyclingKey={previewPhoto.id}
                  cachePolicy="memory-disk"
                  transition={120}
                />
              </PixelSurface>

              <View style={styles.modalFooter}>
                <Caption>{formatPhotoDate(previewPhoto.createdAt)}</Caption>
                <View style={styles.modalNav}>
                  <View style={styles.navSlot}>
                    <AppButton
                      label="上一張"
                      variant="secondary"
                      disabled={previewIndex === 0}
                      onPress={() => setPreviewIndex((current) => Math.max((current ?? 0) - 1, 0))}
                    />
                  </View>
                  <View style={styles.navSlot}>
                    <AppButton
                      label="下一張"
                      variant="secondary"
                      disabled={previewIndex >= resolvedCount - 1}
                      onPress={() =>
                        setPreviewIndex((current) =>
                          Math.min((current ?? 0) + 1, resolvedCount - 1)
                        )
                      }
                    />
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="把這張照片改為保留"
                  onPress={() => handleKeepInstead(previewPhoto.id)}>
                  {({ pressed }) => (
                    <PixelSurface
                      outlineWidth={border.widthThick}
                      outlineColor={colors.keepText}
                      shadowOffset={pressed ? shadow.pressOffset : shadow.offset}
                      style={[
                        styles.keepBack,
                        pressed ? { transform: [{ translateY: shadow.pressOffset }] } : null,
                      ]}>
                      <CheckIcon size={iconSize.md} fill={colors.keep} />
                      <Text
                        style={[typeStyle(typeAccent.button, width), styles.keepBackText]}
                        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                        改為保留
                      </Text>
                    </PixelSurface>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.ms,
  },
  header: {
    gap: spacing.sm,
  },
  heading: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  /** 解析狀態的容器：無陰影、淡底，視覺層級低於主要統計。 */
  resolveGroup: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.ms,
  },
  dotDivider: {
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    paddingTop: spacing.sm,
  },
  dot: {
    backgroundColor: colors.outline,
    height: 2,
    opacity: 0.35,
    width: 2,
  },
  // 字級與 lineHeight 都交給 typeAccent.micro，這裡只留顏色。
  groupLabel: {
    color: colors.textSecondary,
  },
  stage: {
    flex: 1,
    gap: spacing.xs,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  retry: {
    color: colors.warningText,
    fontWeight: '600',
  },
  grid: {
    flex: 1,
  },
  cellPressed: {
    opacity: 0.7,
  },
  /** 非照片狀態格：置中的圖示 + 文字，不只靠顏色。 */
  cellState: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  cellStateText: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
  cellStateDone: {
    color: colors.keepText,
    fontWeight: '700',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  successCard: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  starRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  star: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    color: colors.keepText,
    fontWeight: '700',
    textAlign: 'center',
  },
  footer: {
    gap: spacing.sm,
  },
  /** 安全刪除區：3px discard 描邊，但底色維持 surface，不用整塊高飽和紅。 */
  dangerZone: {
    gap: spacing.sm,
    padding: spacing.ms,
  },
  dangerHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  /** 載入／恢復進行中的置中提示。 */
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.md,
  },
  /** 執行中的進度區塊。 */
  progressBox: {
    gap: spacing.sm,
  },
  /** 恢復與停止摘要的容器：沿用像素風間距，不新增視覺語言。 */
  recoveryWrap: {
    gap: spacing.sm,
  },
  modal: {
    backgroundColor: colors.background,
    flex: 1,
  },
  modalInner: {
    flex: 1,
    gap: spacing.sm,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  closeHit: {
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  close: {
    color: colors.primaryText,
    fontWeight: '700',
    textAlign: 'right',
  },
  modalPhotoWrapper: {
    flex: 1,
  },
  modalPhotoBox: {
    flex: 1,
  },
  modalPhoto: {
    flex: 1,
    width: '100%',
  },
  modalFooter: {
    gap: spacing.sm,
  },
  modalNav: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  navSlot: {
    flex: 1,
  },
  keepBack: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
  },
  keepBackText: {
    color: colors.keepText,
  },
});
