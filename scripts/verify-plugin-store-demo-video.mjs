import {execFileSync, spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {resolve} from "node:path";

const target = resolve(
  process.argv[2] ?? "docs/plugin-store-focus-guide-demo-remotion.mp4",
);

if (!existsSync(target)) {
  throw new Error(`Demo video does not exist: ${target}`);
}

const probe = JSON.parse(execFileSync("ffprobe", [
  "-v", "error",
  "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
  "-of", "json",
  target,
], {encoding: "utf8"}));

const video = probe.streams.find(stream => stream.codec_type === "video");
const audio = probe.streams.find(stream => stream.codec_type === "audio");
const duration = Number(probe.format.duration);

if (video?.codec_name !== "h264" || video.width !== 1280 || video.height !== 720 ||
    video.r_frame_rate !== "30/1") {
  throw new Error(`Expected H.264 1280x720 at 30fps, got ${JSON.stringify(video)}.`);
}
if (!audio) throw new Error("Expected a narration audio track.");
if (!(duration >= 46.9 && duration <= 47.2)) {
  throw new Error(`Expected the 47-second explanation, got ${duration} seconds.`);
}

const loudnessProbe = spawnSync("ffmpeg", [
  "-hide_banner", "-i", target, "-filter_complex", "ebur128", "-f", "null", "-",
], {encoding: "utf8"});
if (loudnessProbe.status !== 0) throw new Error(loudnessProbe.stderr);
const loudnessMatches = [...loudnessProbe.stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)];
const integratedLoudness = Number(loudnessMatches.at(-1)?.[1]);
if (!(integratedLoudness >= -20 && integratedLoudness <= -15)) {
  throw new Error(`Expected audible web narration at -20 to -15 LUFS, got ${integratedLoudness}.`);
}

const hashes = execFileSync("ffmpeg", [
  "-v", "error", "-i", target,
  "-map", "0:v:0", "-an",
  "-vf", "crop=1100:470:90:130,fps=2",
  "-f", "framemd5", "-",
], {encoding: "utf8"})
  .split("\n")
  .filter(line => line && !line.startsWith("#"))
  .map(line => line.split(",").at(-1)?.trim())
  .filter(Boolean);

const uniqueFrames = new Set(hashes).size;
if (uniqueFrames < 50) {
  throw new Error(
    `Expected the central explanation region to change across most samples; got ${uniqueFrames}.`,
  );
}

console.log(JSON.stringify({
  target,
  duration,
  video,
  audioCodec: audio.codec_name,
  integratedLoudness,
  uniqueCentralFrames: uniqueFrames,
}));
