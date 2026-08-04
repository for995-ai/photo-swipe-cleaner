import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

import { CheckIcon } from '@/components/icons';
import { AppButton, Body, Caption, Notice, Screen, StatChip } from '@/components/ui';
import { useCleanup } from '@/hooks/use-cleanup';
import { useDiscardedResolver } from '@/hooks/use-discarded-resolver';
import { formatPhotoDate } from '@/lib/photos';
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

const COLUMNS = 3;

export default function ReviewScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { granted, pager, session } = useCleanup();

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

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

  /** 未來的真正刪除按鈕只能在這個條件成立時啟用。 */
  const readyForDeletion = pendingCount === 0 && unavailableCount === 0 && resolvedCount > 0;

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

  const handleSaveAndGoHome = async () => {
    // 本輪只保存結果，不刪除任何照片。
    await session.saveNow();
    router.dismissAll();
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Text style={[styles.heading, { fontSize: scaleFont(21, width) }]}>本次整理結果</Text>
        <Caption>{`本次已整理 ${session.decidedCount} 張`}</Caption>
        <View style={styles.stats}>
          <StatChip label="保留" value={session.keptCount} tone="keep" />
          <StatChip label="待刪除" value={session.discardedCount} tone="discard" />
        </View>
        {session.discardedCount > 0 ? (
          <View style={styles.stats}>
            <StatChip label="可檢視" value={resolvedCount} tone="info" />
            <StatChip label="解析中" value={pendingCount} tone="warning" />
            <StatChip label="無法取得" value={unavailableCount} tone="neutral" />
          </View>
        ) : null}
      </View>

      <View style={styles.stage}>
        {!granted ? (
          <Notice tone="warning" title="尚未取得相簿權限">
            請先回到權限頁允許存取相簿。
          </Notice>
        ) : session.discardedCount === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { fontSize: scaleFont(18, width) }]}>
                目前沒有待刪除的照片
              </Text>
              <Body muted>你還沒有把任何照片標記為待刪除，或都已經改回保留了。</Body>
              <Caption>回到整理頁往左滑，就會把照片加入待刪除清單。</Caption>
            </View>
          </View>
        ) : (
          <>
            {pendingCount > 0 ? (
              <View style={styles.statusRow}>
                {resolution.blocked ? null : <ActivityIndicator size="small" />}
                <Caption>
                  {resolution.blocked
                    ? `相簿權限有變動，已暫停查詢（${resolvedCount} / ${session.discardedCount}）`
                    : `正在準備待刪除照片 ${resolvedCount} / ${session.discardedCount}`}
                </Caption>
                {resolution.blocked ? (
                  <Pressable accessibilityRole="button" onPress={resolution.retryUnavailable}>
                    <Text style={[styles.retry, { fontSize: scaleFont(12, width) }]}>重新查詢</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : unavailableCount > 0 ? (
              <View style={styles.statusRow}>
                <Caption>{`已確認 ${unavailableCount} 筆無法取得`}</Caption>
                <Pressable accessibilityRole="button" onPress={resolution.retryUnavailable}>
                  <Text style={[styles.retry, { fontSize: scaleFont(12, width) }]}>重新查詢</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={handleForgetUnavailable}>
                  <Text style={[styles.retry, { fontSize: scaleFont(12, width) }]}>移出清單</Text>
                </Pressable>
              </View>
            ) : (
              <Caption>
                {readyForDeletion
                  ? `${resolvedCount} 張已全部解析完成．點縮圖可放大檢視`
                  : '點縮圖可放大檢視'}
              </Caption>
            )}

            {resolvedCount === 0 ? (
              <View style={styles.emptyWrap}>
                <View style={styles.empty}>
                  <Text style={[styles.emptyTitle, { fontSize: scaleFont(18, width) }]}>
                    {pendingCount > 0 ? '正在解析待刪除照片' : '沒有可顯示的待刪除照片'}
                  </Text>
                  <Body muted>
                    {pendingCount > 0
                      ? '正在按 ID 查詢這些照片，查完之前不會清除任何標記。'
                      : '待刪除的照片都已不在你授權的相簿中，可以用上方的「移出清單」處理。'}
                  </Body>
                </View>
              </View>
            ) : (
              <FlatList
                data={resolution.resolved}
                keyExtractor={(item) => item.id}
                numColumns={COLUMNS}
                style={styles.grid}
                columnWrapperStyle={{ gap }}
                contentContainerStyle={{ gap, paddingTop: spacing.xs }}
                showsVerticalScrollIndicator={false}
                // 虛擬化 + 依格子尺寸解碼，不會一次載入所有原始大圖。
                initialNumToRender={18}
                windowSize={5}
                removeClippedSubviews
                renderItem={({ item, index }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`第 ${index + 1} 張待刪除照片`}
                    onPress={() => setPreviewIndex(index)}
                    style={({ pressed }) => [pressed && styles.cellPressed]}>
                    <Image
                      source={{ uri: item.uri }}
                      style={{ width: cellSize, height: cellSize, borderRadius: radius.sm }}
                      contentFit="cover"
                      allowDownscaling
                      recyclingKey={item.id}
                      cachePolicy="memory-disk"
                      transition={100}
                    />
                  </Pressable>
                )}
              />
            )}
          </>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.safeBanner}>
          <Text style={[styles.safeBannerText, { fontSize: scaleFont(13, width) }]}>
            安全測試模式：目前不會刪除照片
          </Text>
        </View>
        <AppButton label="儲存進度並返回首頁" onPress={() => void handleSaveAndGoHome()} />
        <AppButton label="返回繼續整理" variant="secondary" onPress={() => router.back()} />
      </View>

      <Modal
        visible={previewPhoto !== undefined}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreviewIndex(null)}>
        <View style={styles.modal}>
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
                  onPress={() => setPreviewIndex(null)}>
                  <Text style={[styles.close, { fontSize: scaleFont(15, width) }]}>關閉</Text>
                </Pressable>
              </View>

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
                  onPress={() => handleKeepInstead(previewPhoto.id)}
                  style={({ pressed }) => [styles.keepBack, pressed && styles.cellPressed]}>
                  <CheckIcon size={18} color={colors.keep} />
                  <Text style={[styles.keepBackText, { fontSize: scaleFont(15, width) }]}>
                    改為保留
                  </Text>
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
    gap: spacing.md,
  },
  header: {
    gap: spacing.sm,
  },
  heading: {
    color: colors.text,
    fontWeight: '700',
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stage: {
    flex: 1,
    gap: spacing.xs,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  retry: {
    color: colors.warning,
    fontWeight: '600',
  },
  grid: {
    flex: 1,
  },
  cellPressed: {
    opacity: 0.7,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontWeight: '700',
  },
  footer: {
    gap: spacing.sm,
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
  close: {
    color: colors.accent,
    fontWeight: '600',
  },
  modalPhoto: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
    backgroundColor: colors.surface,
    borderColor: colors.keep,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 3,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
  },
  keepBackText: {
    color: colors.keep,
    fontWeight: '700',
  },
});
