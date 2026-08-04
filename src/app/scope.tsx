import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { CheckIcon } from '@/components/icons';
import { AppButton, Body, Caption, Notice, Screen, Title } from '@/components/ui';
import { useCleanup } from '@/hooks/use-cleanup';
import { describeError, loadPhotoAlbumsAsync, type PhotoAlbum } from '@/lib/photos';
import {
  MONTH_OPTION_COUNT,
  RECENT_DAYS,
  SCREENSHOT_SUPPORTED,
  listRecentMonths,
  scopeKey,
  scopeLabel,
  type CleanupScope,
} from '@/lib/scope';
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

type Panel = 'none' | 'month' | 'album';

export default function ScopeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { access, granted, scopeController, session } = useCleanup();
  const accessLevel = access.access?.level;

  const [panel, setPanel] = useState<Panel>('none');
  const [albums, setAlbums] = useState<PhotoAlbum[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsError, setAlbumsError] = useState<string | null>(null);

  const currentKey = scopeKey(scopeController.scope);
  // 目前範圍已經整理過東西，切換前要先提醒（舊進度仍會各自保留）。
  const hasProgress = session.ready && session.processedCount > 0;

  const loadAlbums = useCallback(() => {
    setAlbumsLoading(true);
    setAlbumsError(null);
    loadPhotoAlbumsAsync()
      .then(setAlbums)
      .catch((cause: unknown) => setAlbumsError(describeError(cause, '讀取相簿清單失敗')))
      .finally(() => setAlbumsLoading(false));
  }, []);

  // 只有取得讀取權限、且使用者展開「指定相簿」時才會呼叫 getAlbumsAsync。
  useEffect(() => {
    if (panel === 'album' && granted && albums.length === 0 && !albumsLoading && !albumsError) {
      loadAlbums();
    }
  }, [panel, granted, albums.length, albumsLoading, albumsError, loadAlbums]);

  // 權限若在背景被關掉，收起相簿面板並丟掉已讀到的清單。
  useEffect(() => {
    if (!granted) {
      setAlbums([]);
      setAlbumsError(null);
      setPanel('none');
    }
  }, [granted]);

  /**
   * 選定範圍並開始整理的唯一入口。
   * 「繼續整理」與「選擇新範圍」都走這裡：設定 scope → 設定 activated → 進 /photos。
   */
  const activateAndOpen = (next: CleanupScope) => {
    scopeController.clearNotice();
    scopeController.select(next);
    router.push('/photos');
  };

  const chooseScope = (next: CleanupScope) => {
    // 沒有讀取權限時完全不允許選定，避免任何相簿查詢。
    if (!granted) {
      router.push('/permission');
      return;
    }
    if (scopeKey(next) === currentKey || !hasProgress) {
      activateAndOpen(next);
      return;
    }
    Alert.alert(
      '要切換整理範圍嗎？',
      `「${scopeLabel(scopeController.scope)}」已整理 ${session.processedCount} 張。切換到「${scopeLabel(next)}」後會改用該範圍自己的進度，原本的紀錄會保留在原範圍，不會被覆蓋。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '切換範圍', onPress: () => activateAndOpen(next) },
      ]
    );
  };

  const renderOption = (
    scope: CleanupScope,
    title: string,
    detail: string,
    options?: { disabled?: boolean; onPress?: () => void; trailing?: string }
  ) => {
    const selected = scopeKey(scope) === currentKey;
    // 沒有讀取權限時所有選項都只是預覽，不能真的選取。
    const disabled = (options?.disabled ?? false) || !granted;
    return (
      <Pressable
        key={title}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected }}
        disabled={disabled}
        onPress={options?.onPress ?? (() => chooseScope(scope))}
        style={({ pressed }) => [
          styles.option,
          selected && styles.optionSelected,
          pressed && !disabled && styles.pressed,
          disabled && styles.optionDisabled,
        ]}>
        <View style={styles.optionText}>
          <Text
            style={[
              styles.optionTitle,
              { fontSize: scaleFont(16, width) },
              disabled && styles.mutedText,
            ]}>
            {title}
          </Text>
          <Caption>{detail}</Caption>
        </View>
        {options?.trailing ? (
          <Text style={[styles.trailing, { fontSize: scaleFont(12, width) }]}>
            {options.trailing}
          </Text>
        ) : null}
        {selected ? <CheckIcon size={18} color={colors.keep} /> : null}
      </Pressable>
    );
  };

  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.header}>
        <Title>選擇整理範圍</Title>
        <Body muted>先挑一個範圍，就不用每次都從整個相簿開始。</Body>
        <Caption>{`目前範圍：${scopeLabel(scopeController.scope)}`}</Caption>
      </View>

      {/* 相簿失效等情況帶回來的一次性提示，選定任一範圍後即清除。 */}
      {scopeController.notice ? (
        <Notice tone="warning" title="需要重新選擇範圍">
          {scopeController.notice}
        </Notice>
      ) : null}

      {!granted ? (
        <View style={styles.gate}>
          <Notice tone="warning" title="需要相簿權限才能選擇整理範圍">
            還沒取得相簿讀取權限，所以現在不會去讀取任何照片或相簿。請先完成授權再回來選範圍。
          </Notice>
          <AppButton label="前往權限頁" onPress={() => router.push('/permission')} />
        </View>
      ) : (
        <>
          {accessLevel === 'limited' ? (
            <Notice tone="warning" title="有限存取">
              目前只會顯示 iPhone 已允許存取的照片內容，相簿清單與各範圍的張數都可能不完整。
            </Notice>
          ) : null}

          {/* 有上次使用的範圍就直接續用，不必再翻開月份或相簿重選一次。 */}
          {scopeController.restored ? (
            <View style={styles.resume}>
              <AppButton
                label={`繼續整理：${scopeLabel(scopeController.scope)}`}
                onPress={() => activateAndOpen(scopeController.scope)}
              />
              <Caption>
                {session.ready && session.processedCount > 0
                  ? `這個範圍已處理 ${session.processedCount} 張，會從上次的位置接著整理。`
                  : '會沿用上次選的範圍，進度與統計都會接續。'}
              </Caption>
            </View>
          ) : null}
        </>
      )}

      <View style={styles.list}>
        {renderOption({ type: 'all' }, '所有照片', '從最新往舊整理整個相簿。')}

        {SCREENSHOT_SUPPORTED
          ? renderOption({ type: 'screenshots' }, '截圖', '只整理系統標記為截圖的照片。')
          : renderOption({ type: 'screenshots' }, '截圖', '這台裝置無法可靠辨識截圖，暫時無法使用。', {
              disabled: true,
              trailing: '無法使用',
            })}

        {renderOption(
          { type: 'recent30Days' },
          `最近 ${RECENT_DAYS} 天`,
          `只整理最近 ${RECENT_DAYS} 天拍的照片。`
        )}

        {renderOption({ type: 'month', month: '' }, '依月份選擇', `列出最近 ${MONTH_OPTION_COUNT} 個月。`, {
          onPress: () => setPanel(panel === 'month' ? 'none' : 'month'),
          trailing: panel === 'month' ? '收起' : '展開',
        })}

        {panel === 'month' ? (
          <View style={styles.chipWrap}>
            {listRecentMonths().map((option) => {
              const selected = currentKey === `month:${option.month}`;
              return (
                <Pressable
                  key={option.month}
                  accessibilityRole="button"
                  disabled={!granted}
                  onPress={() => chooseScope({ type: 'month', month: option.month })}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chipSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text
                    style={[
                      styles.chipText,
                      { fontSize: scaleFont(13, width) },
                      selected && styles.chipTextSelected,
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {renderOption({ type: 'album', albumId: '', albumTitle: '' }, '指定相簿', '從你自己建立的相簿挑一個。', {
          onPress: () => setPanel(panel === 'album' ? 'none' : 'album'),
          trailing: panel === 'album' ? '收起' : '展開',
        })}

        {panel === 'album' ? (
          <View style={styles.panel}>
            {!granted ? (
              <>
                <Caption>需要相簿權限才能列出相簿。</Caption>
                <AppButton
                  label="前往授權"
                  variant="secondary"
                  onPress={() => router.push('/permission')}
                />
              </>
            ) : albumsLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" />
                <Caption>正在讀取相簿清單…</Caption>
              </View>
            ) : albumsError ? (
              <>
                <Notice tone="danger" title="讀取相簿清單失敗">
                  {albumsError}
                </Notice>
                <AppButton label="重試" variant="secondary" onPress={loadAlbums} />
              </>
            ) : albums.length === 0 ? (
              <Caption>找不到含有照片的相簿。有限存取模式下只會列出已授權的相簿。</Caption>
            ) : (
              albums.map((album) => {
                const selected = currentKey === `album:${album.id}`;
                return (
                  <Pressable
                    key={album.id}
                    accessibilityRole="button"
                    onPress={() =>
                      chooseScope({ type: 'album', albumId: album.id, albumTitle: album.title })
                    }
                    style={({ pressed }) => [
                      styles.albumRow,
                      selected && styles.optionSelected,
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      style={[styles.albumTitle, { fontSize: scaleFont(15, width) }]}
                      numberOfLines={1}>
                      {album.title}
                    </Text>
                    <Caption>{`${album.photoCount} 張`}</Caption>
                    {selected ? <CheckIcon size={16} color={colors.keep} /> : null}
                  </Pressable>
                );
              })
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Caption>每個範圍的整理進度各自獨立保存，切換不會弄丟原本的紀錄。</Caption>
        <AppButton label="返回" variant="secondary" onPress={() => router.back()} />
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
    paddingTop: spacing.sm,
  },
  gate: {
    gap: spacing.sm,
  },
  resume: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    gap: spacing.sm,
    padding: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
  option: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  optionSelected: {
    borderColor: colors.keep,
    borderWidth: StyleSheet.hairlineWidth * 3,
  },
  optionDisabled: {
    backgroundColor: colors.background,
  },
  pressed: {
    opacity: 0.72,
  },
  optionText: {
    flex: 1,
    gap: spacing.xs,
  },
  optionTitle: {
    color: colors.text,
    fontWeight: '700',
  },
  mutedText: {
    color: colors.textMuted,
  },
  trailing: {
    color: colors.accent,
    fontWeight: '600',
  },
  panel: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    gap: spacing.sm,
    padding: spacing.md,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chipWrap: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.md,
  },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chipSelected: {
    borderColor: colors.keep,
    borderWidth: StyleSheet.hairlineWidth * 3,
  },
  chipText: {
    color: colors.text,
  },
  chipTextSelected: {
    color: colors.keep,
    fontWeight: '700',
  },
  albumRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  albumTitle: {
    color: colors.text,
    flex: 1,
    fontWeight: '600',
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
