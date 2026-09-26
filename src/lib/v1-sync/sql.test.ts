import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deletedPredicate,
  displacedPredicate,
  enumKeepPredicates,
  heldFromEnumsSql,
  heldFromParentSql,
  keyOf,
  ledgerPrunePredicate,
  stageWhere,
  unknownEnumValuesSql,
  type EnumColumn,
} from "./sql";

const reservationType: EnumColumn = {
  table: "reservations",
  column: "reservationType",
  type: "ReservationType",
  isArray: false,
  labels: ["RENTAL", "SALE", "RENT_TO_OWN"],
};
const tags: EnumColumn = { table: "t", column: "tags", type: "Tag", isArray: true, labels: ["A", "O'B"] };

test("keyOf: a single key is cast to text; a composite key is joined by ':'", () => {
  assert.equal(keyOf(["id"], "p"), `p."id"::text`);
  assert.equal(keyOf(["A", "B"], "c"), `concat_ws(':', c."A"::text, c."B"::text)`);
});

test("enum filter keeps null and known values, and compares here rather than in v1", () => {
  const [keep] = enumKeepPredicates([reservationType]);
  assert.equal(
    keep,
    `(r."reservationType" is null or (select r."reservationType") = any(array['RENTAL', 'SALE', 'RENT_TO_OWN']::text[]))`,
  );
  // An array column must be wholly contained in v2's labels; quotes are escaped.
  assert.equal(
    enumKeepPredicates([tags])[0],
    `(r."tags" is null or (select r."tags") <@ array['A', 'O''B']::text[])`,
  );
});

test("unknown values are found with the comparison kept local", () => {
  const sql = unknownEnumValuesSql("reservations", reservationType);
  assert.match(sql, /not \(\(select r\."reservationType"\) = any\(/);
  assert.match(sql, /from v1_remote\."reservations" r/);
});

test("held rows are the ones failing the enum filter, or none when the table has no enum", () => {
  const keep = enumKeepPredicates([reservationType]);
  assert.match(heldFromEnumsSql("reservations", ["id"], keep), /where not \(\(r\."reservationType" is null or/);
  assert.match(heldFromEnumsSql("clients", ["id"], []), /where false$/);
});

test("the stage excludes held rows as well as unknown enum values", () => {
  const where = stageWhere({ ruleWhere: "r.x = 1", keep: ["K"], table: "reservations", pk: ["id"] });
  assert.equal(
    where,
    `where r.x = 1 and K and not exists (select 1 from "h_reservations" h where h.key = r."id"::text)`,
  );
});

test("a skipped (held) row is never counted or deleted as v1-deleted", () => {
  const pred = deletedPredicate({ table: "reservations", stage: `"s_reservations"`, join: `p."id" = s."id"`, pk: ["id"] });
  assert.match(pred, /not exists \(select 1 from "s_reservations" s where p\."id" = s\."id"\)/);
  assert.match(pred, /o\.tbl = 'reservations' and o\.key = p\."id"::text/);
  assert.match(pred, /and not exists \(select 1 from "h_reservations" h where h\.key = p\."id"::text\)/);
});

test("a held row cannot be displaced by a staged row reusing its unique value", () => {
  const pred = displacedPredicate({
    table: "reservations",
    stage: `"s_reservations"`,
    join: `p."id" = s."id"`,
    pk: ["id"],
    uniqueCols: ["reservationNumber"],
  });
  // Matches some staged row on the unique value, under a different key.
  assert.match(
    pred,
    /exists \(select 1 from "s_reservations" s where p\."reservationNumber" = s\."reservationNumber" and not \(p\."id" = s\."id"\)\)/,
  );
  // p's own key was not itself restaged (an ordinary update, not a displacement).
  assert.match(pred, /not exists \(select 1 from "s_reservations" s2 where s2\."id" = p\."id"\)/);
  // A held row is excluded, since v1 still has it under this same skipped key.
  assert.match(pred, /and not exists \(select 1 from "h_reservations" h where h\.key = p\."id"::text\)/);
});

test("displacedPredicate supports a composite unique constraint", () => {
  const pred = displacedPredicate({
    table: "t",
    stage: `"s_t"`,
    join: `p."A" = s."A" and p."B" = s."B"`,
    pk: ["A", "B"],
    uniqueCols: ["code"],
  });
  assert.match(pred, /p\."code" = s\."code" and not \(p\."A" = s\."A" and p\."B" = s\."B"\)/);
  assert.match(pred, /s2\."A" = p\."A" and s2\."B" = p\."B"/);
});

test("a held key stays in the origin ledger", () => {
  const pred = ledgerPrunePredicate({ table: "reservations", stage: `"s_reservations"`, pk: ["id"] });
  assert.match(pred, /^o\.tbl = 'reservations'/);
  assert.match(pred, /not exists \(select 1 from "s_reservations" s where s\."id"::text = o\.key\)/);
  assert.match(pred, /not exists \(select 1 from "h_reservations" h where h\.key = o\.key\)/);
});

test("a child pointing at a held parent by its primary key is held too", () => {
  const sql = heldFromParentSql({
    child: "reservation_items",
    parent: "reservations",
    childCols: ["reservationId"],
    parentCols: ["id"],
    childPk: ["id"],
    parentPk: ["id"],
  });
  assert.match(sql, /insert into "h_reservation_items" \(key\)/);
  assert.match(sql, /select c\."id"::text from v1_remote\."reservation_items" c/);
  assert.match(sql, /c\."reservationId" is not null/);
  assert.match(sql, /exists \(select 1 from "h_reservations" h where h\.key = c\."reservationId"::text\)/);
  assert.match(sql, /on conflict do nothing$/);
});

test("a foreign key to a non-key column looks the parent up in v1 to find its held key", () => {
  const sql = heldFromParentSql({
    child: "c_t",
    parent: "p_t",
    childCols: ["code"],
    parentCols: ["code"],
    childPk: ["id"],
    parentPk: ["id"],
  });
  assert.match(sql, /from v1_remote\."p_t" p join "h_p_t" h on h\.key = p\."id"::text/);
  assert.match(sql, /where p\."code" = c\."code"/);
});
