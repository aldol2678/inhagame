import test from "node:test";
import assert from "node:assert/strict";
import {renderStaffName, staffBadgeForUser} from "../src/staff-badges.js";
test("public package never infers staff authority from a configured account ID",()=>{
 for(const value of [null,undefined,"sample-player","00000000-0000-4000-8000-000000000001"]) assert.equal(staffBadgeForUser(value),null);
 const el={textContent:"",appendChild(){throw Error("unexpected badge");}};
 assert.equal(renderStaffName(el,"Sample player","00000000-0000-4000-8000-000000000001",{createElement(){throw Error("unexpected badge");}}),null);
 assert.equal(el.textContent,"Sample player");
});
