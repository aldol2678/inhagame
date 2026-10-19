import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "convert_fbx.py");
const DETAIL_MAX = 600;

export class ModelConvertError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.name = "ModelConvertError";
    this.code = code;
    this.detail = detail;
  }
}

// Blender exits 0 on Python exceptions unless --python-exit-code is set, which
// previously turned a missing numpy into a bare ENOENT on the output file.
export function blenderArgs(src, dst) {
  return ["--background", "--factory-startup", "--python-exit-code", "1", "--python", script, "--", src, dst];
}

// Short, single-line-per-entry stderr tail safe to log or return to the trusted
// proxy: temp dirs and absolute paths are reduced, control chars and the proxy
// secret (if ever echoed) removed.
export function sanitizeDetail(text, { tmpDir = "", secret = process.env.MODEL_CONVERT_PROXY_SECRET || "" } = {}) {
  let out = String(text || "");
  if (secret) out = out.split(secret).join("[redacted]");
  if (tmpDir) out = out.split(tmpDir).join("<tmp>");
  out = out
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s'"\\/:]+){2,}[\\/]([^\s'"\\/:]+)/g, "<path>/$1")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ")
    .split("\n").map(line => line.trimEnd()).filter(Boolean).join("\n");
  return out.length > DETAIL_MAX ? out.slice(-DETAIL_MAX) : out;
}

// Maps a conversion failure to the converter's HTTP response. Only reachable
// after the x-converter-key check; the Vercel proxy still never forwards
// upstream bodies to browsers. `detail` is the sanitized Blender output tail.
export function conversionErrorResponse(error) {
  const code = /^E_[A-Z0-9_]+$/.test(error?.code || "") ? error.code
    : String(error?.message || "").split(":")[0].match(/^E_[A-Z0-9_]+$/)?.[0] || "E_MODEL_CONVERT_FAILED";
  const status = code === "E_MODEL_FILE_TOO_LARGE" ? 413
    : code === "E_MODEL_FILE_REQUIRED" ? 400
    : code === "E_MODEL_CONVERTER_NOT_INSTALLED" ? 503
    : 422;
  const body = { error: code };
  if (error instanceof ModelConvertError && error.detail) body.detail = error.detail;
  return { status, body };
}

function run(command, args, { timeoutMs = 50000, spawn = nodeSpawn, tmpDir = "" } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error?.code === "ENOENT" ? new ModelConvertError("E_MODEL_CONVERTER_NOT_INSTALLED") : error);
      return;
    }
    let stdout = "", stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(reject, new ModelConvertError("E_MODEL_CONVERT_TIMEOUT", sanitizeDetail(stderr.slice(-2000), { tmpDir })));
    }, timeoutMs);
    child.stdout?.on("data", chunk => { stdout += chunk; if (stdout.length > 8192) stdout = stdout.slice(-8192); });
    child.stderr?.on("data", chunk => { stderr += chunk; if (stderr.length > 8192) stderr = stderr.slice(-8192); });
    child.on("error", error => {
      finish(reject, error?.code === "ENOENT" ? new ModelConvertError("E_MODEL_CONVERTER_NOT_INSTALLED") : error);
    });
    child.on("close", (code, signal) => {
      if (code === 0) return finish(resolve, { stdout, stderr });
      // Blender prints Python tracebacks to stdout or stderr depending on the
      // failure point, so the tail of both is kept.
      const tail = sanitizeDetail(`${stderr.slice(-2000)}\n${stdout.slice(-1000)}`, { tmpDir });
      finish(reject, new ModelConvertError("E_MODEL_CONVERT_BLENDER_FAILED",
        `exit=${code ?? "null"}${signal ? ` signal=${signal}` : ""}${tail ? `\n${tail}` : ""}`));
    });
  });
}

export async function convertFbxBuffer(buffer, {
  blenderBin = process.env.BLENDER_BIN || "blender",
  spawn = nodeSpawn,
  timeoutMs = 50000
} = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ModelConvertError("E_MODEL_FILE_REQUIRED");
  if (buffer.length > 25 * 1024 * 1024) throw new ModelConvertError("E_MODEL_FILE_TOO_LARGE");
  const dir = await mkdtemp(path.join(os.tmpdir(), "inha-world-fbx-"));
  const src = path.join(dir, "source.fbx");
  const dst = path.join(dir, "converted.glb");
  try {
    await writeFile(src, buffer);
    const { stdout, stderr } = await run(blenderBin, blenderArgs(src, dst), { timeoutMs, spawn, tmpDir: dir });
    let result;
    try {
      result = await readFile(dst);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      result = Buffer.alloc(0);
    }
    if (!result.length) {
      throw new ModelConvertError("E_MODEL_CONVERT_OUTPUT_MISSING",
        sanitizeDetail(`${stderr.slice(-2000)}\n${stdout.slice(-1000)}`, { tmpDir: dir }));
    }
    if (result.length < 20 || result.subarray(0, 4).toString("ascii") !== "glTF")
      throw new ModelConvertError("E_MODEL_CONVERT_INVALID_GLB");
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
