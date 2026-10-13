// JSL-B · Jeongseok interior evidence manifest (engine-free).
//
// Every space, module and anchor of the 1F/B1 blockout names one sourceClass and the evidence ids
// it relies on. The blockout is a GAME layout: observed finishes and props are reproduced with our
// own boxes and colours, but no photographed position relation is restored, so nothing here is a
// reality reproduction. Photos, school logos, book covers, exhibition images and real ID/QR codes
// are never copied into game assets.
//
// Sources: JSL-R0 F02/F03 integration (Notion 3f727155213b8133b4c9f4457810a064, Drive
// 1ONepPdtvRoAhmcmX-YyFI7dQ1_eU-8NYYHTyNlkgGog) and the JSL-B spec (Notion
// 3f727155213b8129a27cfe56f2dd3e6b, Drive 1Jrk0A4bBYfPgLzl12tzQ6Niktkt0os6cqkwTEgZGeTw), 2026-10-12.

export const SOURCE_CLASS = Object.freeze({
  OBSERVED_MUSE: "OBSERVED_MUSE",
  OBSERVED_WORK: "OBSERVED_WORK",
  HISTORICAL: "HISTORICAL",
  INFERRED: "INFERRED",
  GAME_ADAPTATION: "GAME_ADAPTATION"
});
export const SOURCE_CLASSES = Object.freeze(Object.values(SOURCE_CLASS));

export const JEONGSEOK_INTERIOR_CLAIM = Object.freeze({
  realityReproduction: false,
  fidelity: "LIMITED_BLOCKOUT",
  heldUnknowns: Object.freeze([
    "2026 gate count, position and model",
    "real 1F <-> B1 stairs / elevator core",
    "Second Reading Room full plan and removed wall position",
    "physical relation of the graduate-only 54 reservation seats",
    "Creative Space study <-> lecture zone connection and outside doors",
    "positions of all eight group study rooms",
    "window orientation of B1 spaces"
  ])
});

const ev = (id, fields) => Object.freeze({ id, ...fields });

export const JEONGSEOK_EVIDENCE = Object.freeze({
  "JSL-R0-F03-READING-2026": ev("JSL-R0-F03-READING-2026", {
    kind: "news-article+photo",
    date: "2026-08-30",
    url: "https://www.inhapress.com/news/articleView.html?idxno=21588",
    photoUrl: "https://cdn.inhapress.com/news/photo/202608/21588_11413_4343.jpg",
    observedBy: Object.freeze(["MUSE_F03", "WORK"]),
    facts: Object.freeze([
      "former 2-1 and 2-2 rooms merged over the summer break, wall removed",
      "article seat count 474 (open 320, partitioned 126, standing 20, carrel 6, accessible 2)",
      "entrance sign, wood-panel square columns, bright ceiling panels, white partitions"
    ]),
    limits: "seat counts are article figures, not a game seat requirement; removed wall position UNKNOWN"
  }),
  "JSL-R0-SEAT-SERVICE-20261012": ev("JSL-R0-SEAT-SERVICE-20261012", {
    kind: "reservation-service-listing",
    date: "2026-10-12",
    facts: Object.freeze(["Reading Room 2: 400", "Reading Room 2 (graduate only): 54"]),
    limits: "service categories, not walls; 474-20=454 is an INFERRED arithmetic hypothesis; CONFLICT with the August article"
  }),
  "JSL-R0-F03-CREATIVE-2024": ev("JSL-R0-F03-CREATIVE-2024", {
    kind: "official-introduction",
    date: "2024-11",
    url: "https://m.blog.naver.com/inhanuri/223676696310",
    observedBy: Object.freeze(["MUSE_F03", "WORK"]),
    facts: Object.freeze([
      "former Reading Room 3 converted to Creative Space (2024-11)",
      "study zone: floor-to-ceiling wood-slat round structural columns, dark grid ceiling, downlights, long tables, sofas, large windows, wood walls",
      "lecture zone: navy walls, large screen, stepped wooden seating, ring pendant / cylinder light fittings, carpet",
      "ceiling cylinder light fittings are NOT the structural columns",
      "glass group study room plates 3 and 4 visible"
    ]),
    limits: "zone connection order, eight-room layout and outside doors UNKNOWN"
  }),
  "JSL-R0-CREATIVE-FACILITY-GUIDE": ev("JSL-R0-CREATIVE-FACILITY-GUIDE", {
    kind: "official-facility-guide",
    facts: Object.freeze(["eight group study rooms", "small lecture hall"]),
    limits: "room positions not given"
  }),
  "JSL-R0-F03-LOBBY-2015": ev("JSL-R0-F03-LOBBY-2015", {
    kind: "historical-photo",
    date: "2015-07-29",
    url: "https://t1.daumcdn.net/cfile/tistory/251C6B4555B91CB812",
    observedBy: Object.freeze(["MUSE_F03", "WORK"]),
    facts: Object.freeze([
      "row of metal entry gates with overhead signage",
      "adjacent information furniture / counter",
      "indoor planting, polished stone tile floor, curtain wall, stair railing"
    ]),
    limits: "2026 gate count/position UNKNOWN; railing is not evidence of a B1 route"
  }),
  "JSL-R0-LOBBY-2013-2017": ev("JSL-R0-LOBBY-2013-2017", {
    kind: "historical-photo+official-use-description",
    facts: Object.freeze(["open central lobby frame", "light grey columns", "tall gridded glazing"]),
    limits: "finish and frame reference only (URLs kept in the Work report)"
  }),
  "JSL-EXTERIOR-BLDG-JUNGSEOK": ev("JSL-EXTERIOR-BLDG-JUNGSEOK", {
    kind: "repository-geometry",
    facts: Object.freeze([
      "bldg_jungseok exterior (jeongseok-candidate-renderer.js, interior NOT_INFERRED)",
      "LIBRARY_FRONT edge 6-7 and library_entry_canopy (basic-campus.js)",
      "LIBRARY_ENTRY_HEIGHT 1.65 is a game walk height, not a surveyed floor height"
    ])
  }),
  "GA-JSL-B": ev("GA-JSL-B", {
    kind: "game-adaptation",
    facts: Object.freeze(["arrangement, dimensions, portals and anchors chosen for play and replaceable"])
  })
});

export const isSourceClass = value => SOURCE_CLASSES.includes(value);
export const isEvidenceId = id => typeof id === "string" && Object.hasOwn(JEONGSEOK_EVIDENCE, id);

/** Tag a layout element with its provenance. Throws on unknown classes or evidence ids. */
export function traced(sourceClass, evidence, note = null) {
  if (!isSourceClass(sourceClass)) throw new RangeError(`Unknown sourceClass ${sourceClass}`);
  const ids = Object.freeze([...evidence]);
  for (const id of ids) if (!isEvidenceId(id)) throw new RangeError(`Unknown evidence id ${id}`);
  if (!ids.length) throw new RangeError("Every traced element needs at least one evidence id");
  return Object.freeze({ sourceClass, evidence: ids, ...(note ? { note } : {}) });
}

export const GAME_ADAPTATION = (note = null) => traced(SOURCE_CLASS.GAME_ADAPTATION, ["GA-JSL-B"], note);
