import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
const dev = process.argv.includes("--dev");
if (!existsSync(".venv/bin/python")) {
  console.error("Run npm run setup first.");
  process.exit(1);
}
if (!dev && !existsSync("dist/index.html")) {
  console.error("Run npm run build first.");
  process.exit(1);
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
function run(command, args) {
  const p = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  children.push(p);
  p.on("error", (e) => {
    console.error(e);
    stop(1);
  });
  p.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
run(".venv/bin/python", [
  "-m",
  "uvicorn",
  "backend.app:app",
  "--host",
  "127.0.0.1",
  "--port",
  process.env.CHOIRE_PORT || "8765",
]);
if (dev) run("node", ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"]);
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
