/**
 * Section 02 的手機畫面：模擬整理範圍選擇。
 *
 * 五種範圍完全對應 src/lib/scope.ts 的 CleanupScope（all／screenshots／
 * recent30Days／month／album），刻意不多加任何程式沒實作的範圍。
 * 這裡不 import scope.ts，也不呼叫 MediaLibrary —— 張數來自 demo fixture。
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlbumIcon, CalendarIcon, PhotoIcon, ScreenshotIcon } from '@/components/icons';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import type { DemoScope } from '@/lib/demo-fixtures';
import { border, colors, iconSize, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

type Props = {
  screenWidth: number;
  scopes: readonly DemoScope[];
  selectedKey: string;
  onSelect: (key: string) => void;
};

function ScopeIcon({ icon }: { icon: DemoScope['icon'] }) {
  const fill = colors.primaryText;
  switch (icon) {
    case 'photo':
      return <PhotoIcon size={iconSize.md} fill={fill} />;
    case 'screenshot':
      return <ScreenshotIcon size={iconSize.md} fill={fill} />;
    case 'calendar':
      return <CalendarIcon size={iconSize.md} fill={fill} />;
    case 'album':
      return <AlbumIcon size={iconSize.md} fill={fill} />;
  }
}

export function ScopeDemoScreen({ screenWidth, scopes, selectedKey, onSelect }: Props) {
  const pad = Math.round(screenWidth * 0.055);
  const selected = scopes.find((s) => s.key === selectedKey) ?? scopes[0];

  return (
    <View style={[styles.root, { padding: pad, gap: spacing.ms }]}>
      <Text
        style={[typeStyle(typeAccent.screenHeading, screenWidth), styles.heading]}
        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
        要整理哪些照片？
      </Text>

      <View style={{ gap: spacing.sm }}>
        {scopes.map((scope) => {
          const active = scope.key === selectedKey;
          return (
            <Pressable
              key={scope.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${scope.label}，${scope.photoCount} 張`}
              onPress={() => onSelect(scope.key)}>
              <PixelSurface
                background={active ? colors.surfaceAlt : colors.surface}
                outlineColor={active ? colors.primaryText : colors.outline}
                outlineWidth={active ? border.widthThick : border.width}
                shadowOffset={active ? 4 : 0}
                style={styles.row}>
                <ScopeIcon icon={scope.icon} />
                <View style={styles.rowText}>
                  <Text
                    style={[typeStyle(typeAccent.button, screenWidth), styles.rowTitle]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                    {scope.label}
                  </Text>
                  <Text
                    style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                    {scope.hint}
                  </Text>
                </View>
                <Text
                  style={[typeStyle(typeAccent.badgeValue, screenWidth), active ? styles.countActive : styles.muted]}
                  maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                  {scope.photoCount}
                </Text>
              </PixelSurface>
            </Pressable>
          );
        })}
      </View>

      {/* 下半部隨選取變化，示意「換範圍就換一批照片」。 */}
      <PixelSurface background={colors.surfaceAlt} shadowOffset={0} style={styles.footer}>
        <Text
          style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          這個範圍預計整理
        </Text>
        <Text
          style={[typeStyle(typeAccent.sectionTitle, screenWidth), styles.countActive]}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          {`${selected.photoCount} 張照片`}
        </Text>
      </PixelSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  heading: {
    color: colors.textPrimary,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.ms,
    padding: spacing.ms,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: colors.textPrimary,
  },
  muted: {
    color: colors.textSecondary,
  },
  countActive: {
    color: colors.primaryText,
  },
  footer: {
    alignItems: 'center',
    gap: 2,
    marginTop: 'auto',
    padding: spacing.ms,
  },
});
