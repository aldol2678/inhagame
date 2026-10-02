import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "convert_fbx.py");

function run(command, args, { timeoutMs = 50000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("E_MODEL_CONVERT_TIMEOUT"));
    }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk; if (stdout.length > 8192) stdout = stdout.slice(-8192); });
    child.stderr.on("data", chunk => { stderr += chunk; if (stderr.length > 8192) stderr = stderr.slice(-8192); });
    child.on("error", error => {
      clearTimeout(timer);
      reject(error.code === "ENOENT" ? new Error("E_MODEL_CONVERTER_NOT_INSTALLED") : error);
    });
    child.on("exit", code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`E_MODEL_CONVERT_PROCESS:${code}:${stderr.slice(-1000)}`));
    });
  });
}

export async function convertFbxBuffer(buffer, { blenderBin = process.env.BLENDER_BIN || "blender" } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("E_MODEL_FILE_REQUIRED");
  if (buffer.length > 25 * 1024 * 1024) throw new Error("E_MODEL_FILE_TOO_LARGE");
  const dir = await mkdtemp(path.join(os.tmpdir(), "inha-world-fbx-"));
  const src = path.join(dir, "source.fbx");
  const dst = path.join(dir, "converted.glb");
  try {
    await writeFile(src, buffer);
    await run(blenderBin, ["--background", "--factory-startup", "--python", script, "--", src, dst]);
    const result = await readFile(dst);
    if (result.length < 20 || result.subarray(0, 4).toString("ascii") !== "glTF")
      throw new Error("E_MODEL_CONVERT_INVALID_GLB");
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
