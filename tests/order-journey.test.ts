import test from "node:test";
import assert from "node:assert/strict";
import { journeyState } from "../src/lib/order-journey";
test("only the current to next journey connector animates; delivered and stopped journeys do not", () => {
  assert.deepEqual(
    journeyState({ status: "PENDING", fulfillment: "UNASSIGNED" }),
    { current: 0, stopped: false, animateNext: true },
  );
  assert.deepEqual(
    journeyState({ status: "CONFIRMED", fulfillment: "UNASSIGNED" }),
    { current: 1, stopped: false, animateNext: true },
  );
  assert.deepEqual(
    journeyState({ status: "COMPLETED", fulfillment: "DELIVERED" }),
    { current: 5, stopped: false, animateNext: false },
  );
  for (const status of ["CANCELLED", "REFUND_PENDING", "REFUNDED"]) {
    assert.equal(
      journeyState({ status, fulfillment: "PREPARING" }).animateNext,
      false,
    );
  }
  assert.equal(
    journeyState({
      status: "PENDING",
      fulfillment: "UNASSIGNED",
      expired: true,
    }).animateNext,
    false,
  );
});
