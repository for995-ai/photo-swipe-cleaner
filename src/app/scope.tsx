import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  AlbumIcon,
  CalendarIcon,
  CheckIcon,
  PhotoIcon,
  ScreenshotIcon,
  WarnIcon,
} from '@/components/icons';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelButton } from '@/components/pixel/pixel-button';
import { PixelNotice } from '@/components/pixel/pixel-notice';
import { PixelSpinner } from '@/components/pixel/pixel-spinner';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { AppButton, Body, Caption, Screen, Title } from '@/components/ui';
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
import { border, colors, iconSize, radius, shadow, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

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
    icon: ReactNode,
    options?: {
      disabled?: boolean;
      onPress?: () => void;
      trailing?: string;
      unavailable?: boolean;
      accessibilityLabel?: string;
    }
  ) => {
    const selected = scopeKey(scope) === currentKey;
    // 沒有讀取權限時所有選項都只是預覽，不能真的選取。
    const disabled = (options?.disabled ?? false) || !granted;

    return (
      <Pressable
        key={title}
        accessibilityRole="button"
        accessibilityLabel={
          options?.accessibilityLabel ??
          `${title}${selected ? '，目前選取中' : ''}${disabled ? '，無法使用' : ''}。${detail}`
        }
        accessibilityState={{ disabled, selected }}
        disabled={disabled}
        onPress={options?.onPress ?? (() => chooseScope(scope))}>
        {({ pressed }) => (
          <PixelSurface
            background={selected ? colors.surfaceAlt : colors.surface}
            outlineColor={disabled ? colors.disabledText : colors.outline}
            outlineWidth={selected ? border.widthThick : border.width}
            // 停用態不畫陰影；按下時陰影縮短並讓內容下移。
            shadowOffset={disabled ? 0 : pressed ? shadow.pressOffset : shadow.offset}
            style={[
              styles.option,
              pressed && !disabled ? { transform: [{ translateY: shadow.pressOffset }] } : null,
            ]}>
            <View style={disabled ? styles.iconDisabled : undefined}>{icon}</View>

            <View style={styles.optionText}>
              <Text
                style={[
                  typeStyle(typeAccent.button, width),
                  styles.optionTitle,
                  disabled && styles.mutedText,
                ]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                {title}
              </Text>
              <Caption>{detail}</Caption>
            </View>

            {options?.unavailable ? <PixelBadge label="無法使用" tone="neutral" /> : null}

            {options?.trailing ? (
              <Text
                style={[typeStyle(typeAccent.badgeLabel, width), styles.trailing]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                {options.trailing}
              </Text>
            ) : null}

            {selected ? <CheckIcon size={iconSize.sm} fill={colors.keep} /> : null}
          </PixelSurface>
        )}
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
        <PixelNotice
          tone="warning"
          title="需要重新選擇範圍"
          icon={<WarnIcon size={iconSize.sm} fill={colors.warning} />}>
          {scopeController.notice}
        </PixelNotice>
      ) : null}

      {!granted ? (
        <View style={styles.gate}>
          <PixelNotice
            tone="warning"
            title="需要相簿權限才能選擇整理範圍"
            icon={<WarnIcon size={iconSize.sm} fill={colors.warning} />}>
            還沒取得相簿讀取權限，所以現在不會去讀取任何照片或相簿。請先完成授權再回來選範圍。
          </PixelNotice>
          <AppButton label="前往權限頁" onPress={() => router.push('/permission')} />
        </View>
      ) : (
        <>
          {accessLevel === 'limited' ? (
            <PixelNotice
              tone="warning"
              title="有限存取"
              icon={<WarnIcon size={iconSize.sm} fill={colors.warning} />}>
              目前只會顯示 iPhone 已允許存取的照片內容，相簿清單與各範圍的張數都可能不完整。
            </PixelNotice>
          ) : null}

          {/* 有上次使用的範圍就直接續用，不必再翻開月份或相簿重選一次。 */}
          {scopeController.restored ? (
            <PixelSurface background={colors.surfaceAlt} style={styles.resume}>
              <PixelButton
                label={`繼續整理：${scopeLabel(scopeController.scope)}`}
                accessibilityLabel={`繼續整理 ${scopeLabel(scopeController.scope)}`}
                onPress={() => activateAndOpen(scopeController.scope)}
              />
              <Caption>
                {session.ready && session.processedCount > 0
                  ? `這個範圍已處理 ${session.processedCount} 張，會從上次的位置接著整理。`
                  : '會沿用上次選的範圍，進度與統計都會接續。'}
              </Caption>
            </PixelSurface>
          ) : null}
        </>
      )}

      <View style={styles.list}>
        {renderOption(
          { type: 'all' },
          '所有照片',
          '從最新往舊整理整個相簿。',
          <PhotoIcon size={iconSize.lg} fill={colors.primary} />
        )}

        {SCREENSHOT_SUPPORTED
          ? renderOption(
              { type: 'screenshots' },
              '截圖',
              '只整理系統標記為截圖的照片。',
              <ScreenshotIcon size={iconSize.lg} fill={colors.primary} />
            )
          : renderOption(
              { type: 'screenshots' },
              '截圖',
              '這台裝置無法可靠辨識截圖，暫時無法使用。',
              <ScreenshotIcon size={iconSize.lg} fill={colors.disabledText} />,
              { disabled: true, unavailable: true }
            )}

        {renderOption(
          { type: 'recent30Days' },
          `最近 ${RECENT_DAYS} 天`,
          `只整理最近 ${RECENT_DAYS} 天拍的照片。`,
          <CalendarIcon size={iconSize.lg} fill={colors.primary} />
        )}

        {renderOption(
          { type: 'month', month: '' },
          '依月份選擇',
          `列出最近 ${MONTH_OPTION_COUNT} 個月。`,
          <CalendarIcon size={iconSize.lg} fill={colors.warning} />,
          {
            onPress: () => setPanel(panel === 'month' ? 'none' : 'month'),
            trailing: panel === 'month' ? '收起' : '展開',
            accessibilityLabel: `依月份選擇，${panel === 'month' ? '收起' : '展開'}月份清單`,
          }
        )}

        {panel === 'month' ? (
          <PixelSurface background={colors.surfaceAlt} style={styles.chipWrap} shadowOffset={0}>
            {listRecentMonths().map((option) => {
              const selected = currentKey === `month:${option.month}`;
              return (
                <Pressable
                  key={option.month}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.label}${selected ? '，目前選取中' : ''}`}
                  accessibilityState={{ disabled: !granted, selected }}
                  disabled={!granted}
                  onPress={() => chooseScope({ type: 'month', month: option.month })}>
                  {({ pressed }) => (
                    <PixelSurface
                      background={selected ? colors.primary : colors.surface}
                      outlineWidth={selected ? border.widthThick : border.width}
                      cornerRadius={radius.sm}
                      shadowOffset={pressed ? 0 : shadow.pressOffset}
                      style={styles.chip}>
                      <Text
                        style={[
                          typeStyle(typeAccent.badgeLabel, width),
                          selected ? styles.chipTextSelected : styles.chipText,
                        ]}
                        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                        {option.label}
                      </Text>
                    </PixelSurface>
                  )}
                </Pressable>
              );
            })}
          </PixelSurface>
        ) : null}

        {renderOption(
          { type: 'album', albumId: '', albumTitle: '' },
          '指定相簿',
          '從你自己建立的相簿挑一個。',
          <AlbumIcon size={iconSize.lg} fill={colors.keep} />,
          {
            onPress: () => setPanel(panel === 'album' ? 'none' : 'album'),
            trailing: panel === 'album' ? '收起' : '展開',
            accessibilityLabel: `指定相簿，${panel === 'album' ? '收起' : '展開'}相簿清單`,
          }
        )}

        {panel === 'album' ? (
          <PixelSurface background={colors.surfaceAlt} style={styles.panel} shadowOffset={0}>
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
                <PixelSpinner size={iconSize.sm} />
                <Caption>正在讀取相簿清單…</Caption>
              </View>
            ) : albumsError ? (
              <>
                <PixelNotice
                  tone="danger"
                  title="讀取相簿清單失敗"
                  icon={<WarnIcon size={iconSize.sm} fill={colors.discard} />}>
                  {albumsError}
                </PixelNotice>
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
                    accessibilityLabel={`相簿 ${album.title}，${album.photoCount} 張照片${selected ? '，目前選取中' : ''}`}
                    accessibilityState={{ selected }}
                    onPress={() =>
                      chooseScope({ type: 'album', albumId: album.id, albumTitle: album.title })
                    }>
                    {({ pressed }) => (
                      <PixelSurface
                        // 選取態與上方選項卡一致：底色換 surfaceAlt、描邊加粗、右側加勾。
                        background={selected ? colors.surfaceAlt : colors.surface}
                        outlineWidth={selected ? border.widthThick : border.width}
                        cornerRadius={radius.sm}
                        shadowOffset={pressed ? shadow.pressOffset : shadow.offset}
                        style={[
                          styles.albumRow,
                          pressed ? { transform: [{ translateY: shadow.pressOffset }] } : null,
                        ]}>
                        <AlbumIcon size={iconSize.sm} fill={colors.keep} />
                        <Text
                          style={[typeStyle(typeAccent.badgeValue, width), styles.albumTitle]}
                          numberOfLines={1}
                          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                          {album.title}
                        </Text>
                        <PixelBadge label={`${album.photoCount} 張`} tone="info" />
                        {selected ? <CheckIcon size={iconSize.sm} fill={colors.keep} /> : null}
                      </PixelSurface>
                    )}
                  </Pressable>
                );
              })
            )}
          </PixelSurface>
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
    gap: spacing.sm,
    padding: spacing.ms,
  },
  list: {
    gap: spacing.ms,
  },
  option: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.ms,
    padding: spacing.ms,
  },
  iconDisabled: {
    opacity: 0.45,
  },
  optionText: {
    flex: 1,
    gap: spacing.xs,
  },
  optionTitle: {
    color: colors.textPrimary,
  },
  mutedText: {
    color: colors.textSecondary,
  },
  trailing: {
    color: colors.primaryText,
  },
  panel: {
    gap: spacing.sm,
    padding: spacing.ms,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.ms,
  },
  /** 月份 chip 原本只有約 36pt 高，補到 44pt 才符合最小觸控目標。 */
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.ms,
    paddingVertical: spacing.sm,
  },
  chipText: {
    color: colors.textPrimary,
  },
  chipTextSelected: {
    color: colors.onColor,
  },
  /** 相簿列同樣保證 44pt 觸控高度（原本約 40pt）。 */
  albumRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.ms,
    paddingVertical: spacing.sm,
  },
  albumTitle: {
    color: colors.textPrimary,
    flex: 1,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
