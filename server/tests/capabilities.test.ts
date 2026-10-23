import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shopCapabilities } from "../capabilities";

const base = {
  payments: [] as string[],
  fast_delivery: false,
  has_hours: false,
  identity: "registered" as const,
};

const byKey = (caps: ReturnType<typeof shopCapabilities>, key: string) =>
  caps.find((cap) => cap.key === key);

describe("store capabilities", () => {
  test("a recorded fast-delivery flag is reported as recorded", () => {
    const fast = byKey(shopCapabilities({ ...base, fast_delivery: true }), "fast_delivery");
    assert.equal(fast?.status, "recorded");
    assert.equal(fast?.source, "dataset");
  });

  test("an absent payment list never becomes an installment badge", () => {
    const installment = byKey(shopCapabilities(base), "installment");
    assert.equal(installment?.status, "unregistered");
    assert.notEqual(installment?.status, "unsupported");
    assert.notEqual(installment?.status, "recorded");
  });

  test("an explicit installment provider is named in the detail", () => {
    const installment = byKey(shopCapabilities({ ...base, payments: ["atin"] }), "installment");
    assert.equal(installment?.status, "recorded");
    assert.match(installment?.detail ?? "", /atin/i);
  });

  test("tebpi is never inferred from anything else", () => {
    const tebpi = byKey(shopCapabilities({ ...base, payments: ["zarinpal"] }), "tebpi");
    assert.equal(tebpi?.status, "unregistered");
    assert.notEqual(tebpi?.status, "unsupported");
  });

  test("hours follow the recorded flag, not the store's fame", () => {
    assert.equal(byKey(shopCapabilities({ ...base, has_hours: true }), "hours")?.status, "recorded");
    assert.equal(byKey(shopCapabilities({ ...base, has_hours: false }), "hours")?.status, "unregistered");
  });

  test("every capability carries a provenance and a Persian detail", () => {
    for (const cap of shopCapabilities({ ...base, fast_delivery: true, payments: ["zarinpal"] })) {
      assert.ok((cap.detail ?? "").length > 0, `${cap.key} has no detail`);
      assert.ok(
        ["dataset", "seller_reported", "user_reported", "verified_integration", "unknown"].includes(
          cap.source,
        ),
        `${cap.key} has no provenance`,
      );
    }
  });
});
