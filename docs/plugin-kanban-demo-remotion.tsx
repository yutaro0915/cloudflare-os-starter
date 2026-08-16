import React from "react";
import {
  AbsoluteFill,
  Composition,
  Img,
  Sequence,
  interpolate,
  registerRoot,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

const FPS = 30;
const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
const colors = {
  ink: "#111b20",
  navy: "#07141c",
  panel: "#10252f",
  paper: "#f7f9fa",
  muted: "#718087",
  line: "#dce3e6",
  mint: "#60e0b0",
  blue: "#5d8ff7",
  coral: "#ff8364",
  gold: "#f3c969",
};

function enter(frame: number, delay = 0): number {
  return spring({fps: FPS, frame: frame - delay, config: {damping: 18, stiffness: 130}});
}

function Chrome({children, kanban = true}: {children: React.ReactNode; kanban?: boolean}) {
  return <div style={{position: "absolute", left: 42, right: 42, top: 116, bottom: 30, borderRadius: 22, overflow: "hidden", background: colors.paper, boxShadow: "0 30px 90px #0008", display: "grid", gridTemplateRows: "42px 1fr"}}>
    <div style={{background: "#edf1f2", borderBottom: `1px solid ${colors.line}`, display: "flex", alignItems: "center", gap: 8, padding: "0 15px"}}>
      <span style={{width: 11, height: 11, borderRadius: 20, background: colors.coral}} />
      <span style={{width: 11, height: 11, borderRadius: 20, background: colors.gold}} />
      <span style={{width: 11, height: 11, borderRadius: 20, background: colors.mint}} />
      <div style={{marginLeft: 18, width: 520, height: 24, borderRadius: 7, background: "#fff", color: colors.muted, padding: "3px 12px", fontSize: 13}}>localhost:3000/{kanban ? "plugin/circle.personal-kanban/board" : "plugins"}</div>
    </div>
    {children}
  </div>;
}

function Sidebar({showKanban = true, active = false}: {showKanban?: boolean; active?: boolean}) {
  const frame = useCurrentFrame();
  const reveal = showKanban ? enter(frame, 5) : 0;
  const base = ["Home", "Workspaces", "Blueprints", "Outputs", "Explore", "Agents", "Skills", "Plugin Store"];
  return <div style={{width: 228, background: "#f1f4f4", borderRight: `1px solid ${colors.line}`, padding: "22px 14px", color: colors.ink}}>
    <div style={{fontSize: 16, fontWeight: 800, margin: "2px 8px 25px"}}>◈ Cloudflare OS</div>
    {base.map(label => <div key={label} style={{height: 33, padding: "7px 10px", borderRadius: 8, fontSize: 14, color: label === "Plugin Store" && !showKanban ? colors.blue : "#526068"}}>◇ &nbsp;{label}</div>)}
    {showKanban && <div style={{height: 34, padding: "7px 10px", borderRadius: 8, fontSize: 14, fontWeight: 750, opacity: reveal, transform: `translateX(${(1 - reveal) * -22}px)`, color: active ? "#126a52" : colors.ink, background: active ? "#d9f6ec" : "transparent"}}>◆ &nbsp;Kanban</div>}
  </div>;
}

function Pointer({x, y, pulse = false}: {x: number; y: number; pulse?: boolean}) {
  const frame = useCurrentFrame();
  const scale = pulse ? interpolate(frame % 24, [0, 10, 24], [1, 0.72, 1], clamp) : 1;
  return <div style={{position: "absolute", left: x, top: y, zIndex: 20, transform: `scale(${scale})`}}>
    <div style={{width: 21, height: 21, borderRadius: 30, border: `4px solid ${colors.coral}`, boxShadow: "0 0 0 8px #ff836433"}} />
    <div style={{width: 3, height: 27, background: colors.coral, transform: "rotate(-38deg)", transformOrigin: "top", marginLeft: 17, marginTop: -3}} />
  </div>;
}

function Header({step, title, note}: {step: string; title: string; note: string}) {
  const frame = useCurrentFrame();
  const p = enter(frame);
  return <div style={{position: "absolute", left: 66, top: 18, zIndex: 30, opacity: p, transform: `translateY(${(1 - p) * -16}px)`}}>
    <div style={{fontSize: 13, fontWeight: 900, letterSpacing: 2.3, color: colors.mint}}>{step}</div>
    <div style={{fontSize: 30, fontWeight: 850, color: "white", letterSpacing: -0.7}}>{title}</div>
    <div style={{fontSize: 15, color: "#b7c7ce", marginTop: 4}}>{note}</div>
  </div>;
}

function InstallScene() {
  const frame = useCurrentFrame();
  const installed = frame > 105;
  const press = interpolate(frame, [78, 92, 105], [1, 0.94, 1], clamp);
  return <AbsoluteFill style={{background: colors.navy}}>
    <Header step="01 · INSTALL" title="StoreからPersonal Kanbanを追加" note="人が承認した state mutation capability だけを付与します" />
    <Chrome kanban={false}><div style={{display: "flex"}}><Sidebar showKanban={installed} />
      <div style={{padding: "46px 54px", flex: 1, color: colors.ink}}>
        <div style={{fontSize: 30, fontWeight: 850}}>Plugin Store</div>
        <div style={{marginTop: 28, border: `1px solid ${colors.line}`, borderRadius: 18, padding: 28, background: "white", display: "flex", alignItems: "center", justifyContent: "space-between"}}>
          <div><div style={{fontSize: 22, fontWeight: 800}}>Personal Kanban</div><div style={{fontSize: 15, color: colors.muted, marginTop: 8}}>Create, move, and delete persistent tasks.</div><div style={{marginTop: 14, fontSize: 13, color: "#996918"}}>Requires: plugin.ui.state.mutate</div></div>
          <div style={{padding: "11px 24px", borderRadius: 10, background: installed ? "#e8f8f2" : colors.ink, color: installed ? "#187359" : "white", fontWeight: 800, transform: `scale(${press})`}}>{installed ? "Installed" : "Install"}</div>
        </div>
      </div></div></Chrome>
    {!installed && <Pointer x={1083} y={439} pulse />}
  </AbsoluteFill>;
}

type TaskPosition = "none" | "todo" | "moving" | "doing";

function Board({position, typed = "", reloading = false}: {position: TaskPosition; typed?: string; reloading?: boolean}) {
  const frame = useCurrentFrame();
  const columns = [{id: "todo", title: "To do"}, {id: "doing", title: "Doing"}, {id: "done", title: "Done"}];
  const nextAction = position === "doing" ? "Move to Done" : "Move to Doing";
  const card = <div style={{height: 96, padding: 15, borderRadius: 12, background: "white", border: `1px solid ${colors.line}`, boxShadow: "0 8px 24px #17313d13", fontSize: 15, fontWeight: 750}}>
    Implement sidebar navigation
    <div style={{marginTop: 12, color: colors.blue, fontSize: 11, fontWeight: 700}}>{nextAction}</div>
  </div>;
  return <div style={{display: "flex", minHeight: 0, flex: 1}}><Sidebar active />
    <div style={{position: "relative", flex: 1, padding: "32px 34px", color: colors.ink}}>
      <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}><div><div style={{fontSize: 29, fontWeight: 850}}>Personal Kanban</div><div style={{fontSize: 13, color: colors.muted, marginTop: 5}}>Persistent plugin state · revision {position === "none" ? 0 : position === "todo" ? 1 : 2}</div></div><div style={{padding: "8px 13px", borderRadius: 8, border: `1px solid ${colors.line}`, fontSize: 13}}>↻ Refresh</div></div>
      <div style={{marginTop: 21, display: "flex", gap: 10}}><div style={{flex: 1, height: 40, border: `1px solid ${colors.line}`, borderRadius: 9, background: "white", padding: "10px 13px", color: typed ? colors.ink : "#a2adb2", fontSize: 14}}>{typed || "What needs to be done?"}<span style={{opacity: typed ? (frame % 18 < 9 ? 1 : 0) : 0}}>|</span></div><div style={{padding: "10px 20px", borderRadius: 9, background: colors.ink, color: "white", fontSize: 14, fontWeight: 750}}>Add task</div></div>
      <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 15, marginTop: 24}}>{columns.map((column, index) => <div key={column.id} style={{minHeight: 278, borderRadius: 14, background: "#edf1f2", padding: 14}}>
        <div style={{fontSize: 14, fontWeight: 800, marginBottom: 13}}>{column.title} <span style={{color: colors.muted, fontWeight: 600}}>· {position === column.id ? 1 : 0}</span></div>
        {position === column.id && card}
      </div>)}</div>
      {position === "moving" && <div style={{position: "absolute", width: 248, left: interpolate(frame, [0, 105], [42, 322], clamp), top: interpolate(frame, [0, 105], [185, 182], clamp), transform: `rotate(${interpolate(frame, [0, 52, 105], [0, -3, 0], clamp)}deg)`, zIndex: 12}}>{card}</div>}
      {reloading && <div style={{position: "absolute", inset: 0, background: "#f7f9facc", display: "grid", placeItems: "center", fontSize: 22, fontWeight: 800}}><div style={{transform: `rotate(${frame * 8}deg)`}}>↻</div></div>}
    </div></div>;
}

function NavigateScene() {
  const frame = useCurrentFrame();
  const board = frame > 76;
  const cursorX = interpolate(frame, [8, 58], [520, 128], clamp);
  const cursorY = interpolate(frame, [8, 58], [360, 432], clamp);
  return <AbsoluteFill style={{background: colors.navy}}>
    <Header step="02 · NAVIGATE" title="サイドバーのKanbanから専用画面へ" note="routeはhostが固定し、pluginはURLやbrowser authorityを受け取りません" />
    <Chrome>{board ? <Board position="none" /> : <div style={{display: "flex"}}><Sidebar active={false} /><div style={{flex: 1, display: "grid", placeItems: "center", color: colors.muted}}>Plugin Store</div></div>}</Chrome>
    {!board && <Pointer x={cursorX} y={cursorY} pulse={frame > 50} />}
  </AbsoluteFill>;
}

const taskText = "Implement sidebar navigation";

function CreateScene() {
  const frame = useCurrentFrame();
  const chars = Math.floor(interpolate(frame, [20, 125], [0, taskText.length], clamp));
  const created = frame > 158;
  const cardEnter = enter(frame, 158);
  return <AbsoluteFill style={{background: colors.navy}}>
    <Header step="03 · CREATE" title="タスクを作る" note="操作はrevision付きCASでPluginStateへ保存されます" />
    <Chrome><div style={{display: "flex", height: "100%", transform: `scale(${1 + cardEnter * 0.004})`}}><Board position={created ? "todo" : "none"} typed={created ? "" : taskText.slice(0, chars)} /></div></Chrome>
    {frame > 128 && frame < 171 && <Pointer x={1127} y={242} pulse />}
  </AbsoluteFill>;
}

function MoveScene() {
  const frame = useCurrentFrame();
  const moving = frame > 76 && frame < 182;
  const position: TaskPosition = frame <= 76 ? "todo" : moving ? "moving" : "doing";
  return <AbsoluteFill style={{background: colors.navy}}>
    <Header step="04 · MOVE" title="カードをDoingへ移動" note="plugin reducerが次stateを返し、hostが検証してrevision 2へcommitします" />
    <Chrome><Board position={position} /></Chrome>
    {frame < 90 && <Pointer x={489} y={425} pulse={frame > 52} />}
  </AbsoluteFill>;
}

function PersistScene() {
  const frame = useCurrentFrame();
  const reload = frame > 42 && frame < 100;
  return <AbsoluteFill style={{background: colors.navy}}>
    <Header step="05 · PERSIST" title="再読込してもタスクは残る" note="Workerのmemoryではなく、installation-owned Durable Objectが正本です" />
    <Chrome><Board position="doing" reloading={reload} /></Chrome>
    {frame < 65 && <Pointer x={1141} y={191} pulse />}
  </AbsoluteFill>;
}

function BoundaryScene() {
  const frame = useCurrentFrame();
  const nodes = [
    ["Browser", "closed actions only"],
    ["Authenticated API", "exact installation"],
    ["Dynamic Worker", "pure reducer · no env"],
    ["PluginState DO", "CAS + revision"],
  ];
  return <AbsoluteFill style={{background: colors.navy, color: "white"}}>
    <Header step="WHY THIS IS A PLUGIN" title="Kanbanの規則はkernelではなくartifact側" note="hostはgeneric columns/items/actionsと所有境界だけを提供します" />
    <div style={{position: "absolute", left: 68, right: 68, top: 260, display: "flex", alignItems: "center", justifyContent: "space-between"}}>{nodes.map(([title, note], index) => {
      const p = enter(frame, index * 24);
      return <React.Fragment key={title}><div style={{width: 235, minHeight: 150, borderRadius: 20, padding: 24, background: index === 2 ? colors.mint : colors.panel, color: index === 2 ? colors.ink : "white", border: "1px solid #ffffff24", transform: `translateY(${(1 - p) * 30}px) scale(${0.9 + p * 0.1})`, opacity: p}}><div style={{fontSize: 22, fontWeight: 850}}>{title}</div><div style={{fontSize: 15, marginTop: 14, lineHeight: 1.45, color: index === 2 ? "#355b4e" : "#aabcc4"}}>{note}</div></div>{index < nodes.length - 1 && <div style={{color: colors.gold, fontSize: 34}}>→</div>}</React.Fragment>;
    })}</div>
  </AbsoluteFill>;
}

function ProofScene() {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 145], [1, 1.055], clamp);
  return <AbsoluteFill style={{background: colors.navy, color: "white"}}>
    <Header step="ACTUAL APP" title="実アプリでも同じ状態を確認" note="サイドバー遷移・Doingのカード・revision 2が一画面で観測できます" />
    <div style={{position: "absolute", left: 70, right: 70, top: 128, bottom: 45, overflow: "hidden", borderRadius: 22, boxShadow: "0 25px 80px #0009"}}><Img src={staticFile("plugin-kanban-doing.png")} style={{width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})`}} /></div>
  </AbsoluteFill>;
}

function Demo() {
  return <AbsoluteFill style={{background: colors.navy, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"}}>
    <Sequence from={0} durationInFrames={180}><InstallScene /></Sequence>
    <Sequence from={180} durationInFrames={150}><NavigateScene /></Sequence>
    <Sequence from={330} durationInFrames={210}><CreateScene /></Sequence>
    <Sequence from={540} durationInFrames={210}><MoveScene /></Sequence>
    <Sequence from={750} durationInFrames={150}><PersistScene /></Sequence>
    <Sequence from={900} durationInFrames={180}><BoundaryScene /></Sequence>
    <Sequence from={1080} durationInFrames={180}><ProofScene /></Sequence>
  </AbsoluteFill>;
}

function Root() {
  return <Composition id="KanbanPluginDemo" component={Demo} durationInFrames={1260} fps={FPS} width={1280} height={720} />;
}

registerRoot(Root);
