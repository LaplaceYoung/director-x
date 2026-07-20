import test from "node:test";
import assert from "node:assert/strict";
import { assertQuoteApprovedByBudget, listModelPricing, quoteModelCost, registerModelPricing, validateOfficialBudget } from "./pricing-catalog.mjs";

test("quotes image and video cost from dated official pricing evidence", () => {
  const image = quoteModelCost({
    providerId: "openai", modelId: "gpt-image-1.5", mediaType: "image",
    usage: { imageCount: 2, quality: "high", resolution: "1024x1536" }
  }, { now: "2026-07-20T00:00:00.000Z" });
  assert.equal(image.amount, .4);
  assert.equal(image.currency, "USD");
  assert.match(image.sourceUrl, /developers\.openai\.com/);

  const video = quoteModelCost({
    providerId: "runway", modelId: "gen4.5", mediaType: "video",
    usage: { durationSeconds: 8, resolution: "720p", generateAudio: false }
  }, { now: "2026-07-20T00:00:00.000Z" });
  assert.equal(video.amount, .96);
  assert.equal(video.formula, "8 per_second × USD 0.12 = USD 0.96");
});

test("fails closed when pricing is absent, stale, or does not cover the requested tier", () => {
  assert.throws(() => quoteModelCost({ providerId: "unknown", modelId: "x", mediaType: "video", usage: { durationSeconds: 5 } }), /No official pricing evidence/);
  assert.throws(() => quoteModelCost({
    providerId: "openai", modelId: "sora-2-pro", mediaType: "video",
    usage: { durationSeconds: 5, resolution: "4k" }
  }, { now: "2026-07-20T00:00:00.000Z" }), /does not cover/);
  assert.throws(() => quoteModelCost({
    providerId: "openai", modelId: "sora-2", mediaType: "video",
    usage: { durationSeconds: 5, resolution: "720p" }
  }, { now: "2026-10-20T00:00:00.000Z" }), /stale/);
});

test("registers refreshed pricing only from an official HTTPS domain", () => {
  const run = {};
  const evidence = registerModelPricing(run, {
    pricingId: "official:mosi:moss-tts:2026-07-20",
    providerId: "mosi.tts",
    modelId: "moss-tts",
    mediaType: "voice",
    currency: "CNY",
    sourceUrl: "https://platform.mosi.cn/docs/pricing",
    sourceTitle: "MOSI official pricing",
    verifiedAt: "2026-07-20",
    rates: [{ metric: "per_1k_characters", unitPrice: .8 }]
  });
  assert.equal(run.pricingEvidence[0].pricingId, evidence.pricingId);
  assert.throws(() => registerModelPricing({}, {
    ...evidence,
    pricingId: "bad",
    sourceUrl: "https://example.com/pricing"
  }), /official documentation domain/);
});

test("prefers the newest same-day custom pricing evidence", () => {
  const pricingEvidence = [
    {
      pricingId: "sf-old",
      providerId: "siliconflow",
      modelId: "Tongyi-MAI/Z-Image-Turbo",
      mediaType: "image",
      currency: "CNY",
      sourceUrl: "https://siliconflow.cn/pricing",
      sourceTitle: "SiliconFlow pricing",
      verifiedAt: "2026-07-20T00:25:00.000Z",
      maxAgeDays: 7,
      rates: [{ metric: "per_image", unitPrice: 0.1, conditions: { model: "Tongyi-MAI/Z-Image-Turbo" } }]
    },
    {
      pricingId: "sf-new",
      providerId: "siliconflow",
      modelId: "Tongyi-MAI/Z-Image-Turbo",
      mediaType: "image",
      currency: "CNY",
      sourceUrl: "https://siliconflow.cn/pricing",
      sourceTitle: "SiliconFlow pricing",
      verifiedAt: "2026-07-20T00:25:00.000Z",
      maxAgeDays: 7,
      rates: [{ metric: "per_image", unitPrice: 0.1, conditions: {} }]
    }
  ];
  const quote = quoteModelCost({
    providerId: "siliconflow", modelId: "Tongyi-MAI/Z-Image-Turbo", mediaType: "image",
    usage: { imageCount: 8, quality: "high", resolution: "1024x1024" }, pricingEvidence
  }, { now: "2026-07-20T08:00:00.000Z" });
  assert.equal(quote.pricingId, "sf-new");
  assert.equal(quote.amount, 0.8);
});

test("lists bundled pricing snapshots with source dates and URLs", () => {
  const entries = listModelPricing({ providerId: "google_gemini", mediaType: "music" });
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.verifiedAt && entry.sourceUrl.startsWith("https://")));
});

test("accepts only zero-external or current official-quote budget plans", () => {
  const quote = quoteModelCost({
    providerId: "runway", modelId: "gen4.5", mediaType: "video",
    usage: { durationSeconds: 5, resolution: "720p" }
  }, { now: "2026-07-20T00:00:00.000Z" });
  const budget = validateOfficialBudget({
    basis: "official_quotes",
    currency: "USD",
    cap: 2,
    routes: [{ providerId: "runway", modelId: "gen4.5", mediaType: "video", usage: { durationSeconds: 5, resolution: "720p" }, plannedCalls: 2, pricingQuote: quote }]
  });
  assert.equal(budget.quotedTotal, 1.2);
  assert.equal(assertQuoteApprovedByBudget(budget, quote).pricingQuote.quoteId, quote.quoteId);
  assert.equal(validateOfficialBudget({ basis: "zero_external_api", currency: "CNY", cap: 0, routes: [] }).quotedTotal, 0);
  assert.throws(() => validateOfficialBudget({ basis: "official_quotes", currency: "USD", cap: 1, routes: [{ providerId: "runway", modelId: "gen4.5", mediaType: "video", usage: { durationSeconds: 5 }, pricingQuote: { ...quote, amount: .01 } }] }), /exactly match/);
  assert.throws(() => assertQuoteApprovedByBudget(budget, quoteModelCost({
    providerId: "openai", modelId: "sora-2", mediaType: "video", usage: { durationSeconds: 5, resolution: "720p" }
  })), /not included/);
});
