/**
 * 像素圖示系統。
 *
 * 每個圖示是一張手寫的點陣圖（ASCII art），渲染時展開成純 View 方塊：
 *   '.' 透明 ／ '#' 深色外框 ／ 'o' 粉彩填色 ／ 'w' 內部留白(surface)
 *
 * 沒有圖片、SVG、icon 套件、Emoji 或 Unicode 字元；
 * 沒有漸層、glow、blur、柔和陰影，也沒有任何互動或動畫邏輯。
 *
 * 尺寸策略：格子邊長一律是 2px 的整數倍，並且 grid × cell 剛好等於 size，
 * 所以 16／24／32 都精準落在 2px 格點上（詳見 resolveRender）。
 *
 * 無障礙：圖示是純裝飾，一律對輔助工具隱藏，語意由外層按鈕的
 * accessibilityLabel 負責，避免 VoiceOver 重複朗讀。
 */
import { StyleSheet, View } from 'react-native';

import { colors, pixel } from '@/lib/theme';

const GRID_SMALL = 8;
const GRID_LARGE = 12;

type Bitmap = readonly string[];

type IconProps = {
  size?: number;
  /** 外框色，預設 outline；呼叫端傳 color 時視為外框色以保持舊 API 相容。 */
  color?: string;
  /** 粉彩填色；預設沿用外框色的語意夥伴，見各圖示的 defaultFill。 */
  fill?: string;
};

/* --------------------------- 點陣圖 --------------------------- */
/* 每張圖的 small 為 8×8（16px 用的簡化版），large 為 12×12（24px 用的細節版）。 */

const TRASH_SMALL: Bitmap = [
  '..####..',
  '########',
  '.#oooo#.',
  '.#o##o#.',
  '.#o##o#.',
  '.#o##o#.',
  '.#oooo#.',
  '..####..',
];

const TRASH_LARGE: Bitmap = [
  '....####....',
  '############',
  '.#oooooooo#.',
  '.#o##oo##o#.',
  '.#o##oo##o#.',
  '.#o##oo##o#.',
  '.#o##oo##o#.',
  '.#o##oo##o#.',
  '.#o##oo##o#.',
  '.#oooooooo#.',
  '.##########.',
  '............',
];

const CHECK_SMALL: Bitmap = [
  '........',
  '........',
  '.......#',
  '#.....##',
  '##o..##o',
  '.##o##o.',
  '..###o..',
  '........',
];

const CHECK_LARGE: Bitmap = [
  '............',
  '............',
  '............',
  '..........##',
  '.........##.',
  '#.......##o.',
  '##o....##o..',
  '.##o..##o...',
  '..##o##o....',
  '...###o.....',
  '............',
  '............',
];

const UNDO_SMALL: Bitmap = [
  '........',
  '..#.....',
  '.##.....',
  '#o#####.',
  '.##...#.',
  '..#...#.',
  '......#.',
  '........',
];

const UNDO_LARGE: Bitmap = [
  '............',
  '............',
  '...#........',
  '..##........',
  '.###........',
  '##o########.',
  '.###......#.',
  '..##......#.',
  '...#......#.',
  '..........#.',
  '............',
  '............',
];

const PHOTO_SMALL: Bitmap = [
  '........',
  '########',
  '#oo#ooo#',
  '#oooooo#',
  '#ooo#oo#',
  '#oo###o#',
  '########',
  '........',
];

const PHOTO_LARGE: Bitmap = [
  '............',
  '############',
  '#oooo#ooooo#',
  '#ooo###oooo#',
  '#oooo#ooooo#',
  '#oooooooooo#',
  '#ooooo#oooo#',
  '#oooo###ooo#',
  '#ooo#####oo#',
  '#oo#######o#',
  '############',
  '............',
];

const ALBUM_SMALL: Bitmap = [
  '........',
  '..######',
  '..#oooo#',
  '######o#',
  '#oooo#o#',
  '#oooo###',
  '########',
  '........',
];

const ALBUM_LARGE: Bitmap = [
  '............',
  '...#########',
  '...#ooooooo#',
  '...#ooooooo#',
  '##########o#',
  '#ooooooo##o#',
  '#ooooooo#o##',
  '#ooooooo#o#.',
  '#ooooooo###.',
  '#ooooooo##..',
  '##########..',
  '............',
];

const CALENDAR_SMALL: Bitmap = [
  '.#....#.',
  '########',
  '#oooooo#',
  '#o#o#oo#',
  '#oooooo#',
  '#o#o#oo#',
  '########',
  '........',
];

const CALENDAR_LARGE: Bitmap = [
  '..#.....#...',
  '..#.....#...',
  '############',
  '#oooooooooo#',
  '############',
  '#o##o##o##o#',
  '#oooooooooo#',
  '#o##o##o##o#',
  '#oooooooooo#',
  '#o##o##oooo#',
  '############',
  '............',
];

const SCREENSHOT_SMALL: Bitmap = [
  '###..###',
  '#......#',
  '........',
  '..oooo..',
  '..oooo..',
  '........',
  '#......#',
  '###..###',
];

const SCREENSHOT_LARGE: Bitmap = [
  '####....####',
  '#..........#',
  '#..........#',
  '............',
  '...oooooo...',
  '...oooooo...',
  '...oooooo...',
  '...oooooo...',
  '............',
  '#..........#',
  '#..........#',
  '####....####',
];

const SHIELD_SMALL: Bitmap = [
  '.######.',
  '#oooooo#',
  '#oooooo#',
  '#oooooo#',
  '.#oooo#.',
  '..#oo#..',
  '...##...',
  '........',
];

const SHIELD_LARGE: Bitmap = [
  '..########..',
  '.#oooooooo#.',
  '#oooooooooo#',
  '#oooo##oooo#',
  '#ooo####ooo#',
  '#oo##oo##oo#',
  '#oooooooooo#',
  '.#oooooooo#.',
  '..#oooooo#..',
  '...#oooo#...',
  '....####....',
  '............',
];

const WARN_SMALL: Bitmap = [
  '...##...',
  '..#oo#..',
  '..#oo#..',
  '.#o##o#.',
  '.#o##o#.',
  '#oooooo#',
  '#oo##oo#',
  '########',
];

const WARN_LARGE: Bitmap = [
  '.....##.....',
  '....#oo#....',
  '....#oo#....',
  '...#o##o#...',
  '...#o##o#...',
  '..#oo##oo#..',
  '..#oo##oo#..',
  '.#oooooooo#.',
  '.#oo####oo#.',
  '#oooo##oooo#',
  '#oooooooooo#',
  '############',
];

/** 基準方向為「向右」，其餘三個方向用 rotate 轉出來。 */
const ARROW_SMALL: Bitmap = [
  '........',
  '.....#..',
  '.....##.',
  'oo######',
  'oo######',
  '.....##.',
  '.....#..',
  '........',
];

const ARROW_LARGE: Bitmap = [
  '............',
  '............',
  '.......#....',
  '.......##...',
  '.......###..',
  'ooo#########',
  'ooo#########',
  '.......###..',
  '.......##...',
  '.......#....',
  '............',
  '............',
];

/* ------------------------- 渲染核心 ------------------------- */

/**
 * 選出點陣圖與格子邊長，讓 grid × cell 剛好等於 size，且 cell 是 2 的整數倍。
 *
 * - 16 => small(8) × 2
 * - 24 => large(12) × 2
 * - 32 => small(8) × 4（刻意用簡化版：大尺寸的粗格子才是像素風該有的樣子）
 * - 其他尺寸 => 退回 small，cell 取不超過的最大 2 倍數並置中
 */
function resolveRender(size: number, small: Bitmap, large: Bitmap | undefined) {
  const unit = pixel.unit;

  if (large && size % GRID_LARGE === 0 && (size / GRID_LARGE) % unit === 0) {
    return { rows: large, cell: size / GRID_LARGE };
  }
  if (size % GRID_SMALL === 0 && (size / GRID_SMALL) % unit === 0) {
    return { rows: small, cell: size / GRID_SMALL };
  }
  const cell = Math.max(unit, Math.floor(size / GRID_SMALL / unit) * unit);
  return { rows: small, cell };
}

type RunColor = string | null;

/** 把一列壓縮成連續同色的區段，避免每格都產生一個 View。 */
function encodeRow(row: string, palette: Record<string, RunColor>) {
  const runs: { color: RunColor; length: number }[] = [];
  for (const char of row) {
    const color = palette[char] ?? null;
    const last = runs[runs.length - 1];
    if (last && last.color === color) {
      last.length += 1;
    } else {
      runs.push({ color, length: 1 });
    }
  }
  // 尾端透明區段不必渲染。
  while (runs.length > 0 && runs[runs.length - 1].color === null) {
    runs.pop();
  }
  return runs;
}

function PixelIcon({
  small,
  large,
  size,
  outline,
  fill,
  rotate,
}: {
  small: Bitmap;
  large?: Bitmap;
  size: number;
  outline: string;
  fill: string;
  rotate?: string;
}) {
  const { rows, cell } = resolveRender(size, small, large);
  const palette: Record<string, RunColor> = {
    '.': null,
    '#': outline,
    o: fill,
    w: colors.surface,
  };

  return (
    <View
      // 純裝飾：語意由外層按鈕的 accessibilityLabel 負責。
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.box,
        { width: size, height: size },
        rotate ? { transform: [{ rotate }] } : null,
      ]}>
      <View>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={[styles.row, { height: cell }]}>
            {encodeRow(row, palette).map((run, runIndex) => (
              <View
                key={runIndex}
                style={{
                  width: run.length * cell,
                  height: cell,
                  backgroundColor: run.color ?? 'transparent',
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------- 對外圖示 ------------------------- */

/**
 * 舊 API 相容：既有呼叫端是 `color={colors.discard}` 這種寫法。
 * 為了讓深色外框仍然存在，color 一律當成「填色」解讀，
 * 外框固定用 colors.outline，這樣小尺寸也不會變成一團低對比粉彩。
 */
function resolve(props: IconProps, defaultFill: string) {
  return {
    size: props.size ?? 22,
    outline: colors.outline,
    fill: props.fill ?? props.color ?? defaultFill,
  };
}

export function TrashIcon(props: IconProps) {
  const { size, outline, fill } = resolve(props, colors.discard);
  return (
    <PixelIcon small={TRASH_SMALL} large={TRASH_LARGE} size={size} outline={outline} fill={fill} />
  );
}

export function CheckIcon(props: IconProps) {
  const { size, outline, fill } = resolve(props, colors.keep);
  return (
    <PixelIcon small={CHECK_SMALL} large={CHECK_LARGE} size={size} outline={outline} fill={fill} />
  );
}

export function UndoIcon(props: IconProps) {
  const { size, outline, fill } = resolve(props, colors.primary);
  return (
    <PixelIcon small={UNDO_SMALL} large={UNDO_LARGE} size={size} outline={outline} fill={fill} />
  );
}

export function PhotoIcon(props: IconProps) {
  const { size, outline, fill } = resolve(props, colors.primary);
  return (
    <PixelIcon small={PHOTO_SMALL} large={PHOTO_LARGE} size={size} outline={outline} fill={fill} />
  );
}

export function AlbumIcon(props: IconProps) {
  const { size, outline, fill } = resolve(props, colors.primary);
  return (
    <PixelIcon small={ALBUM_SMALL} large={ALBUM_LARGE} size={size} outline={outline} fill={fill} />
  );
}

export function CalendarIcon(props: IconProps) {
  const { size, outline, fill } = resolve(props, colors.primary);
  return (
    <PixelIcon
      small={CALENDAR_SMALL}
      large={CALENDAR_LARGE}
      size={size}
      outline={outline}
      fill={fill}
    />
  );
}

export function ScreenshotIcon(props: IconProps) {
  const { size, outline, fill } = resolve(props, colors.primary);
  return (
    <PixelIcon
      small={SCREENSHOT_SMALL}
      large={SCREENSHOT_LARGE}
      size={size}
      outline={outline}
      fill={fill}
    />
  );
}

export function ShieldIcon(props: IconProps) {
  const { size, outline, fill } = resolve(props, colors.keep);
  return (
    <PixelIcon small={SHIELD_SMALL} large={SHIELD_LARGE} size={size} outline={outline} fill={fill} />
  );
}

export function WarnIcon(props: IconProps) {
  const { size, outline, fill } = resolve(props, colors.warning);
  return (
    <PixelIcon small={WARN_SMALL} large={WARN_LARGE} size={size} outline={outline} fill={fill} />
  );
}

export type ArrowDirection = 'left' | 'right' | 'up' | 'down';

/** 只有一張向右的點陣圖，其餘方向用 rotate，不重複四份幾何。 */
const ARROW_ROTATION: Record<ArrowDirection, string> = {
  right: '0deg',
  down: '90deg',
  left: '180deg',
  up: '270deg',
};

export function ArrowIcon({
  direction = 'right',
  ...props
}: IconProps & { direction?: ArrowDirection }) {
  const { size, outline, fill } = resolve(props, colors.primary);
  return (
    <PixelIcon
      small={ARROW_SMALL}
      large={ARROW_LARGE}
      size={size}
      outline={outline}
      fill={fill}
      rotate={ARROW_ROTATION[direction]}
    />
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
  },
});
