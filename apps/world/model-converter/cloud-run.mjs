import http from "node:http";
import { convertFbxBuffer } from "./convert-model.mjs";

const PORT = Number(process.env.PORT || 8080);
const MAX_BYTES = 25 * 1024 * 1024;
const secret = process.env.MODEL_CONVERT_PROXY_SECRET || "";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("E_MODEL_FILE_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/") return json(res, 404, { error: "NOT_FOUND" });
  if (!secret || req.headers["x-converter-key"] !== secret) return json(res, 401, { error: "E_MODEL_CONVERT_AUTH" });

  const filename = String(req.headers["x-model-filename"] || "");
  if (!/^[^/\\]{1,180}\.fbx$/iu.test(filename)) return json(res, 400, { error: "E_MODEL_FBX_FILENAME_REQUIRED" });

  try {
    const input = await readBody(req);
    const output = await convertFbxBuffer(input);
    res.writeHead(200, {
      "Content-Type": "model/gltf-binary",
      "Content-Length": output.length,
      "Cache-Control": "no-store"
    });
    res.end(output);
  } catch (error) {
    const code = String(error?.message || "E_MODEL_CONVERT_FAILED").split(":")[0];
    const status = code === "E_MODEL_FILE_TOO_LARGE" ? 413
      : code === "E_MODEL_FILE_REQUIRED" ? 400
      : code === "E_MODEL_CONVERTER_NOT_INSTALLED" ? 503
      : 422;
    console.warn("model conversion failed", code);
    json(res, status, { error: code });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`INHA WORLD model converter listening on :${PORT}`);
});
