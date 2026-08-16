import {spawnSync} from "node:child_process";

const video = process.argv[2] ?? "docs/plugin-kanban-demo-remotion.mp4";

function run(command, args) {
  const result = spawnSync(command, args, {encoding: "utf8"});
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result.stdout;
}

const probe = JSON.parse(run("ffprobe", [
  "-v", "error",
  "-show_entries", "format=duration:stream=codec_name,width,height,r_frame_rate",
  "-of", "json",
  video,
]));
const videoStream = probe.streams.find(stream => stream.codec_name === "h264");
if (videoStream?.width !== 1280 || videoStream.height !== 720) {
  throw new Error("Expected a 1280x720 H.264 video stream.");
}
if (videoStream.r_frame_rate !== "30/1") throw new Error("Expected 30fps.");
const duration = Number(probe.format.duration);
if (duration < 41 || duration > 43) throw new Error(`Unexpected duration: ${duration}`);

const hashes = run("ffmpeg", [
  "-v", "error", "-i", video,
  "-vf", "fps=2,scale=320:-1",
  "-f", "framemd5", "-",
]).split(/\n/)
  .filter(line => line.startsWith("0,"))
  .map(line => line.split(", ").at(-1));
const unique = new Set(hashes).size;
if (hashes.length < 80 || unique < 75) {
  throw new Error(`Insufficient continuous motion: ${unique}/${hashes.length} unique samples.`);
}

console.log(`PASS ${video}: ${duration.toFixed(2)}s, ${unique}/${hashes.length} unique 2fps samples`);
