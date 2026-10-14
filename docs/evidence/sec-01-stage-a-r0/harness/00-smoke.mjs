// Smoke: real Realtime private inbox delivery of a server-approved campus message.
import { makeUsers, joinCampus, subscribe, rpc, sendArgs, sleep, countRows, pool, unsubscribeAll } from "./lib.mjs";

const [a, b] = await makeUsers(2, "smk");
const la = await joinCampus(a);
const lb = await joinCampus(b);
const sub = await subscribe(b, lb.topic);
console.log("subscribe", sub.status, sub.error);
const args = sendArgs(la, { text: "smoke 테스트" });
const r = await rpc(a, "sec01_send_campus_chat", args);
console.log("send", JSON.stringify(r.data), r.error, r.ms.toFixed(1) + "ms");
await sleep(1500);
console.log("received", sub.messages.length, JSON.stringify(sub.messages[0]?.payload)?.slice(0, 300));
console.log("rows", await countRows(args.p_request_id));
await unsubscribeAll([a, b]);
await pool.end();
process.exit(0);
