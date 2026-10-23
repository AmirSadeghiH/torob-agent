import "./lib/env";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { api, apiErrorHandler } from "./api";
import { dbPath, dbReady } from "./db";

const app = express();
const port = Number(process.env.PORT) || 8787;
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use("/api", api);
app.use("/api", apiErrorHandler);

if (isProduction) {
  const dist = path.resolve(process.cwd(), "dist");
  if (!existsSync(dist)) {
    console.error("dist/ is missing. Run `npm run build` before `npm start`.");
    process.exit(1);
  }
  app.use(
    express.static(dist, {
      index: false,
      maxAge: "1y",
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.listen(port, "0.0.0.0", () => {
  console.log(`ترب‌یار API روی http://0.0.0.0:${port} — داده: ${path.basename(dbPath)}`);
  if (!dbReady()) {
    console.warn(
      `[db] ${path.basename(dbPath)} پیدا نشد. سرویس بالا است، اما جست‌وجوها تا ایمپورت داده معتبر نخواهند بود.`,
    );
    console.warn("[db] برای فعال‌سازی: npm run data:import");
  }
  if (!isProduction) {
    console.log("حالت توسعه: رابط کاربری جداگانه روی Vite اجرا می‌شود.");
  }
});
