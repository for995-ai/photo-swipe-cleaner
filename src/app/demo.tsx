/**
 * /demo — Portfolio Product Showcase
 *
 * 這是作品集展示用的長頁，**不是**正式 App 的一部分：
 * - 不 import useCleanup／usePhotoDeletion／delete-*／session／MediaLibrary
 * - 不要求相簿權限、不讀真實相簿、不刪除任何照片
 * - 不讀寫正式 Session 或 Delete Journal
 *
 * 所有狀態都是這個檔案裡的 React local state，資料一律來自 lib/demo-fixtures.ts。
 * 重新載入 /demo 就回到初始狀態。
 *
 * 正式 App 沒有任何入口連到這裡；這個路由只透過網址直接開啟。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { DemoModeBadge, DemoShell, useDemoLayout, useReducedMotion } from '@/components/demo/demo-shell';
import { DemoSection } from '@/components/demo/demo-section';
import { PhoneMockup } from '@/components/demo/phone-mockup';
import { DeleteDemoScreen, type DeleteDemoStage } from '@/components/demo/screens/delete-demo-screen';
import { RecoveryDemoScreen, type RecoveryDemoView } from '@/components/demo/screens/recovery-demo-screen';
import { ReviewDemoScreen } from '@/components/demo/screens/review-demo-screen';
import { ScopeDemoScreen } from '@/components/demo/screens/scope-demo-screen';
import { SummaryDemoScreen } from '@/components/demo/screens/summary-demo-screen';
import { SwipeDemoScreen, type SwipeDemoDecision } from '@/components/demo/screens/swipe-demo-screen';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelButton } from '@/components/pixel/pixel-button';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { APP_NAME, APP_VERSION_LABEL } from '@/lib/app-info';
import {
  DEMO_FLOW_STEPS,
  DEMO_INITIAL_STATS,
  DEMO_PHOTOS,
  DEMO_REVIEW_ITEMS,
  DEMO_SCOPES,
  DEMO_TECH_CARDS,
  type DemoFlowStep,
  type DemoPhoto,
} from '@/lib/demo-fixtures';
import { colors, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

/** 手機外框厚度佔寬度的比例，與 PhoneMockup 內的 FRAME_RATIO 一致。 */
const FRAME_RATIO = 0.028;

/** Summary 自動輪播間隔：刻意放慢，不做快速切換。 */
const FLOW_INTERVAL_MS = 2600;

export default function DemoScreen() {
  const { width, phoneWidth, breakpoint } = useDemoLayout();
  const reducedMotion = useReducedMotion();

  /** 手機螢幕可用寬度（扣掉左右機身）。 */
  const screenWidth = Math.round(phoneWidth - phoneWidth * FRAME_RATIO * 2);

  // ─────────────────────────────── Section 進場：捲動位置 + 區塊 y 座標
  //
  // 刻意不用 IntersectionObserver：這樣 web 與 native 走同一條路徑，
  // static export 預渲染時也不會碰到任何 DOM API。
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [sectionTops, setSectionTops] = useState<Record<string, number>>({});

  const registerSection = useCallback((key: string) => (y: number) => {
    setSectionTops((prev) => (prev[key] === y ? prev : { ...prev, [key]: y }));
  }, []);

  /** 區塊頂端進入視窗下緣 15% 後才開始播動畫。 */
  const isVisible = useCallback(
    (key: string) => {
      if (reducedMotion) {
        return true;
      }
      const top = sectionTops[key];
      if (top === undefined || viewportHeight === 0) {
        // 還沒量到就先顯示，避免預渲染或量測失敗時整頁空白。
        return true;
      }
      return scrollY + viewportHeight * 0.85 > top;
    },
    [reducedMotion, sectionTops, scrollY, viewportHeight]
  );

  // ─────────────────────────────── Section 01：滑動整理
  const [swipeIndex, setSwipeIndex] = useState(0);
  // fixture 用了 as const，所以要明確標成 number，否則會被推成字面型別。
  const [kept, setKept] = useState<number>(DEMO_INITIAL_STATS.kept);
  const [discarded, setDiscarded] = useState<number>(DEMO_INITIAL_STATS.discarded);
  const [exiting, setExiting] = useState<SwipeDemoDecision | null>(null);
  /** 已做過的決定，供「復原」回溯。 */
  const [history, setHistory] = useState<SwipeDemoDecision[]>([]);

  const currentPhoto: DemoPhoto | null = swipeIndex < DEMO_PHOTOS.length ? DEMO_PHOTOS[swipeIndex] : null;

  const decide = (decision: SwipeDemoDecision) => {
    if (exiting || !currentPhoto) {
      return;
    }
    setExiting(decision);
  };

  /** 退場動畫播完（或 reduced motion 直接跳過）才真正推進索引。 */
  const handleExitDone = useCallback(() => {
    setExiting((pending) => {
      if (!pending) {
        return null;
      }
      setSwipeIndex((i) => i + 1);
      setHistory((h) => [...h, pending]);
      if (pending === 'keep') {
        setKept((v) => v + 1);
      } else {
        setDiscarded((v) => v + 1);
      }
      return null;
    });
  }, []);

  const undo = () => {
    if (exiting || history.length === 0) {
      return;
    }
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setSwipeIndex((i) => Math.max(i - 1, 0));
    if (last === 'keep') {
      setKept((v) => Math.max(v - 1, 0));
    } else {
      setDiscarded((v) => Math.max(v - 1, 0));
    }
  };

  const resetSwipe = () => {
    setExiting(null);
    setSwipeIndex(0);
    setKept(DEMO_INITIAL_STATS.kept);
    setDiscarded(DEMO_INITIAL_STATS.discarded);
    setHistory([]);
  };

  const processed = DEMO_INITIAL_STATS.alreadyProcessed + history.length;

  // ─────────────────────────────── Section 02：範圍
  const [scopeKey, setScopeKey] = useState(DEMO_SCOPES[2].key);

  // ─────────────────────────────── Section 03：Review
  const [reviewItems, setReviewItems] = useState<DemoPhoto[]>([...DEMO_REVIEW_ITEMS]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const keepPhoto = (id: string) => {
    setReviewItems((items) => items.filter((p) => p.id !== id));
    setPreviewIndex(null);
  };
  const resetReview = () => {
    setReviewItems([...DEMO_REVIEW_ITEMS]);
    setPreviewIndex(null);
  };

  // ─────────────────────────────── Section 04：刪除交易
  const [deleteStage, setDeleteStage] = useState<DeleteDemoStage>('idle');

  // ─────────────────────────────── Section 05：恢復
  const [recoveryView, setRecoveryView] = useState<RecoveryDemoView>('saved');

  // ─────────────────────────────── Summary 自動輪播
  const [flowStep, setFlowStep] = useState<DemoFlowStep>('scope');
  const flowIndex = useRef(0);

  useEffect(() => {
    // reduced motion 時完全不啟動 timer，畫面停在第一步。
    if (reducedMotion) {
      return;
    }
    const timer = setInterval(() => {
      flowIndex.current = (flowIndex.current + 1) % DEMO_FLOW_STEPS.length;
      setFlowStep(DEMO_FLOW_STEPS[flowIndex.current].step);
    }, FLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  const isMobile = breakpoint === 'mobile';

  const techCards = useMemo(
    () => (
      <View style={[styles.techGrid, isMobile ? styles.techGridMobile : null]}>
        {DEMO_TECH_CARDS.map((card) => (
          <PixelSurface
            key={card.index}
            background={colors.surface}
            style={[styles.techCard, isMobile ? styles.techCardMobile : null]}>
            <Text
              style={[typeStyle(typeAccent.badgeLabel, width), styles.techIndex]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              {card.index}
            </Text>
            <Text
              style={[typeStyle(typeAccent.button, width), styles.techTitle]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              {card.title}
            </Text>
            <Text
              style={[typeStyle(typeAccent.micro, width), styles.techBody]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              {card.body}
            </Text>
          </PixelSurface>
        ))}
      </View>
    ),
    [isMobile, width]
  );

  return (
    <ScrollView
      style={styles.scroll}
      scrollEventThrottle={32}
      onScroll={(event) => setScrollY(event.nativeEvent.contentOffset.y)}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}>
      <DemoShell>
        <View style={styles.badgeRow}>
          <DemoModeBadge />
        </View>

        {/* ─────────── SECTION 01 ─────────── */}
        <DemoSection
          eyebrow="Swipe to clean"
          title={'相簿太亂？\n滑一下就整理'}
          subtitle="左滑待刪、右滑保留，把整理照片變成最直覺的動作。"
          align="center"
          visible={isVisible('s1')}
          reducedMotion={reducedMotion}
          onLayoutY={registerSection('s1')}
          aside={
            <View style={styles.controls}>
              <View style={styles.controlSlot}>
                <PixelButton label="左滑：待刪" tone="discard" haptics={false} onPress={() => decide('discard')} />
              </View>
              <View style={styles.controlSlot}>
                <PixelButton label="右滑：保留" tone="keep" haptics={false} onPress={() => decide('keep')} />
              </View>
              <View style={styles.controlSlot}>
                <PixelButton
                  label="復原"
                  tone="neutral"
                  haptics={false}
                  disabled={history.length === 0}
                  onPress={undo}
                />
              </View>
              <View style={styles.controlSlot}>
                <PixelButton label="重設" tone="plain" compact haptics={false} onPress={resetSwipe} />
              </View>
            </View>
          }
          phone={
            <PhoneMockup width={phoneWidth}>
              <SwipeDemoScreen
                screenWidth={screenWidth}
                photo={currentPhoto}
                kept={kept}
                discarded={discarded}
                processed={processed}
                total={DEMO_INITIAL_STATS.total}
                exiting={exiting}
                onExitDone={handleExitDone}
                reducedMotion={reducedMotion}
              />
            </PhoneMockup>
          }
        />

        {/* ─────────── SECTION 02 ─────────── */}
        <DemoSection
          eyebrow="Choose your scope"
          title={'不用一次整理\n整個相簿'}
          subtitle="從全部照片、截圖、最近照片到指定月份，只整理你現在想處理的範圍。"
          align="text-left"
          visible={isVisible('s2')}
          reducedMotion={reducedMotion}
          onLayoutY={registerSection('s2')}
          aside={
            <Text
              style={[typeStyle(typeAccent.micro, width), styles.asideNote]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              點手機裡的任一個範圍，下方張數會跟著換。
            </Text>
          }
          phone={
            <PhoneMockup width={phoneWidth}>
              <ScopeDemoScreen
                screenWidth={screenWidth}
                scopes={DEMO_SCOPES}
                selectedKey={scopeKey}
                onSelect={setScopeKey}
              />
            </PhoneMockup>
          }
        />

        {/* ─────────── SECTION 03 ─────────── */}
        <DemoSection
          eyebrow="Review first"
          title={'刪之前，\n再看最後一次'}
          subtitle="所有待刪照片集中確認，點一下還能放大檢視。"
          align="text-right"
          visible={isVisible('s3')}
          reducedMotion={reducedMotion}
          onLayoutY={registerSection('s3')}
          aside={
            <View style={styles.controls}>
              <Text
                style={[typeStyle(typeAccent.micro, width), styles.asideNote]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                點縮圖放大，可以把照片改回保留。
              </Text>
              <View style={styles.controlSlot}>
                <PixelButton label="重設清單" tone="plain" compact haptics={false} onPress={resetReview} />
              </View>
            </View>
          }
          phone={
            <PhoneMockup width={phoneWidth}>
              <ReviewDemoScreen
                screenWidth={screenWidth}
                items={reviewItems}
                previewIndex={previewIndex}
                onOpenPreview={setPreviewIndex}
                onClosePreview={() => setPreviewIndex(null)}
                onKeepPhoto={keepPhoto}
              />
            </PhoneMockup>
          }
        />

        {/* ─────────── SECTION 04 ─────────── */}
        <DemoSection
          eyebrow="One confirmation"
          title={'選多少，\n就一次送出多少'}
          subtitle="App 不自行切成多批，刪除前再交由 iPhone 系統確認。"
          align="text-left"
          visible={isVisible('s4')}
          reducedMotion={reducedMotion}
          onLayoutY={registerSection('s4')}
          aside={
            <Text
              style={[typeStyle(typeAccent.micro, width), styles.asideNote]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              這段是展示模擬，不會刪除任何照片。
            </Text>
          }
          phone={
            <PhoneMockup width={phoneWidth}>
              <DeleteDemoScreen
                screenWidth={screenWidth}
                stage={deleteStage}
                onRequestDelete={() => setDeleteStage('app-confirm')}
                onCancelAppConfirm={() => setDeleteStage('idle')}
                onStartDelete={() => setDeleteStage('system-confirm')}
                onSystemCancel={() => setDeleteStage('cancelled')}
                onSystemConfirm={() => setDeleteStage('completed')}
                onReset={() => setDeleteStage('idle')}
              />
            </PhoneMockup>
          }
        />

        {/* ─────────── SECTION 05 ─────────── */}
        <DemoSection
          eyebrow="Safe recovery"
          title={'整理到一半，\n也不用從頭開始'}
          subtitle="整理進度會保存，異常中斷時也有安全恢復機制。"
          align="text-right"
          visible={isVisible('s5')}
          reducedMotion={reducedMotion}
          onLayoutY={registerSection('s5')}
          aside={
            <View style={styles.controls}>
              <View style={styles.controlSlot}>
                <PixelButton
                  label="看進度保存"
                  tone={recoveryView === 'saved' ? 'primary' : 'neutral'}
                  haptics={false}
                  onPress={() => setRecoveryView('saved')}
                />
              </View>
              <View style={styles.controlSlot}>
                <PixelButton
                  label="看安全恢復"
                  tone={recoveryView === 'recovery' ? 'primary' : 'neutral'}
                  haptics={false}
                  onPress={() => setRecoveryView('recovery')}
                />
              </View>
              <View style={styles.controlSlot}>
                <PixelButton
                  label="重新開始 Demo"
                  tone="plain"
                  compact
                  haptics={false}
                  onPress={() => setRecoveryView('saved')}
                />
              </View>
            </View>
          }
          phone={
            <PhoneMockup width={phoneWidth}>
              <RecoveryDemoScreen
                screenWidth={screenWidth}
                view={recoveryView}
                onConfirmStillPresent={() => setRecoveryView('resolved-present')}
                onConfirmDeleted={() => setRecoveryView('resolved-deleted')}
              />
            </PhoneMockup>
          }
        />

        {/* ─────────── Behind the experience ─────────── */}
        <View
          onLayout={(event) => registerSection('tech')(event.nativeEvent.layout.y)}
          style={styles.techSection}>
          <Text
            style={[
              styles.techHeading,
              { fontSize: isMobile ? 26 : 34, lineHeight: isMobile ? 34 : 44 },
            ]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            {'看起來簡單，\n背後不能隨便。'}
          </Text>
          {techCards}
        </View>

        {/* ─────────── Summary ─────────── */}
        <DemoSection
          title={'把整理相簿，\n變成一件沒壓力的事。'}
          subtitle="Swipe → Review → Confirm → Done"
          align="center"
          visible={isVisible('summary')}
          reducedMotion={reducedMotion}
          onLayoutY={registerSection('summary')}
          phone={
            <PhoneMockup width={phoneWidth}>
              <SummaryDemoScreen screenWidth={screenWidth} step={flowStep} />
            </PhoneMockup>
          }
          aside={
            <View style={styles.summaryFooter}>
              <Text
                style={[typeStyle(typeAccent.sectionTitle, width), styles.appName]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                {APP_NAME}
              </Text>
              <PixelBadge label={APP_VERSION_LABEL} tone="warning" />
              <View style={styles.techBadges}>
                <PixelBadge label="Expo" tone="info" />
                <PixelBadge label="React Native" tone="info" />
                <PixelBadge label="iOS" tone="neutral" />
              </View>
            </View>
          }
        />

        <View style={styles.bottomSpace} />
      </DemoShell>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  badgeRow: {
    alignItems: 'flex-end',
    paddingTop: spacing.lg,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  controlSlot: {
    minWidth: 116,
  },
  asideNote: {
    color: colors.textSecondary,
  },
  techSection: {
    gap: spacing.lg,
    paddingVertical: spacing.xl * 2,
  },
  techHeading: {
    color: '#3B2C63',
    fontWeight: '700',
  },
  techGrid: {
    flexDirection: 'row',
    gap: spacing.ms,
  },
  techGridMobile: {
    flexDirection: 'column',
  },
  techCard: {
    flex: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  techCardMobile: {
    flex: undefined,
    width: '100%',
  },
  techIndex: {
    color: colors.primaryText,
    letterSpacing: 1.2,
  },
  techTitle: {
    color: colors.textPrimary,
  },
  techBody: {
    color: colors.textSecondary,
  },
  summaryFooter: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  appName: {
    color: colors.textPrimary,
  },
  techBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingTop: spacing.xs,
  },
  bottomSpace: {
    height: spacing.xl * 2,
  },
});
