import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { CheckIcon, TrashIcon, UndoIcon } from '@/components/icons';
import { OnboardingModal } from '@/components/onboarding-modal';
import { SwipeCard, type SwipeCardHandle } from '@/components/swipe-card';
import {
  ActionButton,
  AppButton,
  Body,
  Caption,
  Notice,
  ProgressBar,
  Screen,
  StatChip,
} from '@/components/ui';
import { useCleanup } from '@/hooks/use-cleanup';
import { useOnboarding } from '@/hooks/use-onboarding';
import { PREFETCH_THRESHOLD } from '@/hooks/use-photo-library';
import { describeError, formatPhotoDate, pickMorePhotosAsync } from '@/lib/photos';
import { scopeLabel } from '@/lib/scope';
import type { Decision } from '@/lib/session';
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

export default function PhotosScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // 權限、分頁與進度都來自 root layout 的 CleanupProvider，
  // 所以進出確認頁不會重新讀取相簿，也不會清掉整理進度。
  const { access, granted, scopeController, albumAvailability, pager, session } = useCleanup();
  const accessLevel = access.access?.level;
  const currentScope = scopeController.scope;
  const currentScopeLabel = scopeLabel(currentScope);

  // 只離開一次，避免 deactivate 與 activated 守門互相觸發重複導覽。
  const leaving = useRef(false);
  const albumMissing = albumAvailability.status === 'missing';
  const needsScopeSelection = scopeController.ready && !scopeController.activated;

  useEffect(() => {
    if (leaving.current) {
      return;
    }

    // 相簿已明確消失或不可存取：停用範圍（不清進度）並帶著提示回範圍頁。
    if (albumMissing) {
      leaving.current = true;
      scopeController.deactivate();
      scopeController.raiseNotice('原本選擇的相簿已無法存取，請重新選擇整理範圍。');
      router.replace('/scope');
      return;
    }

    // 沒有經過範圍頁就進到這裡（導覽狀態恢復、深層連結）：安全退回，不啟動 pager。
    if (needsScopeSelection) {
      leaving.current = true;
      router.replace('/scope');
    }
  }, [albumMissing, needsScopeSelection, scopeController, router]);

  const onboarding = useOnboarding();
  const [pickerError, setPickerError] = useState<string | null>(null);

  /** 沿用既有的 presentPermissionsPickerAsync 流程，不新增任何權限 API。 */
  const handlePickMore = async () => {
    setPickerError(null);
    try {
      await pickMorePhotosAsync();
      await access.refresh();
      albumAvailability.recheck();
    } catch (cause) {
      setPickerError(describeError(cause, '無法開啟照片選擇畫面'));
    }
  };

  const cardRef = useRef<SwipeCardHandle>(null);
  const [busy, setBusy] = useState(false);
  const [failedIds, setFailedIds] = useState<string[]>([]);

  const loaded = pager.photos.length;
  const cursorIndex = session.cursorIndex;
  const photo = cursorIndex < loaded ? pager.photos[cursorIndex] : undefined;
  const remaining = loaded - cursorIndex;

  // 只有「已載入的都整理完 + 確定沒有下一頁 + 沒有分頁錯誤」才算完成。
  const finished =
    session.ready &&
    !pager.loadingFirstPage &&
    loaded > 0 &&
    !photo &&
    !pager.hasNextPage &&
    !pager.loadMoreError;

  // 距離已載入陣列尾端剩 PREFETCH_THRESHOLD 張時就預先載入下一頁。
  const { hasNextPage, isLoadingMore, loadMore } = pager;
  const sessionReady = session.ready;
  useEffect(() => {
    if (sessionReady && hasNextPage && !isLoadingMore && remaining <= PREFETCH_THRESHOLD) {
      loadMore();
    }
  }, [sessionReady, hasNextPage, isLoadingMore, remaining, loadMore]);

  // 卡片換照片時解除鎖定，避免動畫被中斷後按鈕一直停用。
  useEffect(() => {
    setBusy(false);
  }, [photo?.id, finished]);

  // 滑動與底部按鈕都走這裡：先播卡片動畫，再由卡片回呼寫入決定。
  const requestDecision = (decision: Decision) => {
    if (!photo || busy) {
      return;
    }
    cardRef.current?.swipeOut(decision);
  };

  const handleUndo = () => {
    if (busy || !session.canUndo) {
      return;
    }
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync().catch(() => {});
    }
    session.undo();
  };

  const handleReset = () => {
    // 只清整理紀錄。已刪除的照片留在 iPhone「最近刪除」，本 App 不會、也不能復原它們。
    Alert.alert(
      '重置本次整理紀錄？',
      '這會清除保留、待刪除與已刪除的統計紀錄，但不會復原已移至 iPhone「最近刪除」的照片。如需復原，請前往 iPhone「照片」App 的「最近刪除」。',
      [
        { text: '取消', style: 'cancel' },
        { text: '清除整理紀錄', style: 'destructive', onPress: () => session.reset() },
      ]
    );
  };

  const restoring = granted && !session.ready;
  // 分母改用單調遞增的估計值：刪除照片後不會掉下來，已處理數也不會超過總數。
  const totalEstimate = Math.max(session.sessionTotalEstimate, session.processedCount, loaded);

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {/* 標頭直接顯示目前整理範圍。 */}
          <Text
            style={[styles.heading, { fontSize: scaleFont(19, width) }]}
            numberOfLines={1}>
            {currentScopeLabel}
          </Text>
          <Caption>{`已處理 ${session.processedCount} / 約 ${totalEstimate} 張`}</Caption>
        </View>
        <ProgressBar value={session.processedCount} total={totalEstimate} />
        <View style={styles.headerRow}>
          <View style={styles.stats}>
            <StatChip label="保留" value={session.keptCount} tone="keep" />
            <StatChip label="待刪除" value={session.discardedCount} tone="discard" />
          </View>
          <View style={styles.loadSlot}>
            {pager.isLoadingMore ? (
              <>
                <ActivityIndicator size="small" />
                <Caption>載入更多…</Caption>
              </>
            ) : pager.loadMoreError ? (
              <Pressable accessibilityRole="button" onPress={pager.retryLoadMore}>
                <Text style={[styles.retry, { fontSize: scaleFont(12, width) }]}>
                  載入失敗，重試
                </Text>
              </Pressable>
            ) : (
              <Caption>{`已載入 ${loaded} 張`}</Caption>
            )}
          </View>
        </View>
      </View>

      <View style={styles.stage}>
        {!granted ? (
          <Notice tone="warning" title="尚未取得相簿權限">
            請先回到權限頁按下「允許存取」，授權後才能整理照片。
          </Notice>
        ) : needsScopeSelection || albumMissing ? (
          // 正在退回範圍頁：給明確訊息，不留白也不無限轉圈。
          <View style={styles.centered}>
            <Caption>
              {albumMissing ? '相簿已無法存取，正在返回範圍選擇…' : '正在返回範圍選擇…'}
            </Caption>
            <AppButton
              label="回到範圍選擇"
              variant="secondary"
              onPress={() => router.replace('/scope')}
            />
          </View>
        ) : albumAvailability.status === 'checking' ? (
          <View style={styles.centered}>
            <ActivityIndicator />
            <Caption>正在確認相簿是否仍可存取…</Caption>
          </View>
        ) : albumAvailability.status === 'unknown-limited' ? (
          // 有限存取下清單可能不完整，所以不能說相簿已刪除；
          // pager 仍保持停用，避免帶著失效的 albumId 去查詢。
          <View style={styles.centered}>
            <Notice tone="warning" title="目前無法確認這個相簿">
              iPhone 目前只允許存取部分照片，因此無法確認原本的相簿是否仍可使用。你可以增加允許的照片，或重新選擇整理範圍。
            </Notice>
            {pickerError ? (
              <Notice tone="danger" title="發生問題">
                {pickerError}
              </Notice>
            ) : null}
            {Platform.OS !== 'web' ? (
              <AppButton label="選擇更多照片" onPress={() => void handlePickMore()} />
            ) : null}
            <AppButton label="重新檢查" variant="secondary" onPress={albumAvailability.recheck} />
            <AppButton
              label="改選其他範圍"
              variant="ghost"
              onPress={() => router.replace('/scope')}
            />
          </View>
        ) : albumAvailability.status === 'unknown' ? (
          // 暫時無法確認 ≠ 相簿已刪除，保留重試而不是直接判定失效。
          <View style={styles.centered}>
            <Notice tone="warning" title="暫時無法確認相簿狀態">
              可能是暫時的讀取問題，照片與整理紀錄都沒有變動。可以重試一次。
            </Notice>
            <AppButton label="重試" variant="secondary" onPress={albumAvailability.recheck} />
            <AppButton
              label="改選其他範圍"
              variant="ghost"
              onPress={() => router.replace('/scope')}
            />
          </View>
        ) : pager.loadingFirstPage || restoring ? (
          <View style={styles.centered}>
            <ActivityIndicator />
            <Caption>{restoring ? '正在還原上次的整理進度…' : '正在讀取照片…'}</Caption>
          </View>
        ) : pager.error ? (
          // 相簿被刪除或失去權限時走這裡：顯示訊息並讓使用者回範圍選擇頁，不閃退。
          <View style={styles.centered}>
            <Notice tone="danger" title={`無法讀取「${currentScopeLabel}」`}>
              {currentScope.type === 'album'
                ? '這個相簿可能已被刪除，或你已不再擁有它的存取權限。請重新選擇整理範圍。'
                : pager.error}
            </Notice>
            <AppButton
              label="重新選擇整理範圍"
              variant="secondary"
              onPress={() => router.replace('/scope')}
            />
          </View>
        ) : loaded === 0 ? (
          <View style={styles.centered}>
            <Notice title={`「${currentScopeLabel}」沒有可整理的照片`}>
              {accessLevel === 'limited'
                ? '你目前只授權了有限存取，這個範圍內沒有已授權的照片。可回權限頁按「選擇更多照片」，或換一個範圍。'
                : currentScope.type === 'all'
                  ? '相簿中找不到照片（影片不會被列入）。拍幾張照片後再回來試試。'
                  : '這個範圍內找不到照片（影片不會被列入）。可以換一個範圍再試。'}
            </Notice>
            <AppButton
              label="換一個整理範圍"
              variant="secondary"
              onPress={() => router.replace('/scope')}
            />
          </View>
        ) : photo ? (
          <SwipeCard
            ref={cardRef}
            photo={photo}
            failed={failedIds.includes(photo.id)}
            onLoadError={() =>
              setFailedIds((current) =>
                current.includes(photo.id) ? current : [...current, photo.id]
              )
            }
            onBusyChange={setBusy}
            onDecided={(decision) => session.decide(photo.id, decision)}
          />
        ) : pager.loadMoreError ? (
          <Notice tone="danger" title="載入更多照片失敗">
            {pager.loadMoreError}
          </Notice>
        ) : pager.hasNextPage ? (
          <View style={styles.centered}>
            <ActivityIndicator />
            <Caption>正在載入更多照片…</Caption>
          </View>
        ) : (
          <View style={styles.done}>
            <Text style={[styles.doneTitle, { fontSize: scaleFont(22, width) }]}>整理完成</Text>
            <Body muted>
              已授權的 {loaded} 張都看過了：保留 {session.keptCount} 張、待刪除{' '}
              {session.discardedCount} 張。
            </Body>
            <Caption>
              待刪除清單只是標記，本階段不會真的刪除照片。批次刪除會在後續階段實作。
            </Caption>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Caption>{photo ? formatPhotoDate(photo.createdAt) : '—'}</Caption>

        <View style={styles.actions}>
          <View style={styles.actionSlot}>
            <ActionButton
              label="待刪除"
              tone="discard"
              disabled={!photo || busy}
              icon={<TrashIcon size={20} color={colors.discard} />}
              onPress={() => requestDecision('discard')}
            />
          </View>
          <View style={styles.actionSlot}>
            <ActionButton
              label="復原"
              tone="neutral"
              disabled={!session.canUndo || busy}
              icon={<UndoIcon size={20} color={colors.textMuted} />}
              onPress={handleUndo}
            />
          </View>
          <View style={styles.actionSlot}>
            <ActionButton
              label="保留"
              tone="keep"
              disabled={!photo || busy}
              icon={<CheckIcon size={20} color={colors.keep} />}
              onPress={() => requestDecision('keep')}
            />
          </View>
        </View>

        <View style={styles.safeBanner}>
          <Text style={[styles.safeBannerText, { fontSize: scaleFont(12, width) }]}>
            滑動只會標記；需在確認頁並經 iPhone 系統確認後才會刪除
          </Text>
        </View>

        {/* 隨時可以結束本次整理去檢查待刪除清單，進度不會被清除。 */}
        <AppButton
          label="結束本次整理"
          variant="secondary"
          disabled={busy}
          onPress={() => router.push('/review')}
        />

        <View style={styles.ghostRow}>
          <View style={styles.actionSlot}>
            {pager.error ? (
              <AppButton label="重新讀取" variant="ghost" onPress={pager.reload} />
            ) : (
              <AppButton
                label="重置本次進度"
                variant="ghost"
                disabled={loaded === 0 || busy}
                onPress={handleReset}
              />
            )}
          </View>
          <View style={styles.actionSlot}>
            <AppButton label="返回" variant="ghost" onPress={() => router.back()} />
          </View>
        </View>
      </View>

      {/* 首次使用教學：只在還沒看過時顯示。 */}
      <OnboardingModal visible={onboarding.completed === false} onDone={onboarding.complete} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.md,
  },
  header: {
    gap: spacing.sm,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heading: {
    color: colors.text,
    fontWeight: '700',
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  loadSlot: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  retry: {
    color: colors.warning,
    fontWeight: '600',
  },
  // flex:1 讓卡片吃掉剩餘空間，各尺寸 iPhone 的上下區塊都不會被推出畫面。
  stage: {
    flex: 1,
    justifyContent: 'center',
  },
  centered: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.md,
  },
  done: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  doneTitle: {
    color: colors.keep,
    fontWeight: '700',
  },
  footer: {
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionSlot: {
    flex: 1,
  },
  safeBanner: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.keep,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  safeBannerText: {
    color: colors.keep,
    fontWeight: '600',
    textAlign: 'center',
  },
  ghostRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
