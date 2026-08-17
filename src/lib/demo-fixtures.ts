/**
 * Portfolio Demo 的**唯一**資料來源。
 *
 * 這個檔案刻意與正式 App 完全脫鉤：
 * - 不 import 任何刪除／Session／Journal／MediaLibrary 模組
 * - 不讀寫 AsyncStorage
 * - 沒有任何非同步行為
 *
 * 所有數字與清單都是寫死的展示素材，Demo 頁只會把它們放進 React local state。
 * 重新載入 /demo 就回到這裡定義的初始值。
 *
 * 照片素材：目前 repo 沒有可公開展示的相片，因此一律使用抽象的像素色塊
 * （見 components/demo/demo-photo-art.tsx），不涉及任何私人照片或版權素材。
 * 之後要換成正式作品集圖片時，只需要改這裡的 DEMO_PHOTOS。
 */

/** 抽象照片圖樣。每個值對應 DemoPhotoArt 裡的一種畫法。 */
export type DemoPhotoPattern =
  | 'sunset'
  | 'sky'
  | 'coffee'
  | 'city'
  | 'mountains'
  | 'desk'
  | 'beach'
  | 'flowers'
  | 'night'
  | 'screenshot'
  | 'portrait'
  | 'food';

export type DemoPhoto = {
  id: string;
  title: string;
  /** 顯示在卡片角落的分類標籤。 */
  category: string;
  /** 用來顯示日期字串；固定值，不用 Date.now() 以保持 deterministic。 */
  createdAt: string;
  /** 由深到淺的三個色階，交給 DemoPhotoArt 疊層。 */
  palette: readonly [string, string, string];
  pattern: DemoPhotoPattern;
};

/**
 * 12 張示範照片。
 *
 * 色票刻意偏柔和、與 theme.ts 的奶油白底相處得好，
 * 但不直接沿用品牌色，才能讓「照片」和 UI 分得開。
 */
export const DEMO_PHOTOS: readonly DemoPhoto[] = [
  {
    id: 'demo-01',
    title: '海邊日落',
    category: '風景',
    createdAt: '2026 年 7 月 12 日',
    palette: ['#F4A26B', '#F9C99A', '#FDE7CE'],
    pattern: 'sunset',
  },
  {
    id: 'demo-02',
    title: '午後的天空',
    category: '風景',
    createdAt: '2026 年 7 月 10 日',
    palette: ['#8FB8E8', '#B9D5F2', '#E4EFFB'],
    pattern: 'sky',
  },
  {
    id: 'demo-03',
    title: '早上那杯咖啡',
    category: '生活',
    createdAt: '2026 年 7 月 9 日',
    palette: ['#8A6247', '#C09675', '#EBD9C6'],
    pattern: 'coffee',
  },
  {
    id: 'demo-04',
    title: '城市街角',
    category: '城市',
    createdAt: '2026 年 7 月 6 日',
    palette: ['#6E7796', '#A2AAC4', '#DCE0EC'],
    pattern: 'city',
  },
  {
    id: 'demo-05',
    title: '山的稜線',
    category: '風景',
    createdAt: '2026 年 6 月 28 日',
    palette: ['#5F8A73', '#94BCA4', '#DCEBE1'],
    pattern: 'mountains',
  },
  {
    id: 'demo-06',
    title: '工作桌一角',
    category: '生活',
    createdAt: '2026 年 6 月 24 日',
    palette: ['#7B6E8F', '#AEA2BF', '#E6E0EE'],
    pattern: 'desk',
  },
  {
    id: 'demo-07',
    title: '沙灘腳印',
    category: '旅行',
    createdAt: '2026 年 6 月 20 日',
    palette: ['#D9B98C', '#EBD6B4', '#F7ECDA'],
    pattern: 'beach',
  },
  {
    id: 'demo-08',
    title: '窗邊的花',
    category: '生活',
    createdAt: '2026 年 6 月 15 日',
    palette: ['#C4708F', '#E3A3BB', '#F7DCE6'],
    pattern: 'flowers',
  },
  {
    id: 'demo-09',
    title: '夜晚的路燈',
    category: '城市',
    createdAt: '2026 年 6 月 11 日',
    palette: ['#3D3A52', '#6C6789', '#B4AECB'],
    pattern: 'night',
  },
  {
    id: 'demo-10',
    title: '順手截的圖',
    category: '截圖',
    createdAt: '2026 年 6 月 8 日',
    palette: ['#9AA0AE', '#C7CBD5', '#EFF1F5'],
    pattern: 'screenshot',
  },
  {
    id: 'demo-11',
    title: '逆光自拍',
    category: '人像',
    createdAt: '2026 年 6 月 3 日',
    palette: ['#B0846A', '#D6AE96', '#F2DFD2'],
    pattern: 'portrait',
  },
  {
    id: 'demo-12',
    title: '週末的早餐',
    category: '生活',
    createdAt: '2026 年 5 月 30 日',
    palette: ['#C98A5B', '#E5B489', '#F8E4CE'],
    pattern: 'food',
  },
] as const;

/**
 * 整理範圍。
 *
 * 五種都對應 src/lib/scope.ts 的 CleanupScope，刻意不多寫任何
 * 程式沒實作的範圍（例如人物／地點／最愛／影片）。
 * 這裡只存展示用的字串與張數，不 import scope.ts，避免與正式型別耦合。
 */
export type DemoScope = {
  key: string;
  label: string;
  /** 卡片副標。 */
  hint: string;
  /** 這個範圍在 Demo 裡「有幾張照片」。 */
  photoCount: number;
  icon: 'photo' | 'screenshot' | 'calendar' | 'album';
};

export const DEMO_SCOPES: readonly DemoScope[] = [
  { key: 'all', label: '所有照片', hint: '從最新的一張開始整理', photoCount: 2418, icon: 'photo' },
  { key: 'screenshots', label: '截圖', hint: '最容易累積的一批', photoCount: 316, icon: 'screenshot' },
  { key: 'recent30Days', label: '最近 30 天', hint: '先處理剛拍的照片', photoCount: 184, icon: 'calendar' },
  { key: 'month', label: '2026 年 6 月', hint: '依月份逐批整理', photoCount: 227, icon: 'calendar' },
  { key: 'album', label: '相簿：東京旅行', hint: '只整理指定相簿', photoCount: 96, icon: 'album' },
] as const;

/** 滑動整理 Demo 的起始統計。 */
export const DEMO_INITIAL_STATS = {
  /** 這個範圍總共有幾張，用來當進度分母。 */
  total: 184,
  /** 進入 Demo 前「已經整理過」的張數，讓進度條不是從 0 開始。 */
  alreadyProcessed: 133,
  kept: 133,
  discarded: 0,
} as const;

/** Review Demo 的待刪清單：取前 9 張，剛好排滿 3 欄。 */
export const DEMO_REVIEW_ITEMS: readonly DemoPhoto[] = DEMO_PHOTOS.slice(0, 9);

/**
 * 單次刪除交易的展示結果。
 *
 * 形狀刻意貼近正式的 DeleteTransactionResult（successfulCount／
 * systemConfirmationCount／remainingCount），但這是純字面值，
 * 不 import delete-runner，也不代表任何真實刪除。
 */
export const DEMO_DELETE_RESULT = {
  /** Section 04 一開始顯示的待刪張數。 */
  pendingCount: 45,
  successfulCount: 45,
  /** 單次交易只會讓 iPhone 要求一次系統確認。 */
  systemConfirmationCount: 1,
  remainingCount: 0,
} as const;

/** 安全恢復 Demo。刻意不含 runId／rawValue／storage key／batchIndex。 */
export const DEMO_RECOVERY = {
  savedKept: 133,
  savedPending: 18,
  savedDeleted: 45,
  /** 恢復畫面顯示的「涉及照片」張數。 */
  affectedCount: 18,
} as const;

/** Summary 自動輪播的步驟。 */
export type DemoFlowStep = 'scope' | 'swipe' | 'review' | 'confirm' | 'done';

export const DEMO_FLOW_STEPS: readonly { step: DemoFlowStep; label: string }[] = [
  { step: 'scope', label: '選範圍' },
  { step: 'swipe', label: '滑動整理' },
  { step: 'review', label: '再次確認' },
  { step: 'confirm', label: '系統確認' },
  { step: 'done', label: '完成' },
] as const;

/** Behind the experience 的四張小卡。 */
export const DEMO_TECH_CARDS: readonly { index: string; title: string; body: string }[] = [
  { index: '01', title: 'Local-first', body: '照片只在裝置端處理，不上傳私人相片。' },
  { index: '02', title: 'Safe deletion', body: 'App 內確認，再交由 iPhone 系統確認。' },
  { index: '03', title: 'Session recovery', body: '整理進度會保存，異常中斷也能安全處理。' },
  { index: '04', title: 'Single transaction', body: '本次選取一次送出，不自行切成多批。' },
] as const;
