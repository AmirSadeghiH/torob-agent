import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildInquiryMessage,
  inquiryContacts,
  inquiryNextStep,
  inquiryStatusLabel,
} from "../inquiry";

describe("seller inquiry", () => {
  test("an https website becomes a link", () => {
    const contacts = inquiryContacts({ website: "https://example.com", instagram: null });
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].kind, "website");
    assert.equal(contacts[0].href, "https://example.com/");
  });

  test("executable URL schemes are rejected", () => {
    assert.equal(inquiryContacts({ website: "javascript:alert(1)", instagram: null }).length, 0);
    assert.equal(inquiryContacts({ website: "data:text/html,<script>", instagram: null }).length, 0);
    assert.equal(inquiryContacts({ website: "vbscript:x", instagram: null }).length, 0);
  });

  test("a bare instagram handle is expanded to an https URL", () => {
    const contacts = inquiryContacts({ website: null, instagram: "@some_shop" });
    assert.equal(contacts[0]?.href, "https://instagram.com/some_shop");
  });

  test("an instagram handle that is not a handle is not linked", () => {
    assert.equal(inquiryContacts({ website: null, instagram: "not a handle!" }).length, 0);
    assert.equal(inquiryContacts({ website: null, instagram: "javascript:alert(1)" }).length, 0);
  });

  test("a phone number is never offered as a contact", () => {
    const contacts = inquiryContacts({ website: null, instagram: null });
    assert.equal(contacts.length, 0);
  });

  test("the draft names the recorded price and its age", () => {
    const message = buildInquiryMessage({
      productTitle: "هدفون",
      shopName: "فروشگاه الف",
      price: 5_000_000,
      changedAt: null,
    });
    assert.match(message, /قیمت ثبت‌شده در دیتاست/);
    assert.match(message, /فروشگاه الف/);
    assert.match(message, /تاریخ ثبت نامشخص/);
  });

  test("the draft never claims live stock", () => {
    const message = buildInquiryMessage({
      productTitle: "هدفون",
      shopName: "فروشگاه الف",
      price: 1_000_000,
      changedAt: "2026-10-01T00:00:00Z",
    });
    assert.doesNotMatch(message, /موجود است و/);
    assert.match(message, /این قیمت ثبت‌شده است و موجودی فعلی را تأیید نمی‌کند/);
  });

  test("follow-up statuses are labelled as the user's report", () => {
    assert.match(inquiryStatusLabel("stock_confirmed"), /گزارش کاربر/);
    assert.match(inquiryStatusLabel("price_reported"), /گزارش کاربر/);
    assert.doesNotMatch(inquiryStatusLabel("no_response"), /تأیید/);
  });

  test("the next step for a non-response looks for a shop that answers", () => {
    assert.match(inquiryNextStep("no_response", true), /فروشنده‌ی دیگر/);
    assert.match(inquiryNextStep("ready", true), /کپی/);
    assert.match(inquiryNextStep("stock_confirmed", true), /تأیید/);
  });

  test("without a recorded channel the next step looks for another shop", () => {
    assert.match(inquiryNextStep("no_response", false), /فروشنده‌ی دیگر/);
  });
});
