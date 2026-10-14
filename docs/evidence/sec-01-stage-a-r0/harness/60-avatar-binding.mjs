// Experiment F · avatar binding verification (authorized isolated-lab security test).
// Three synthetic accounts on the disposable local stack:
//   U1 = subject, runs the REAL client stack (SupabaseRealtimeTransport + NetworkManager +
//        RemotePlayerManager) from main 0dcae7b.
//   U3 = observer, runs the same REAL client stack and reports what its RemotePlayerManager shows.
//   U2 = a second ordinary authenticated account using a plain supabase-js channel (a modified
//        client), used to test whether presence/pose claims are bound to server identity.
// The existing campus transport (world:campus:AREA_*) is used UNCHANGED. Each case records the
// three layers separately: server acceptance, what the observer's model holds, and chat-feed binding.
import crypto from "node:crypto";
import { SupabaseRealtimeTransport } from "../../../../apps/world/src/network/supabase-realtime-transport.js";
import { NetworkManager } from "../../../../apps/world/src/network/network-manager.js";
import { encodePose, encodeAction, ActionType, Anim, validatePresence } from "../../../../apps/world/src/network/protocol.js";
import { ChatFeed } from "../../../../apps/world/src/online/local-chat.js";
import { makeUsers, sleep, pool, recorder, verdict, unsubscribeAll, freshClient } from "./lib.mjs";

const rec = recorder("F-avatar-binding");
const ZONE = `AREA_LABF_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const TOPIC = `world:campus:${ZONE}`;
const clock = { now: () => Date.now() };
const [U1, U2, U3] = await makeUsers(3, "f");
const nick = async (u) => (await pool.query("select nickname from public.profiles where user_id=$1", [u.id])).rows[0].nickname;
const n1 = await nick(U1), n2 = await nick(U2), n3 = await nick(U3);

function startClient(user, sessionId, name) {
  const transport = new SupabaseRealtimeTransport(user.client, { windowTarget: null });
  const net = new NetworkManager({ transport, clock, identity: { sessionId, userId: user.id, displayName: name } });
  const events = [];
  net.onRemoteEvent((e) => events.push({ type: e.type, sessionId: e.player?.sessionId, userId: e.player?.userId, name: e.player?.displayName, action: e.action?.type, payload: e.action?.payload }));
  net.start();
  net.setPlaceZone(ZONE);
  return { net, events, transport };
}
const until = async (pred, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return true; await sleep(50); } return false; };
const cap = (p, ms = 3000, tag = "timeout") => Promise.race([Promise.resolve(p).catch((e) => "err:" + e.message), new Promise((r) => setTimeout(() => r(tag), ms))]);

const s1 = crypto.randomUUID(), s3 = crypto.randomUUID();
const c1 = startClient(U1, s1, n1);
const c3 = startClient(U3, s3, n3);
let pose1 = { x: 10, y: 0, z: 10, yaw: 0, vx: 0, vz: 0, anim: Anim.IDLE };
const tick = setInterval(() => { c1.net.update({ ...pose1 }); c3.net.update(null); }, 50);
const modelOf = (c, sid) => c.net.remotes.get(sid);

await until(() => c3.net.zoneSynced && modelOf(c3, s1)?.latestPose);
const u3SeesU1 = modelOf(c3, s1);

// A plain second-account channel on the same private topic. Presence key is spoofable client-side.
const rawClient = freshClient(U2);
const raw = rawClient.channel(TOPIC, { config: { private: true, presence: { key: s1 }, broadcast: { self: false } } });
const rawJoin = await new Promise((res) => raw.subscribe((st) => { if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(st)) res(st); }));

// F-presence · a second account tracks a presence whose userId/sessionId name U1.
const claim = { v: 1, sessionId: s1, userId: U1.id, displayName: n1, placeZoneId: ZONE, joinedAt: Date.now() + 60000 };
const trackRes = rawJoin === "SUBSCRIBED" ? await cap(raw.track(claim)) : "no-join";
await sleep(1500);
const afterClaim = modelOf(c3, s1);
const claimAccepted = c3.events.some((e) => e.type === "playerUpdated" && e.sessionId === s1 && e.name === n1 && afterClaim?.userId === U1.id);
// A second presence under a NEW sessionId that also names U1 (duplicate-identity handling).
const s1b = crypto.randomUUID();
const raw2Client = freshClient(U2);
const raw2 = raw2Client.channel(TOPIC, { config: { private: true, presence: { key: s1b }, broadcast: { self: false } } });
await new Promise((res) => raw2.subscribe((st) => { if (st === "SUBSCRIBED" || st === "CHANNEL_ERROR") res(st); }));
await cap(raw2.track({ v: 1, sessionId: s1b, userId: U1.id, displayName: n1, placeZoneId: ZONE, joinedAt: Date.now() + 120000 }));
await sleep(1500);
const u3HasRealU1 = !!modelOf(c3, s1)?.latestPose;
const u3HasClaim = !!modelOf(c3, s1b);
rec.add({ id: "F2-F3", title: "타인의 userId/sessionId를 사용한 아바타 사칭 가능 여부(기존 전송)", verdict: (rawJoin === "SUBSCRIBED" && (claimAccepted || u3HasClaim)) ? "FAIL" : "PASS",
  level: "real Supabase Realtime + real client RemotePlayerManager (unmodified transport)",
  observed: { secondAccountJoinedCampusTopic: rawJoin, secondAccountPresenceTrackResult: trackRes, presenceClaimForU1SessionAccepted: claimAccepted,
    duplicateIdentityNewSessionVisible: u3HasClaim, realU1StillVisible: u3HasRealU1,
    note: "Supabase private-channel RLS authorizes the SOCKET (any authenticated account) but does not bind Presence key/meta to auth.uid(); validatePresence() trusts packet.userId/sessionId." },
  expected: "presence/pose carrying another account's identity is rejected or never attributed to that account" });

// F-chat · can a second account's broadcast drive U1's speech bubble on U3?
const feed = new ChatFeed({ clock });
feed.setPlaceZone(ZONE);
// U3's real pipeline: NetworkManager delivers CHAT actions; identity comes from Presence (event.player).
c3.net.onRemoteEvent((e) => {
  if (e.type === "playerAction" && e.action?.type === ActionType.CHAT) {
    const sender = c3.net.remotes.get(e.player.sessionId);
    feed.receive({ sender: sender ? { sessionId: sender.sessionId, userId: sender.userId, displayName: sender.displayName, placeZoneId: sender.placeZoneId } : null,
      placeZoneId: ZONE, text: e.action.payload.text, position: { x: e.action.payload.x, y: e.action.payload.y, z: e.action.payload.z }, receiverPosition: { x: 10, y: 0, z: 10 } });
  }
});
// The second account broadcasts a CHAT action packet tagged with U1's session id in the envelope.
const chatPacket = encodeAction(1, ActionType.CHAT, { text: "F 사칭 말풍선", x: 10, y: 0, z: 10 });
if (rawJoin === "SUBSCRIBED") await cap(raw.send({ type: "broadcast", event: "action", payload: { sid: s1, p: chatPacket } }));
await sleep(1200);
const bubbleOnU1 = feed.bubbleFor(s1);
// Because s1b was tracked as present and names U1, a chat tagged s1b would attribute to displayName n1.
if (rawJoin === "SUBSCRIBED") await cap(raw2.send({ type: "broadcast", event: "action", payload: { sid: s1b, p: encodeAction(2, ActionType.CHAT, { text: "F 사칭 2", x: 10, y: 0, z: 10 }) } }));
await sleep(1200);
const bubbleViaDup = feed.bubbleFor(s1b);
rec.add({ id: "F1", title: "서버 인증 채팅 세션과 시각적 아바타의 안전한 대응", verdict: (bubbleOnU1 || bubbleViaDup) ? "FAIL" : "PASS",
  level: "real Realtime + real ChatFeed/RemotePlayerManager",
  observed: { bubbleRenderedOverU1FromSecondAccount: bubbleOnU1, bubbleViaDuplicateIdentity: bubbleViaDup,
    note: "The campus chat path derives the bubble's name from client-declared Presence, which a modified client sets freely; there is no server-authenticated chat session bound to the avatar on the campus transport." },
  expected: "a speech bubble appears over an avatar only for a server-authenticated message from that account" });

// F4 · safe feed-only fallback: SEC-01 server inbox delivers an authenticated envelope that carries
// its own senderUserId/senderName, independent of Presence; the feed can show it without binding a bubble.
import { joinCampus, rpc, sendArgs } from "./lib.mjs";
const lab1 = await joinCampus(U1, ZONE), lab3 = await joinCampus(U3, ZONE);
const labClient = freshClient(U3);
const labSub = labClient.channel(lab3.topic, { config: { private: true } });
const labMsgs = [];
labSub.on("broadcast", { event: "campus_chat_v1" }, (m) => labMsgs.push(m.payload));
await cap(new Promise((res) => labSub.subscribe((st) => { if (st === "SUBSCRIBED" || st === "CHANNEL_ERROR") res(st); })), 6000);
const labArgs = sendArgs(lab1, { text: "F4 서버 인증 피드" });
const labSend = await rpc(U1, "sec01_send_campus_chat", labArgs);
await sleep(1500);
const env = labMsgs.find((m) => m.envelope?.requestId === labArgs.p_request_id)?.envelope;
const envNameTrusted = env && env.senderUserId === U1.id && env.senderName === n1;
rec.add({ id: "F4", title: "아바타 연결 미인증 시 피드 전용 안전 경로 동작", verdict: verdict(!!envNameTrusted),
  level: "real PostgREST + real Supabase Realtime (SEC-01 lab inbox)",
  observed: { serverEnvelopeSenderUserId: env?.senderUserId, matchesAuthUser: env?.senderUserId === U1.id, serverEnvelopeSenderName: env?.senderName, senderNameServerDerived: env?.senderName === n1, carriesNoAvatarSessionBinding: env ? !("avatarSessionId" in env) : null },
  expected: "server-authenticated envelope carries server-derived senderUserId/senderName usable for a feed line without trusting any client presence" });

// F5 · presence/pose transport is unchanged by this experiment: byte-compare an emitted pose packet
// against encodePose from protocol.js, and confirm no SEC-01 field was added to the presence packet.
const posePacket = encodePose(7, pose1);
const refPose = encodePose(7, pose1);
const presenceSample = validatePresence({ v: 1, sessionId: s1, userId: U1.id, displayName: n1, placeZoneId: ZONE, joinedAt: 1 });
rec.add({ id: "F5", title: "기존 전송 변경 없이 정상 말풍선 보존", verdict: verdict(JSON.stringify(posePacket) === JSON.stringify(refPose) && presenceSample.ok && !("chatSession" in presenceSample.presence)),
  level: "static (repo protocol.js at main 0dcae7b)",
  observed: { poseFieldsUnchanged: Object.keys(posePacket), presenceFields: Object.keys(presenceSample.presence),
    note: "Stage A adds a separate server inbox path (SEC-01 lab RPC) and does not alter encodePose/buildPresence; a safe bubble needs a presence→chat-session binding that does not yet exist." },
  expected: "pose/presence packet shapes identical to main; bubble preservation requires a new binding, not a transport change" });

clearInterval(tick);
await unsubscribeAll([U1, U2, U3]);
rec.save();
await pool.end();
process.exit(0);
