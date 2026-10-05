// 학생회관 앞: the walkable outdoor point in front of the Student Center's pond-side terrace.
// Derived from the runtime terrace geometry (STUDENT_TERRACES on the runtime campus facility footprint), the same
// geometry the steps are rendered and walked on. Shared by the NPC destination `poi.student-center`
// and the Student Center shop world entry, so both always stand on the same spot.
import { STUDENT_TERRACES } from "./roadview-layout.js";

export const STUDENT_CENTER_FRONT_TERRACE_ID = "student_terrace_2";

export function studentCenterFrontPoint(terraces = STUDENT_TERRACES) {
  const terrace = terraces.find((item) => item.id === STUDENT_CENTER_FRONT_TERRACE_ID);
  if (!terrace) throw new Error("Student Center front terrace unavailable");
  // Half a unit along the terrace edge, three units past the landing: clear of the steps' foot.
  const point = terrace.frame.at(0.5, terrace.landing + 3);
  return Object.freeze({ x: point.x, z: point.z });
}
