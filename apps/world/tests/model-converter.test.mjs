import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn as realSpawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  blenderArgs,
  conversionErrorResponse,
  convertFbxBuffer,
  sanitizeDetail
} from "../model-converter/convert-model.mjs";

const world = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const FBX = Buffer.from("Kaydara FBX Binary  \0synthetic");
const NUMPY_TRACE = (dir) => [
  "Traceback (most recent call last):",
  `  File "/usr/share/blender/scripts/addons/io_scene_gltf2/__init__.py", line 1, in execute`,
  "ModuleNotFoundError: No module named 'numpy'",
  `Error: export to ${dir}/converted.glb failed`
].join("\n");

function validGlb() {
  const glb = Buffer.alloc(20);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(20, 8);
  return glb;
}

// Minimal stand-in for child_process.spawn. `behave(child, args)` drives it.
function fakeSpawn(behave) {
  const calls = [];
  const spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = null;
    child.kill = (signal) => { child.killed = signal; setImmediate(() => child.emit("close", null, signal)); };
    calls.push({ command, args, child });
    setImmediate(() => behave(child, args));
    return child;
  };
  return { spawn, calls };
}

const finish = (child, code, { stdout = "", stderr = "" } = {}) => {
  if (stdout) child.stdout.write(stdout);
  if (stderr) child.stderr.write(stderr);
  setImmediate(() => child.emit("close", code, null));
};

test("model converter rejects empty and oversized FBX before spawning Blender", async () => {
  await assert.rejects(convertFbxBuffer(Buffer.alloc(0)), /E_MODEL_FILE_REQUIRED/);
  await assert.rejects(convertFbxBuffer(Buffer.alloc(25 * 1024 * 1024 + 1)), /E_MODEL_FILE_TOO_LARGE/);
});

test("Blender is invoked with --python-exit-code 1 so script exceptions fail the process", async () => {
  const args = blenderArgs("/tmp/x/source.fbx", "/tmp/x/converted.glb");
  const i = args.indexOf("--python-exit-code");
  assert.ok(i >= 0, "missing --python-exit-code");
  assert.equal(args[i + 1], "1");
  assert.ok(i < args.indexOf("--python"), "--python-exit-code must precede --python");
  assert.deepEqual(args.slice(-3), ["--", "/tmp/x/source.fbx", "/tmp/x/converted.glb"]);

  const { spawn, calls } = fakeSpawn((child, a) => {
    writeFile(a.at(-1), validGlb()).then(() => finish(child, 0));
  });
  const out = await convertFbxBuffer(FBX, { blenderBin: "blender-test", spawn });
  assert.equal(out.subarray(0, 4).toString("ascii"), "glTF");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes("--python-exit-code"));
});

test("exit 0 without an output file is OUTPUT_MISSING with the Blender cause, not ENOENT", async () => {
  let tmp = "";
  const { spawn } = fakeSpawn((child, a) => {
    tmp = path.dirname(a.at(-1));
    finish(child, 0, { stdout: "Blender 3.4.1\n", stderr: NUMPY_TRACE(tmp) });
  });
  const error = await convertFbxBuffer(FBX, { spawn }).then(() => null, e => e);
  assert.equal(error?.code, "E_MODEL_CONVERT_OUTPUT_MISSING");
  assert.match(error.detail, /No module named 'numpy'/);
  assert.ok(!error.detail.includes(tmp), "temp dir leaked into detail");
  assert.ok(!error.detail.includes("/usr/share/blender"), "absolute path leaked into detail");
  const { status, body } = conversionErrorResponse(error);
  assert.equal(status, 422);
  assert.equal(body.error, "E_MODEL_CONVERT_OUTPUT_MISSING");
  assert.notEqual(body.error, "ENOENT");
  assert.match(body.detail, /numpy/);
});

test("exit 0 with an empty output file is OUTPUT_MISSING", async () => {
  const { spawn } = fakeSpawn((child, a) => { writeFile(a.at(-1), "").then(() => finish(child, 0)); });
  await assert.rejects(convertFbxBuffer(FBX, { spawn }), { code: "E_MODEL_CONVERT_OUTPUT_MISSING" });
});

test("nonzero Blender exit surfaces BLENDER_FAILED with exit code and sanitized stderr tail", async () => {
  const { spawn } = fakeSpawn((child, a) => finish(child, 1, { stderr: NUMPY_TRACE(path.dirname(a.at(-1))) }));
  const error = await convertFbxBuffer(FBX, { spawn }).then(() => null, e => e);
  assert.equal(error?.code, "E_MODEL_CONVERT_BLENDER_FAILED");
  assert.equal(error.message, "E_MODEL_CONVERT_BLENDER_FAILED");
  assert.match(error.detail, /^exit=1/);
  assert.match(error.detail, /No module named 'numpy'/);
  assert.match(error.detail, /<tmp>\/converted\.glb/);
  assert.ok(error.detail.length <= 600);
  assert.deepEqual(conversionErrorResponse(error).status, 422);
});

test("hung Blender is killed and reported as TIMEOUT", async () => {
  const { spawn, calls } = fakeSpawn((child) => child.stderr.write("Read prefs\n"));
  await assert.rejects(convertFbxBuffer(FBX, { spawn, timeoutMs: 30 }), { code: "E_MODEL_CONVERT_TIMEOUT" });
  assert.equal(calls[0].child.killed, "SIGKILL");
});

test("missing Blender binary maps to NOT_INSTALLED / 503", async () => {
  const { spawn } = fakeSpawn((child) => child.emit("error", Object.assign(new Error("spawn"), { code: "ENOENT" })));
  const error = await convertFbxBuffer(FBX, { spawn }).then(() => null, e => e);
  assert.equal(error?.code, "E_MODEL_CONVERTER_NOT_INSTALLED");
  assert.equal(conversionErrorResponse(error).status, 503);
});

test("error responses never echo raw non-code messages, secrets or long output", () => {
  assert.deepEqual(conversionErrorResponse(Object.assign(new Error("ENOENT: no such file, open '/tmp/a/b.glb'"), { code: "ENOENT" })),
    { status: 422, body: { error: "E_MODEL_CONVERT_FAILED" } });
  const detail = sanitizeDetail(`key=s3cr3t-value\n${"x".repeat(5000)}`, { secret: "s3cr3t-value" });
  assert.ok(!detail.includes("s3cr3t-value"));
  assert.ok(detail.length <= 600);
});

test("converter image installs python3-numpy for Blender's glTF exporter", () => {
  const dockerfile = read("Dockerfile.model-converter");
  const install = dockerfile.split("\n").find(line => /apt-get install/.test(line)) || "";
  assert.match(install, /\bblender\b/);
  assert.match(install, /\bpython3-numpy\b/);
  assert.match(read("model-converter/convert-model.mjs"), /"--python-exit-code", "1"/);
});

test("cloud-run entrypoint returns BLENDER_FAILED with the numpy cause instead of ENOENT", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-blender-"));
  const fake = path.join(dir, "blender");
  // Emulates Blender 3.4.1 without numpy: the exporter traceback is printed and
  // the process exits 0 unless --python-exit-code is passed.
  await writeFile(fake, `#!${process.execPath}
process.stderr.write("Traceback (most recent call last):\\nModuleNotFoundError: No module named 'numpy'\\n");
const i = process.argv.indexOf("--python-exit-code");
process.exit(i >= 0 ? Number(process.argv[i + 1]) : 0);
`);
  await chmod(fake, 0o755);
  const port = String(20000 + Math.floor(Math.random() * 20000));
  const key = "test-converter-key-0123456789";
  const child = realSpawn(process.execPath, ["model-converter/cloud-run.mjs"], {
    cwd: world, stdio: ["ignore", "ignore", "pipe"],
    env: { PATH: process.env.PATH, PORT: port, MODEL_CONVERT_PROXY_SECRET: key, BLENDER_BIN: fake }
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 50 && !up && child.exitCode === null; i++) {
      await new Promise(r => setTimeout(r, 100));
      up = await fetch(`${base}/health`).then(r => r.ok, () => false);
    }
    assert.ok(up, `converter did not listen: ${stderr}`);
    const post = (headers) => fetch(`${base}/`, { method: "POST", body: FBX,
      headers: { "content-type": "application/octet-stream", "x-model-filename": "cube.fbx", ...headers } });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ "x-converter-key": "wrong" })).status, 401);
    const res = await post({ "x-converter-key": key });
    const body = await res.json();
    assert.equal(res.status, 422);
    assert.equal(body.error, "E_MODEL_CONVERT_BLENDER_FAILED");
    assert.match(body.detail, /No module named 'numpy'/);
    assert.ok(!JSON.stringify(body).includes(key));
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
