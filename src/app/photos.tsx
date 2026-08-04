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
import { PREFETCH_THRESHOLD } from '@/hooks/use-photo-library';
import { formatPhotoDate } from '@/lib/photos';
import type { Decision } from '@/lib/session';
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

export default function PhotosScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // 權限、分頁與進度都來自 root layout 的 CleanupProvider，
  // 所以進出確認頁不會重新讀取相簿，也不會清掉整理進度。
  const { access, granted, pager, session } = useCleanup();
  const accessLevel = access.access?.level;

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
    Alert.alert(
      '重置本次進度？',
      '會清除目前的保留與待刪除紀錄，從第 1 張重新開始。你的照片本身不會有任何變動。',
      [
        { text: '取消', style: 'cancel' },
        { text: '重置', style: 'destructive', onPress: () => session.reset() },
      ]
    );
  };

  const restoring = granted && !session.ready;
  const totalLabel = pager.totalCount > 0 ? `約 ${pager.totalCount}` : `${loaded}`;

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { fontSize: scaleFont(19, width) }]}>照片整理</Text>
          <Caption>{`已整理 ${session.decidedCount} / ${totalLabel} 張`}</Caption>
        </View>
        <ProgressBar
          value={session.decidedCount}
          total={pager.totalCount > 0 ? pager.totalCount : loaded}
        />
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
        ) : pager.loadingFirstPage || restoring ? (
          <View style={styles.centered}>
            <ActivityIndicator />
            <Caption>{restoring ? '正在還原上次的整理進度…' : '正在讀取照片…'}</Caption>
          </View>
        ) : pager.error ? (
          <Notice tone="danger" title="讀取相簿失敗">
            {pager.error}
          </Notice>
        ) : loaded === 0 ? (
          <Notice title="沒有可整理的照片">
            {accessLevel === 'limited'
              ? '你目前只授權了有限存取，且尚未選取任何照片。請回到權限頁按「選擇更多照片」。'
              : '相簿中找不到照片（影片不會被列入）。拍幾張照片後再回來試試。'}
          </Notice>
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
          <Text style={[styles.safeBannerText, { fontSize: scaleFont(13, width) }]}>
            安全測試模式：目前不會刪除照片
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
