import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Sequence,
  interpolate,
  registerRoot,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const COLORS = {
  ink: "#10212b",
  muted: "#5f737d",
  paper: "#f6f3ec",
  mint: "#bfe5d2",
  green: "#1f7658",
  coral: "#ee7d60",
  gold: "#f1c66b",
  navy: "#0c1b25",
};

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({fps, frame: frame - delay, config: {damping: 18, mass: 0.8}});
}

function SceneFrame({children, kicker, title}: {
  children: React.ReactNode;
  kicker: string;
  title: string;
}) {
  const frame = useCurrentFrame();
  const enter = useEnter();
  return (
    <AbsoluteFill style={{
      background: `radial-gradient(circle at ${18 + frame * 0.015}% 15%, #244250, ${COLORS.navy} 58%)`,
      color: COLORS.paper,
      fontFamily: "Inter, Hiragino Sans, Yu Gothic, sans-serif",
      overflow: "hidden",
    }}>
      <div style={{position: "absolute", left: 62, top: 44, opacity: enter}}>
        <div style={{fontSize: 15, letterSpacing: 3, color: COLORS.mint, fontWeight: 800}}>{kicker}</div>
        <div style={{fontSize: 38, fontWeight: 750, marginTop: 8, letterSpacing: -1.5}}>{title}</div>
      </div>
      {children}
      <div style={{position: "absolute", left: 62, right: 62, bottom: 30, height: 3, background: "#ffffff20"}}>
        <div style={{height: "100%", width: `${interpolate(frame, [0, 1410], [0, 100], clamp)}%`, background: COLORS.mint}} />
      </div>
    </AbsoluteFill>
  );
}

function BrowserScreen({src, zoom = 1, x = 0, y = 0}: {
  src: string;
  zoom?: number;
  x?: number;
  y?: number;
}) {
  return (
    <div style={{
      position: "absolute",
      left: 78,
      top: 126,
      width: 1124,
      height: 532,
      borderRadius: 24,
      overflow: "hidden",
      border: "1px solid #ffffff2e",
      boxShadow: "0 28px 80px #00000078",
      background: "#fff",
    }}>
      <Img src={staticFile(src)} style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      }} />
    </div>
  );
}

function Caption({children, tone = "mint", style}: {
  children: React.ReactNode;
  tone?: "mint" | "coral" | "gold";
  style?: React.CSSProperties;
}) {
  const enter = useEnter(8);
  const background = tone === "coral" ? COLORS.coral : tone === "gold" ? COLORS.gold : COLORS.mint;
  return (
    <div style={{
      position: "absolute",
      padding: "13px 18px",
      borderRadius: 15,
      color: COLORS.ink,
      background,
      fontSize: 22,
      fontWeight: 750,
      boxShadow: "0 10px 30px #00000045",
      transform: `translateY(${(1 - enter) * 18}px)`,
      opacity: enter,
      ...style,
    }}>{children}</div>
  );
}

function Pointer({from, to, start = 20, end = 110}: {
  from: [number, number];
  to: [number, number];
  start?: number;
  end?: number;
}) {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [start, end], [from[0], to[0]], clamp);
  const y = interpolate(frame, [start, end], [from[1], to[1]], clamp);
  const press = interpolate(frame, [end - 8, end, end + 8], [1, 0.72, 1], clamp);
  return (
    <div style={{position: "absolute", left: x, top: y, transform: `scale(${press})`, zIndex: 20}}>
      <div style={{width: 30, height: 30, borderRadius: 30, border: `4px solid ${COLORS.coral}`, boxShadow: "0 0 0 8px #ee7d6040"}} />
      <div style={{width: 3, height: 34, background: COLORS.coral, transform: "rotate(-38deg)", transformOrigin: "top", marginLeft: 23, marginTop: -5}} />
    </div>
  );
}

function Intro() {
  const frame = useCurrentFrame();
  const enter = useEnter();
  const ring = interpolate(frame, [0, 145], [0, 360], clamp);
  return (
    <SceneFrame kicker="REAL PLUGIN DEMO" title="Focus Guideは何をする？">
      <div style={{position: "absolute", left: 80, top: 190, width: 720, opacity: enter}}>
        <div style={{fontSize: 52, lineHeight: 1.17, fontWeight: 800, letterSpacing: -2}}>
          25分集中の<span style={{color: COLORS.mint}}>手順パネル</span>を<br />Plugin Storeへ追加します。
        </div>
        <div style={{marginTop: 34, fontSize: 24, lineHeight: 1.55, color: "#d6e1e6"}}>
          タイマーやタスク保存ではありません。<br />installで現れ、uninstallで消える最小UI contributionです。
        </div>
      </div>
      <div style={{position: "absolute", right: 116, top: 208, width: 300, height: 300}}>
        <div style={{position: "absolute", inset: 0, borderRadius: 999, background: `conic-gradient(${COLORS.mint} ${ring}deg, #ffffff15 0deg)`, padding: 18}}>
          <div style={{width: "100%", height: "100%", borderRadius: 999, background: COLORS.navy, display: "grid", placeItems: "center"}}>
            <div style={{textAlign: "center"}}><div style={{fontSize: 64, fontWeight: 850}}>25</div><div style={{fontSize: 18, color: COLORS.muted}}>MIN FOCUS</div></div>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
}

function BeforeInstall() {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 190], [1, 1.08], clamp);
  return (
    <SceneFrame kicker="STEP 1" title="人がreviewしたpackageをinstall">
      <BrowserScreen src="plugin-store-before.jpg" zoom={zoom} x={-32 * (zoom - 1)} />
      <Caption style={{right: 96, top: 154}}>install前：追加面はまだ表示されない</Caption>
      <Pointer from={[970, 510]} to={[1058, 468]} start={35} end={155} />
    </SceneFrame>
  );
}

function Installed() {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 230], [1.03, 1.13], clamp);
  return (
    <SceneFrame kicker="STEP 2" title="インストールするとcontributionが現れる">
      <BrowserScreen src="plugin-store-installed.jpg" zoom={zoom} x={-60} y={-6} />
      <Caption tone="gold" style={{left: 116, top: 150}}>exact version 1.0.0・capability要求なし</Caption>
      <Caption style={{right: 100, bottom: 92}}>「Open Focus Guide」が追加される</Caption>
      <Pointer from={[920, 514]} to={[1018, 462]} start={55} end={184} />
    </SceneFrame>
  );
}

function FocusGuide() {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 260], [1.06, 1.18], clamp);
  const steps = ["Pick one task", "Work for 25 minutes", "Share the result"];
  return (
    <SceneFrame kicker="THE FEATURE" title="表示するのは、集中の3ステップ">
      <BrowserScreen src="plugin-store-focus-guide-open.jpg" zoom={zoom} x={-70} y={-28} />
      <div style={{position: "absolute", left: 760, top: 158, width: 420, padding: "22px 24px", background: "#0c1b25ed", borderRadius: 20, border: "1px solid #ffffff25"}}>
        {steps.map((step, index) => {
          const appear = spring({fps: 30, frame: frame - 35 - index * 55, config: {damping: 16}});
          return <div key={step} style={{display: "flex", alignItems: "center", gap: 14, fontSize: 22, margin: "17px 0", opacity: appear, transform: `translateX(${(1 - appear) * 30}px)`}}>
            <span style={{display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 34, background: COLORS.mint, color: COLORS.ink, fontWeight: 850}}>{index + 1}</span>
            {step}
          </div>;
        })}
        <div style={{marginTop: 18, paddingTop: 16, borderTop: "1px solid #ffffff20", color: "#ffb5a4", fontSize: 17}}>※ タイマー実行・タスク保存はまだしません</div>
      </div>
    </SceneFrame>
  );
}

function Flow() {
  const frame = useCurrentFrame();
  const nodes = [
    ["Reviewed source", "human review"],
    ["Content address", "SHA-256"],
    ["Dynamic Worker", "limits + no ambient env"],
    ["Closed document", "text / notice / list"],
    ["Plugin Store", "host-rendered UI"],
  ] as const;
  return (
    <SceneFrame kicker="HOW IT RUNS" title="コードをbrowserへ直接渡していません">
      <div style={{position: "absolute", left: 60, right: 60, top: 230, display: "flex", alignItems: "center", justifyContent: "space-between"}}>
        {nodes.map(([title, note], index) => {
          const appear = spring({fps: 30, frame: frame - index * 28, config: {damping: 17}});
          return <React.Fragment key={title}>
            <div style={{width: 190, minHeight: 145, borderRadius: 20, padding: 22, background: index === 2 ? COLORS.mint : "#17313d", color: index === 2 ? COLORS.ink : COLORS.paper, border: "1px solid #ffffff24", transform: `translateY(${(1 - appear) * 35}px) scale(${0.86 + appear * 0.14})`, opacity: appear}}>
              <div style={{fontSize: 21, fontWeight: 800}}>{title}</div>
              <div style={{fontSize: 15, lineHeight: 1.4, marginTop: 12, color: index === 2 ? COLORS.muted : "#a9bbc4"}}>{note}</div>
            </div>
            {index < nodes.length - 1 && <div style={{fontSize: 34, color: COLORS.gold, opacity: interpolate(frame, [index * 28 + 16, index * 28 + 36], [0, 1], clamp)}}>→</div>}
          </React.Fragment>;
        })}
      </div>
      <Caption style={{left: 276, bottom: 104}}>検証済みの表示データだけがアプリへ届く</Caption>
    </SceneFrame>
  );
}

function Uninstall() {
  const frame = useCurrentFrame();
  const wipe = interpolate(frame, [80, 155], [0, 100], clamp);
  return (
    <SceneFrame kicker="STEP 3" title="uninstallすると追加面が消える">
      <BrowserScreen src="plugin-store-installed.jpg" zoom={1.08} x={-48} />
      <div style={{position: "absolute", left: 78, top: 126, width: 1124, height: 532, borderRadius: 24, overflow: "hidden", clipPath: `inset(0 0 0 ${wipe}%)`}}>
        <Img src={staticFile("plugin-store-after-uninstall.jpg")} style={{width: "100%", height: "100%", objectFit: "cover"}} />
      </div>
      <Pointer from={[1018, 465]} to={[1094, 463]} start={18} end={76} />
      <Caption tone="coral" style={{left: 96, bottom: 92}}>実行権限を失効し、追加面を消す</Caption>
    </SceneFrame>
  );
}

function Outro() {
  const enter = useEnter();
  return (
    <SceneFrame kicker="WHAT CHANGED" title="今回プラグイン化したもの">
      <div style={{position: "absolute", left: 80, right: 80, top: 180, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, opacity: enter}}>
        <div style={{borderRadius: 24, padding: 34, background: COLORS.mint, color: COLORS.ink}}>
          <div style={{fontSize: 25, fontWeight: 850}}>追加されたもの</div>
          <div style={{fontSize: 22, lineHeight: 1.7, marginTop: 20}}>✓ 25分集中の手順パネル<br />✓ install / uninstall lifecycle<br />✓ 隔離Workerで生成するUI</div>
        </div>
        <div style={{borderRadius: 24, padding: 34, background: "#17313d", border: "1px solid #ffffff25"}}>
          <div style={{fontSize: 25, fontWeight: 850}}>まだ追加していないもの</div>
          <div style={{fontSize: 22, lineHeight: 1.7, marginTop: 20, color: "#d0dce2"}}>— タイマー実行<br />— タスクの保存<br />— AIによる生成・公開権限</div>
        </div>
      </div>
    </SceneFrame>
  );
}

function PluginStoreExplainer() {
  return (
    <AbsoluteFill style={{background: COLORS.navy}}>
      <Audio src={staticFile("plugin-store-focus-guide-narration.m4a")} volume={0.95} />
      <Sequence from={0} durationInFrames={150}><Intro /></Sequence>
      <Sequence from={150} durationInFrames={210}><BeforeInstall /></Sequence>
      <Sequence from={360} durationInFrames={240}><Installed /></Sequence>
      <Sequence from={600} durationInFrames={270}><FocusGuide /></Sequence>
      <Sequence from={870} durationInFrames={240}><Flow /></Sequence>
      <Sequence from={1110} durationInFrames={210}><Uninstall /></Sequence>
      <Sequence from={1320} durationInFrames={90}><Outro /></Sequence>
    </AbsoluteFill>
  );
}

function Root() {
  return <Composition
    id="PluginStoreExplainer"
    component={PluginStoreExplainer}
    durationInFrames={1410}
    fps={30}
    width={1280}
    height={720}
  />;
}

registerRoot(Root);
