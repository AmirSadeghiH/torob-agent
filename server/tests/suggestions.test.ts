import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contextualSuggestions, hasRecordedContact, type ViewedProduct } from "../suggestions";

const product = (id: string, over: Partial<ViewedProduct> = {}): ViewedProduct => ({
  product_id: id,
  title: `کالا ${id}`,
  min_price: 1_000_000,
  offer_count: 3,
  freshness: "fresh",
  ...over,
});

const base = {
  intent: "search" as const,
  context: {},
  conditions: {},
};

describe("contextual next steps", () => {
  test("no suggestion is offered when there is nothing to act on", () => {
    const steps = contextualSuggestions({ ...base, products: [], contact: false });
    assert.equal(steps.length, 0);
  });

  test("every suggestion carries a runnable action and a request", () => {
    const steps = contextualSuggestions({
      ...base,
      products: [product("p1"), product("p2")],
      contact: true,
    });
    assert.ok(steps.length > 0);
    for (const step of steps) {
      assert.ok(step.label.trim().length > 0, "a suggestion needs a label");
      assert.equal(typeof (step.action as { request?: unknown }).request, "string");
      assert.ok((step.action as { request: string }).request.trim().length > 0);
    }
  });

  test("suggestions are capped and deduplicated by label", () => {
    const steps = contextualSuggestions({
      ...base,
      products: [product("p1"), product("p2")],
      contact: true,
      max: 4,
    });
    assert.ok(steps.length <= 4);
    const labels = steps.map((step) => step.label);
    assert.equal(new Set(labels).size, labels.length);
  });

  test("a budget condition adds a step that stays inside it", () => {
    const steps = contextualSuggestions({
      ...base,
      conditions: { budgetMax: 2_000_000 },
      products: [product("p1")],
    });
    const budget = steps.find((step) => step.label.includes("بازهٔ بودجه"));
    assert.ok(budget);
    const patch = (budget.action as { patch?: { max_price?: number } }).patch;
    assert.equal(patch?.max_price ?? null, 2_000_000);
  });

  test("a product view suggests stores and a prepared inquiry", () => {
    const steps = contextualSuggestions({
      ...base,
      kind: "product",
      products: [product("p1")],
      contact: true,
    });
    assert.ok(steps.some((step) => step.action.type === "stores"));
    assert.ok(steps.some((step) => step.action.type === "plan"));
  });

  test("a missing contact never offers an inquiry action", () => {
    const steps = contextualSuggestions({
      ...base,
      kind: "product",
      products: [product("p1")],
      contact: false,
    });
    assert.ok(!steps.some((step) => step.action.type === "inquiry"));
  });

  test("an inquiry with no recorded contact points at other shops", () => {
    const steps = contextualSuggestions({
      ...base,
      kind: "inquiry",
      contact: false,
      products: [product("p1")],
      inquiry: { status: "no_response", hasContact: false, product_id: "p1" },
    });
    assert.ok(steps.some((step) => step.action.type === "stores"));
  });

  test("a no-response inquiry asks for an alternative in the same category", () => {
    const steps = contextualSuggestions({
      ...base,
      kind: "product",
      products: [product("p1")],
      contact: true,
      inquiry: { status: "not_found", hasContact: true, product_id: "p1" },
    });
    assert.ok(steps.some((step) => step.action.type === "alternatives"));
  });

  test("hasRecordedContact only trusts recorded channels", () => {
    assert.equal(hasRecordedContact([]), false);
  });
});
