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
import { MAX_DELETE_COUNT_PER_BATCH, deletePhotoAssetsAsync } from '@/lib/delete-service';
import { formatPhotoDate, type RecentPhoto } from '@/lib/photos';
import { border, colors, iconSize, radius, shadow, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

const COLUMNS = 3;

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
  const { granted, pager, session } = useCleanup();

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  // 立即生效的重複點擊防護（setState 是非同步的，來不及擋連點）。
  const deletingRef = useRef(false);

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
    resolvedCount > 0 &&
    pendingCount === 0 &&
    unavailableCount === 0 &&
    !resolution.resolving &&
    !deleting;

  /** 安全上限：超過就停用按鈕。 */
  const overBatchLimit = resolvedCount > MAX_DELETE_COUNT_PER_BATCH;
  const canDelete = readyForDeletion && !overBatchLimit;

  /** 待刪除已清空且真的刪過照片 → 顯示成功摘要，並收掉刪除區塊。 */
  const showSuccessSummary = session.discardedCount === 0 && session.deletedCount > 0;
  /** 沒有待刪除項目時就不要顯示「刪除 0 張照片」。 */
  const showDeleteZone = session.discardedCount > 0;

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

  const handleKeepInstead = (photoId: string) => {
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync().catch(() => {});
    }
    session.keepInstead(photoId);
  };

  const handleForgetUnavailable = () => {
    const ids = resolution.unavailableIds;
    if (ids.length === 0) {
      return;
    }
    Alert.alert(
      `處理 ${ids.length} 筆無法取得的項目？`,
      '這些照片已不在你授權的相簿中，會從本次的待刪除清單移除。相簿本身不會有任何變動。',
      [
        { text: '取消', style: 'cancel' },
        { text: '移出清單', onPress: () => session.forget(ids) },
      ]
    );
  };

  const runDelete = async (ids: string[]) => {
    if (deletingRef.current) {
      return;
    }
    deletingRef.current = true;
    setDeleting(true);
    setDeleteMessage(null);

    try {
      const outcome = await deletePhotoAssetsAsync(ids);

      if (outcome.status === 'deleted') {
        // 只移除確定刪掉的 id；keptIds 與其他未處理進度完全不動。
        session.removeDeleted(outcome.ids);
        resolution.dropFromCache(outcome.ids);
        pager.reload();
        setDeleteMessage(`已刪除 ${outcome.ids.length} 張照片`);
        Alert.alert('已完成刪除', `已刪除 ${outcome.ids.length} 張照片`);
      } else if (outcome.status === 'cancelled') {
        // 不動 discardedIds、不動 history。
        setDeleteMessage('你已取消刪除，照片沒有變更');
      } else {
        setDeleteMessage(outcome.message);
      }
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const handleRequestDelete = () => {
    if (!canDelete) {
      return;
    }
    // 只把「可檢視」的 id 送進刪除服務。
    const ids = resolution.resolved.map((photo) => photo.id);
    Alert.alert(
      '確認刪除照片？',
      `將把 ${ids.length} 張照片移至 iPhone「最近刪除」。照片通常可在 30 天內從「照片」App 復原，接下來 iPhone 仍會再次要求確認。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '繼續', style: 'destructive', onPress: () => void runDelete(ids) },
      ]
    );
  };

  const handleSaveAndGoHome = async () => {
    // 本輪只保存結果，不刪除任何照片。
    await session.saveNow();
    router.dismissAll();
  };

  /** 取消／失敗訊息用 PixelNotice 呈現，語意分開：取消是 warning、失敗是 danger。 */
  const deleteOutcomeTone: 'warning' | 'danger' | null = deleteMessage
    ? deleteMessage.startsWith('已刪除')
      ? null
      : deleteMessage.startsWith('你已取消')
        ? 'warning'
        : 'danger'
    : null;

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
        ) : showSuccessSummary ? (
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
              {`每次最多確認刪除 ${MAX_DELETE_COUNT_PER_BATCH} 張照片。按下後照片會移至 iPhone「最近刪除」，刪除前仍會由 iPhone 再次確認。`}
            </Caption>

            {deleting ? (
              <View style={styles.statusRow}>
                <PixelSpinner size={iconSize.sm} />
                <Caption>正在等待 iPhone 系統確認…</Caption>
              </View>
            ) : deleteOutcomeTone ? (
              <PixelNotice
                tone={deleteOutcomeTone}
                compact
                icon={
                  <WarnIcon
                    size={iconSize.sm}
                    fill={deleteOutcomeTone === 'warning' ? colors.warning : colors.discard}
                  />
                }>
                {deleteMessage}
              </PixelNotice>
            ) : deleteMessage ? (
              <Caption>{deleteMessage}</Caption>
            ) : overBatchLimit ? (
              <Text
                style={[typeStyle(typeAccent.micro, width), styles.dangerHint]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                {`每次最多刪除 ${MAX_DELETE_COUNT_PER_BATCH} 張，請先將待刪除數量減至 ${MAX_DELETE_COUNT_PER_BATCH} 張以內`}
              </Text>
            ) : !readyForDeletion ? (
              <Caption>需先完成解析並處理無法取得的項目，才能刪除。</Caption>
            ) : null}

            <AppButton
              label={
                deleting
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

        {showSuccessSummary ? (
          <>
            <AppButton label="繼續整理" onPress={() => router.back()} />
            <AppButton
              label="返回首頁"
              variant="secondary"
              onPress={() => void handleSaveAndGoHome()}
            />
          </>
        ) : (
          <>
            <AppButton
              label="儲存進度並返回首頁"
              disabled={deleting}
              onPress={() => void handleSaveAndGoHome()}
            />
            <AppButton
              label="返回繼續整理"
              variant="secondary"
              disabled={deleting}
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
  dangerHint: {
    color: colors.warningText,
    fontWeight: '600',
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
