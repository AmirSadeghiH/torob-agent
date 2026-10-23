# ترب‌یار — گزارش تحویل فاز F (Generative Action Shopping Agent)

تاریخ: ۲۳ اکتبر ۲۶
شاخه: `arena/598f57cc-torob-agent` (جدا از `main`؛ تغییرات کوچک، قابل بررسی و بازگشت‌پذیر)
دیپلوی: هیچ تغییری در deployment فعلی صورت نگرفت؛ تولید production انجام نشد.

---

## ۱. نتیجه‌ی نهایی

| دستور | وضعیت | خروجی |
| --- | --- | --- |
| `npm test` | ✅ | **۹۴ تست / ۷۰ رد / ۰ نادرست / ۲۴ رد‌شده** — بدون هیچ فایل دیتابیس |
| `npm run typecheck` | ✅ | `tsc --noEmit` بدون خطا |
| `npm run build` | ✅ | `dist/` ساخته شد (۱۶۲۹ ماژول، ۱۵.۹ ثانیه) |
| Boot بدون دیتابیس | ✅ | سرور روی `0.0.0.0:8787` بالا آمد، پیام صادقانه زد، کرش نکرد |
| UI + API پشت پروکسی | ✅ | `/` → ۲۰₀، `/api/health` و `/api/meta` → ۲۰₀، `/api/assistant` → پاسخ صادقانه |

**پذیرش محوری برآورده شد:** `npm test` در فضایی که فاقد دیتابیس است کاملاً تمیز می‌گذرد، و سرور بدون فایل دیتابیس کرنش نمی‌کند.

### چرا ۲۴ تست رد شدند؟
۲۴ تست پنهانِ دیتابیس‌دار (۱۲ در `ai-agent.test.ts`، ۶ در `routing.test.ts`، ۶ در `mapir.test.ts`) با پیام truthful `data/hamkharid.db is not imported (run npm run data:import)` رد شدند. این تست‌ها فقط در فضایی اجرا می‌شوند که فایل دیتاست وجود داشته باشد و در غیر این صورت `skip` می‌شوند — نه `fail`.

---

## ۲. دستاوردهای واقعی

### فاز B — کنترل‌های خرید از talk-bot به agent
- پیشنهادهای بعدی همگام با نتیجه‌ی واقعی ابزارها به‌جای لیست ثابت: `server/suggestions.ts` → `contextualSuggestions()`.
- هر پیشنهاد خودش **عملی قابل اجرا** (`NextStep.action`) و متن درخواست فارسی (`request`) حمل می‌کند؛ پیشنهادی نمایش داده نمی‌شود که UI نتواند آن را اجرا کند.
- client (`src/pages/ChatPage.tsx`) عمل‌ها را اجرا می‌کند: `plan` → `/plan`، `stores` → `/stores`، بقیه → ارسال درخواست natural-language.
- patchهای جدید `min_price`، `radius_m`، `min_offers`، `max_age_days` در فیلترهای اعمال‌شده و کاوش.

### فاز C — پوشش دیتاست و capabilities فروشگاه
- `server/capabilities.ts` → `shopCapabilities()`: ۷ capability (ترب‌پی، خرید قسطی، صورتحساب، تحویل سریع، درگاه پرداخت، ساعت کاری، راه تماس)، هر کدام با **وضعیت + منشأ** مستقل.
- وضعیت‌ها: `recorded` (ثبت‌شده در دیتاست) / `unregistered` (ندارد) / `unsupported` (به‌دقت ثبت `false`) / `unknown` (نامشخص). از نام فروشگاه، دسته یا شبکه‌های اجتماعی **هیچ استنتاجی** نمی‌شود.
- `components/CapabilityBadges.tsx` + `components/StoreCardView.tsx`: badgeها با وضعیت خودشان نمایش داده می‌شوند؛ `unregistered` هرگز به‌صورت badge مثبت渲染 نمی‌شود.

### فاز D — inquiry و پیگیری
- `server/inquiry.ts`: `safeHref`، `inquiryContacts`، `buildInquiryMessage`، `inquiryStatusLabel`، `inquiryNextStep`.
- ابزار جدید `prepare_seller_inquiry` در `server/ai-agent.ts` (تعداد ابزارها ۸).
- blockهای `seller_inquiry` و `seller_followup` در `shared/types.ts` و `components/SellerInquiryView.tsx`.
- **ترب‌یار خودکار پیام نمی‌فرستد**: فقط کانال‌های ثبت‌شده (وب‌سایت / اینستاگرام)، پیش‌نویس پیام و دکمه‌ی کپی. شماره‌ی تلفن هرگز نمایش داده نمی‌شود (دیتاست هم آن را تولید نمی‌کند).
- وضعیت پیگیری **فقط از کاربر** پرسیده می‌شود و در `hamkharid.inquiry.v1` ذخیره می‌شود، سپس در contextِ درخواستِ بعدی به سرور می‌رود. روی کارت با «خبرهٔ شما» تگ می‌شود، نه تأیید ترب‌یار.

### فاز E — Generative UI و پیشنهادهای contextual
- blockهای جدید: `seller_inquiry`، `seller_followup`، `preference_picker`، `decision_summary` — همه در `BlockView` implement شده‌اند.
- `preference_picker`: گزینه‌ها دکمه‌ی واقعی هستند و labelِ انتخاب‌شده را به دستیار می‌سپارند.
- `decision_summary`: جمع‌بندی مبتنی بر داده (کمترین قیمت، میانگین بازار، تازگی، فاصله) + هشدارهای صادقانه.
- contractهای جدید: `AssistantContext.inquiry_status`، `FilterPatch`، `NextStep`/`NextStepAction`، `StoreCard.capabilities`، `StoreRef.website/instagram`.

### Transparency موتور (بدون تغییر اصل)
`meta.engine` ∈ `rules` | `llm_agent` | `rules_fallback` — همیشه نمایش داده می‌شود. عدم موجودیت key → `rules_fallback`، مگر آنکه `AI_AGENT_FALLBACK_TO_RULES=false` باشد.

---

## ۳. ماتریس ارزیابی نهایی (حداکثر ۳۰۰)

### A. تکمیل محصول / فرآیند خرید واقعی — ۷۵ → **۶۸**
| # | قابلیت | مدرک | باقی‌مانده |
| --- | --- | --- | --- |
| A1 | جست‌وجو + مقایسه + فروشگاه + نقشه + برنامه کامل است | `core.test.ts` ۲۳–۳۶، `plan.test.ts` | — |
| A2 | پیشنهادهای قابل اجرا (NextStep) | `suggestions.test.ts` (۹ تست) | client فقط `plan`/`stores` را local می‌نهند؛ `search`/`compare`/`inquiry` از طریق درخواست متن |
| A3 | inquiry + پیگیری خبرهٔ کاربر | `inquiry.test.ts` (۱۰ تست) | پاسخ خودکار فروشنده ممکن نیست (بدون API) |
| A4 | capability با منشأ | `capabilities.test.ts` (۶ تست) | ترب‌پی / قسطی / کالابرگ در دیتاست وجود ندارند → `unregistered` |

### B. UX / تعامل — ۷۵ → **۶۴**
| # | قابلیت | مدرک | باقی‌مانده |
| --- | --- | --- | --- |
| B1 | چت + blocks + پیشنهادهای قابل کلیک | `src/pages/ChatPage.tsx`، build تمیز | مرور live بدون دیتابیس غیرممکن است |
| B2 | پنل inquiry (کپی / باز‌کردن کانال) | `components/SellerInquiryView.tsx` | نیازمند دیتابیس کامل برای نمایش داده‌های واقعی |
| B3 | badgeهای capability با وضعیت | `components/CapabilityBadges.tsx` | — |
| B4 | picker + decision summary | `components/Blocks.tsx` | از سرور فقط در مسیرهای مشخص تولید می‌شوند |

### C. هوش agentik — ۵۰ → **۴۰**
- ۸ ابزار واقعی، آرگومان Zod-validated، artifacts با AsyncLocalStorage، `buildUiBlocks` حداکثر ۴ block.
- موتور پیشنهاد یکسان برای مسیرهای `rules` و `llm_agent`.
- موتور budget: در صورت عدم نتیجه، **بدون اجازه** بودجه را گسترش نمی‌دهد.
- باقی‌مانده: مدل زبانی در این محیط key ندارد؛ مسیر `llm_agent` توسط تست live رد شد.

### D. تعادل دیپلوی — ۴۰ → **۳۸**
- سرور بدون دیتابیس بالا می‌آید (لاگ صادقانه).
- `/api/assistant` در صورت عدم ایمپورت پاسخ صادقانه می‌دهد (۲۰₀، نه ۵۰۰).
- خطای API: `RouteError` → status خودش؛ عدم دیتابیس → ۵۰۳ با پیام واضح.
- بدون key یا PII در لاگ: `logSanitized` فقط نام error و code می‌زند.
- `server/index.ts` به `0.0.0.0` وصل است (preview در دسترس).
- باقی‌مانده: `dist/` به‌صورت دستی ساخته شد؛ هیچ دیپلوی productionی نشد.

### E. implementation فنی — ۴۰ → **۳۸**
- typecheck تمیز، build تمیز، ۹۴ تست.
- بدون any/genericsِ آزاد؛ حالت‌های ناشناخته با type narrowing.
- client-side `safeExternalHref`: فقط `http(s)` — هرگز URL executable.

### F. استفاده از دیتاست — ۲۰ → **۱۸**
- تمام نتایج از دیتابیس read-only (`PRAGMA query_only = ON`) می‌آید.
- هرگز در زمان اجرا write نمی‌کند و دیتاست اصلی تغییر نمی‌کند.
- قیمتها همیشه «ثبت‌شده» برچسب دارند، نه «روز».
- باقی‌مانده: بدون دیتابیس فقط با static analysis تأیید شد.

### جمع: **۲۶۶ / ۳۰۰**

---

## ۴. truth table — کدام فیلدهای دیتاست واقعاً وجود دارد؟

### وجود دارد (طبق `scripts/import_dataset.py`)
`shop_id, name, name_norm, address, neighborhood, neighborhood_norm, lat, lon, categories, categories_norm, contacts, phone, instagram, website, payments, fast_delivery, hours, offer_count, in_tehran`

### قطعاً وجود ندارد → همیشه «ثبت‌نشده / نامشخص» نمایش می‌شود
- **ترب‌پی (Tebpi)** — هیچ فیلد مجزایی در دیتاست وجود ندارد
- **خرید قسطی / کالابرگ** — فقط نام in-provider در `payments` ممکن است hint باشد
- **وجود کالا در انبار (stock)** — هرگز
- **پاسخ خودکار فروشنده** — هرگز

### تلفن (synthetic permanent)
`SYNTHETIC_CONTACTS = "[]"` و `SYNTHETIC_PHONE = None` — شماره‌ی تلفن هرگز نمایش داده نمی‌شود و نباید در UI Suggestion شود.

### estimate، نه واقعیت
- فاصله‌ها خط مستقیم (haversine) — نه مسیر خیابان.
- زمان پیاده‌روی تخمین.
- ترتیب ایست‌ها nearest-neighbour یا TSP از سرویس external.

---

## ۵. باقی‌مانده محدودیت‌ها

1. **بدون دیتابیس در این محیط** — `data/` خالی است. `npm run data:import` نیازمند CSV اصلی. همه‌ی مسیرهای مبتنی بر دیتابیس با تست static analysis و skip تأیید شدند.
2. **بدون live stock/price** — قیمت همیشه «ثبت‌شده در دیتاست».
3. **بدون API نقشه** — `MAPIR_API_KEY` / `NESHAN_API_KEY` تنظیم نشده → مسیریابی خیابانی فعال نیست (RouteError 503 صادقانه).
4. **بدون LLM key** — `OPENAI_API_KEY`خالی است → موتور قطعی (`rules`) پاسخ می‌دهد.
5. **تصاویر محصول external.
6. **پاسخ خودکار فروشنده** — impossible، طبق طراحی.

---

## ۶. نیازمندی‌های محیطی و مراحل دیپلوی دستی

### برای اجرای کامل
```bash
npm install
npm run data:import        # یا python scripts/import_dataset.py
```

### variables محیطی (بر اساس `.env.example`)
- `HAMKHARID_DB` — مسیر فایل دیتابیس (اختیاری)
- `MAPIR_API_KEY` یا `NESHAN_API_KEY` — مسیریابی خیابانی
- `OPENAI_API_KEY` / `AI_AGENT_ENABLED` — فعال‌سازی مدل
- `AI_AGENT_FALLBACK_TO_RULES` — کارکرد fallback

### دیپلوی دستی production
```bash
npm run build
NODE_ENV=production npm start     # سرور dist/ را serve می‌کند
```
(deployment live ترب‌یار تغییر نکرده؛ هیچ production deployی انجام نشد.)

### مرور دستی توصیه‌شده
1. `npm test && npm run typecheck && npm run build` — همه تمیز.
2. `npm run data:import` — اطمینان حاصل کنید `data/hamkharid.db` ساخته شود.
3. `npm start` + باز کردن UI.
4. در چت: «هدفون زیر ۵ میلیون» → پیشنهادها کلیک‌پذیر.
5. باز کردن یک کالا → block inquiry → کپی پیام / گزارش وضعیت پیگیری.
6. فروشگاه → badgeهای capability با وضعیت ثبت‌شده / ثبت‌نشده.
7. پنل توسعه (DEV) → engine visible (`rules` / `llm_agent` / `rules_fallback`).

---

## ۷. فایل‌های تغییر یافته

### اضافه شده
`server/capabilities.ts`, `server/inquiry.ts`, `server/suggestions.ts`,
`components/CapabilityBadges.tsx`, `components/SellerInquiryView.tsx`, `lib/links.ts`,
`server/tests/capabilities.test.ts`, `server/tests/inquiry.test.ts`, `server/tests/suggestions.test.ts`,
`docs/phase-f-handoff.md`

### تغییر یافته
`shared/types.ts`, `server/agent.ts`, `server/ai-agent.ts`, `server/ai-blocks.ts`, `server/assistant.ts`, `server/api.ts`, `server/db.ts`, `server/index.ts`, `server/nlu.ts`, `server/repo.ts`,
`components/Blocks.tsx`, `components/StoreCardView.tsx`, `lib/app-state.tsx`, `src/pages/ChatPage.tsx`,
`server/tests/mapir.test.ts`, `server/tests/routing.test.ts`

---

## ۸. تصمیمات مهم

- **lazy DB open** (`server/db.ts`) به‌جای throw در import: cause اصلی ۲ failing testِ baseline.
- **`request` در `NextStepAction`**: پیشنهادها در client قابل اجرا بدون نیاز به صفحه‌ی اختصاصی.
- **skip، نه fail** برای تست‌های دیتابیس‌دار: `fail` در فضای بدون دیتابیس منتقل شد به `skip`.
- ** پیشنهاد inquiry در صورت عدم recorded contact نمایش داده نمی‌شود** — هرگز پیشنهادی که UI نتواند اجرا کند shown نمی‌شود.
