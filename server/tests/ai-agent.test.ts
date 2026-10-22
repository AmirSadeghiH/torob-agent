import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { FakeToolCallingModel } from "langchain";
import { RunnableLambda } from "@langchain/core/runnables";
import {
  DEFAULT_MODEL,
  agentConfigured,
  createChatModel,
  getAgentConfig,
  normalizeHistory,
} from "../ai-config";
import type { Origin } from "../../shared/types";

const dbFile = process.env.HAMKHARID_DB
  ? path.resolve(process.env.HAMKHARID_DB)
  : path.resolve(process.cwd(), "data", "hamkharid.db");
const hasDb = existsSync(dbFile) && statSync(dbFile).size > 0;
const skipDb = hasDb ? false : "data/hamkharid.db is not imported (run npm run data:import)";

const ORIGIN: Origin = { lat: 35.7005, lon: 51.4195, label: "فردوسی", neighborhood: "فردوسی" };

function testConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    apiKey: "test-key",
    baseURL: null,
    model: DEFAULT_MODEL,
    fallback: true,
    maxSteps: 4,
    ...overrides,
  };
}

function toolCall(name: string, args: Record<string, unknown>) {
  return { name, args, id: `call_${name}_${Math.random().toString(16).slice(2, 8)}` };
}

/** Runs a scripted model: tool call on the first step, plain answer afterwards. */
function scriptedModel(name: string, args: Record<string, unknown>) {
  return new FakeToolCallingModel({ toolCalls: [[toolCall(name, args)], []] });
}

async function agentModule() {
  return import("../ai-agent");
}

async function repoModule() {
  return import("../repo");
}

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function firstProductWithOffers(): Promise<string> {
  const { searchProducts, getProduct } = await repoModule();
  const result = searchProducts({ q: "هدفون", page_size: 4 }, ORIGIN);
  const candidate = result.items.find((item) => item.offer_count > 0) ?? result.items[0];
  assert.ok(candidate, "expected at least one headphone product in the dataset");
  assert.ok(getProduct(candidate.product_id, ORIGIN)?.offers.length, "expected a recorded offer");
  return candidate.product_id;
}

/* ------------------------------------------------------- configuration */

test("the configured model is gpt-5.6-sol and the agent is opt-in", async () => {
  await withEnv(
    { AI_AGENT_ENABLED: undefined, OPENAI_MODEL: undefined, OPENAI_BASE_URL: undefined },
    async () => {
      const config = getAgentConfig();
      assert.equal(config.model, "gpt-5.6-sol");
      assert.equal(config.enabled, false);
      assert.equal(config.maxSteps, 4);
      assert.equal(config.fallback, true);

      const model = createChatModel({ ...config, apiKey: "test-key" });
      assert.equal(model.model, "gpt-5.6-sol");
      assert.equal(model.useResponsesApi, true);
    },
  );

  await withEnv({ OPENAI_MODEL: "gpt-5.6-sol-preview", AI_AGENT_MAX_STEPS: "99" }, async () => {
    const config = getAgentConfig();
    assert.equal(config.model, "gpt-5.6-sol-preview");
    assert.equal(config.maxSteps, 8, "max steps must be clamped");
  });
});

test("history is bounded and validated", () => {
  const turns = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    text: `${index}:${"x".repeat(600)}`,
  }));
  const normalized = normalizeHistory([{ role: "system", text: "drop" }, ...turns, { role: "user" }]);
  assert.equal(normalized.length, 6);
  assert.equal(normalized.at(-1)?.text.length ?? 0, 320);
  assert.deepEqual(normalizeHistory("nope"), []);
});

/* ------------------------------------------------------------ the agent */

test("the model chooses a tool and reads its real database result", { skip: skipDb }, async () => {
  const { runShoppingAgent } = await agentModule();
  const { searchProducts } = await repoModule();

  const run = await runShoppingAgent(
    { message: "هدفون بی‌سیم زیر ۵ میلیون", origin: ORIGIN },
    { model: scriptedModel("search_products", { query: "هدفون", max_price: 5_000_000, limit: 3 }), config: testConfig() },
  );

  assert.deepEqual(run.toolCalls, ["search_products"]);
  const products = run.blocks.find((block) => block.type === "products");
  assert.ok(products && products.type === "products");
  const expected = searchProducts({ q: "هدفون", max_price: 5_000_000, page_size: 3 }, ORIGIN);
  assert.ok(expected.items.length > 0);
  assert.deepEqual(
    products.products.map((item) => item.product_id),
    expected.items.map((item) => item.product_id),
    "UI rows must be the rows the repository returned",
  );
  assert.ok(products.products.every((item) => (item.min_price ?? 0) <= 5_000_000));
  // The scripted model echoes its message list, so the tool payload was in context
  // before the final answer was written.
  assert.ok(run.reply.includes(expected.items[0]!.product_id));
  assert.equal(run.intent, "search");
});

test("tool arguments are validated before touching the database", { skip: skipDb }, async () => {
  const { searchProductsTool, getProductDetailsTool } = await agentModule();

  await assert.rejects(() => searchProductsTool.invoke({ max_price: -5 }), "negative budget must fail");
  await assert.rejects(
    () => getProductDetailsTool.invoke({ product_id: "product_not_in_dataset" }),
    /دیتاست/,
  );
});

test("a product store search returns only shops with an offer for that product", { skip: skipDb }, async () => {
  const { findStoresForProductTool } = await agentModule();
  const { getProduct } = await repoModule();
  const productId = await firstProductWithOffers();
  const product = getProduct(productId, ORIGIN);
  assert.ok(product);

  const raw = await findStoresForProductTool.invoke({ product_id: productId, radius_m: 20_000, limit: 4 });
  const payload = JSON.parse(String(raw)) as {
    evidence: string;
    stores: { shop_id: string; distance_m: number | null }[];
  };
  assert.equal(payload.evidence, "product_offers");
  const shopsWithOffer = new Set(product.offers.map((offer) => offer.shop.shop_id));
  assert.ok(payload.stores.length > 0);
  for (const store of payload.stores) {
    assert.ok(shopsWithOffer.has(store.shop_id), `${store.shop_id} has no offer for ${productId}`);
  }
});

test("comparison and plans reject ids that are not in the dataset", { skip: skipDb }, async () => {
  const { compareProductsTool, buildShoppingPlanTool } = await agentModule();
  const { searchProducts, getProduct } = await repoModule();

  await assert.rejects(
    () => compareProductsTool.invoke({ product_ids: ["product_ghost_a", "product_ghost_b"] }),
    /پیدا نشد|دیتاست/,
  );
  await assert.rejects(
    () => buildShoppingPlanTool.invoke({ offer_ids: ["offer_ghost_1"] }),
    /دیتاست/,
  );

  const products = searchProducts({ q: "هدفون", page_size: 3 }, ORIGIN).items;
  assert.ok(products.length >= 2);
  const compared = JSON.parse(
    String(await compareProductsTool.invoke({ product_ids: [products[0]!.product_id, products[1]!.product_id] })),
  ) as { products: { product_id: string }[] };
  assert.equal(compared.products.length, 2);

  const detail = getProduct(products[0]!.product_id, ORIGIN);
  assert.ok(detail?.offers[0]);
  const plan = JSON.parse(
    String(await buildShoppingPlanTool.invoke({ offer_ids: [detail.offers[0].offer_id] })),
  ) as { stops: { items: { offer_id: string; price: number }[] }[]; total: number };
  const planned = plan.stops.flatMap((stop) => stop.items);
  assert.deepEqual(
    planned.map((item) => item.offer_id),
    [detail.offers[0].offer_id],
  );
  assert.ok(plan.total > 0);
});

test("UI blocks keep database values even when the model writes the prose", { skip: skipDb }, async () => {
  const { runShoppingAgent } = await agentModule();
  const { getProduct } = await repoModule();
  const productId = await firstProductWithOffers();
  const detail = getProduct(productId, ORIGIN);
  assert.ok(detail);

  const run = await runShoppingAgent(
    { message: "قیمت همین هدفون چنده؟", origin: ORIGIN },
    { model: scriptedModel("get_product_details", { product_id: productId }), config: testConfig() },
  );

  const offers = run.blocks.find((block) => block.type === "offers");
  assert.ok(offers && offers.type === "offers");
  assert.equal(offers.product_id, productId);
  assert.deepEqual(
    offers.offers.map((offer) => [offer.offer_id, offer.price]),
    detail.offers.slice(0, 6).map((offer) => [offer.offer_id, offer.price]),
  );
  assert.ok(offers.offers.every((offer) => offer.shop.shop_id.startsWith("shop_")));
  assert.equal(run.toolCalls[0], "get_product_details");
});

test("history keeps follow-ups attached to the previous turn", { skip: skipDb }, async () => {
  const { runShoppingAgent } = await agentModule();
  const run = await runShoppingAgent(
    {
      message: "همین رو ارزون‌تر پیدا کن",
      origin: ORIGIN,
      history: [
        { role: "user", text: "هدفون سونی زیر ۵ میلیون" },
        { role: "assistant", text: "سه گزینه پیدا شد." },
      ],
    },
    { model: new FakeToolCallingModel({ toolCalls: [[]] }), config: testConfig() },
  );
  assert.ok(run.reply.includes("هدفون سونی زیر ۵ میلیون"), "previous user turn must reach the model");
  assert.ok(run.reply.includes("سه گزینه پیدا شد"));
});

test("concurrent turns never share collected blocks", { skip: skipDb }, async () => {
  const { runShoppingAgent } = await agentModule();

  const [headphones, phones] = await Promise.all([
    runShoppingAgent(
      { message: "هدفون", origin: ORIGIN },
      { model: scriptedModel("search_products", { category: "هدفون", limit: 2 }), config: testConfig() },
    ),
    runShoppingAgent(
      { message: "گوشی", origin: ORIGIN },
      { model: scriptedModel("search_products", { category: "گوشی موبایل", limit: 2 }), config: testConfig() },
    ),
  ]);

  const headphoneBlock = headphones.blocks.find((block) => block.type === "products");
  const phoneBlock = phones.blocks.find((block) => block.type === "products");
  assert.ok(headphoneBlock && headphoneBlock.type === "products");
  assert.ok(phoneBlock && phoneBlock.type === "products");
  const headphoneCategories = new Set(headphoneBlock.products.map((item) => item.category));
  const phoneCategories = new Set(phoneBlock.products.map((item) => item.category));
  assert.equal(headphoneCategories.size, 1, "one category filter must produce one category");
  assert.equal(phoneCategories.size, 1);
  assert.equal(
    [...headphoneCategories].some((category) => phoneCategories.has(category)),
    false,
    "each concurrent turn must keep its own category",
  );
  assert.equal(
    headphoneBlock.products.some((item) =>
      phoneBlock.products.some((other) => other.product_id === item.product_id),
    ),
    false,
  );
});

/* ------------------------------------------------------ orchestration */

test("rules answer when the agent is disabled", { skip: skipDb }, async () => {
  const { respond } = await import("../assistant");
  const response = await withEnv(
    { AI_AGENT_ENABLED: "false", AI_AGENT_FALLBACK_TO_RULES: "true" },
    () => respond({ message: "هدفون زیر ۵ میلیون", context: { origin: ORIGIN } }),
  );
  assert.equal(response.meta.engine, "rules");
  assert.ok(response.reply.length > 0);
  assert.ok(response.blocks.length > 0);
  assert.equal(response.meta.model ?? null, null);
});

test("a model failure falls back to rules and says so", { skip: skipDb }, async () => {
  const { respond } = await import("../assistant");
  const failing = new RunnableLambda({
    func: async () => {
      const error = new Error("connect ETIMEDOUT api.openai.com");
      (error as Error & { status?: number }).status = 504;
      throw error;
    },
  });

  const response = await withEnv(
    { AI_AGENT_ENABLED: "true", OPENAI_API_KEY: "test-key", AI_AGENT_FALLBACK_TO_RULES: "true" },
    () =>
      respond(
        { message: "هدفون زیر ۵ میلیون", context: { origin: ORIGIN } },
        { model: failing as never, config: testConfig() },
      ),
  );
  assert.equal(response.meta.engine, "rules_fallback");
  assert.ok(response.reply.length > 0);
  assert.ok(response.blocks.some((block) => block.type === "products"));

  await withEnv(
    { AI_AGENT_ENABLED: "true", OPENAI_API_KEY: "test-key", AI_AGENT_FALLBACK_TO_RULES: "false" },
    async () => {
      await assert.rejects(() =>
        respond(
          { message: "هدفون زیر ۵ میلیون", context: { origin: ORIGIN } },
          { model: failing as never, config: testConfig({ fallback: false }) },
        ),
      );
    },
  );
});

test("a missing key keeps the deterministic assistant available", { skip: skipDb }, async () => {
  const { respond } = await import("../assistant");
  const response = await withEnv(
    { AI_AGENT_ENABLED: "true", OPENAI_API_KEY: undefined, LLM_API_KEY: undefined },
    () => respond({ message: "هدفون زیر ۵ میلیون", context: { origin: ORIGIN } }),
  );
  assert.equal(response.meta.engine, "rules_fallback");
  assert.ok(response.blocks.some((block) => block.type === "products"));
});

/* ------------------------------------------------------ live integration */

const liveConfig = getAgentConfig();
const liveSkip =
  process.env.AI_AGENT_LIVE_TEST !== "1"
    ? "set AI_AGENT_LIVE_TEST=1 with real credentials"
    : !agentConfigured(liveConfig)
      ? "AI_AGENT_ENABLED=true and a valid OPENAI_API_KEY are required"
      : false;

test("live: the configured model requested a real tool", { skip: liveSkip }, async () => {
  const { runShoppingAgent } = await agentModule();
  const run = await runShoppingAgent(
    { message: "هدفون بی‌سیم زیر ۵ میلیون", origin: ORIGIN },
    { config: liveConfig },
  );
  assert.ok(run.toolCalls.length > 0, "the model made no tool call");
  assert.ok(run.blocks.length > 0, "no UI blocks were produced from tool results");
  assert.ok(run.reply.trim().length > 0);
  assert.equal(run.model, liveConfig.model);
});
