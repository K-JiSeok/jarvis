// npm run ext:build — JARVIS 확장 프로그램을 extension/dist 로 빌드한다 (Chrome "압축해제된 확장 프로그램 로드" 로 이 폴더를 연다)
//
// - 공개 값만 넣는다: NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local) · JARVIS_API_BASE (기본 http://localhost:3000)
// - service role 키가 결과물에 들어가면 빌드를 실패시킨다.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ext = join(root, "extension");
const out = join(ext, "dist");

function readEnv() {
  const env = {};
  try {
    for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env.local 없음
  }
  return { ...env, ...process.env };
}

const env = readEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dev = process.env.JARVIS_EXT_DEV === "1";
const apiBase = (env.JARVIS_API_BASE || "http://localhost:3000").replace(/\/$/, "");
if (!supabaseUrl || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 없습니다 (.env.local).");

// 공개 키인지 확인 (service role · secret 키면 중단)
function keyRole(key) {
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role ?? "unknown";
  } catch {
    return "unknown";
  }
}
const role = keyRole(anonKey);
if (!["anon", "publishable"].includes(role)) throw new Error(`확장 프로그램에는 공개(anon) 키만 넣을 수 있습니다 (지금 키: ${role}).`);

const manifestBase = JSON.parse(readFileSync(join(ext, "manifest.base.json"), "utf8"));
const version = manifestBase.version;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = {
  bundle: true,
  target: "chrome120",
  charset: "utf8",
  legalComments: "none",
  // 상수 접기 · 죽은 코드 제거 (배포 빌드에서 개발용 시험 경로가 코드째 빠지도록)
  minifySyntax: true,
  logLevel: "warning",
  define: {
    __SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __SUPABASE_ANON_KEY__: JSON.stringify(anonKey),
    __JARVIS_API_BASE__: JSON.stringify(apiBase),
    __EXT_VERSION__: JSON.stringify(version),
    __JARVIS_DEV__: JSON.stringify(dev),
  },
};
const src = (p) => join(ext, "src", p);

await build({ ...common, entryPoints: [src("background/service-worker.ts")], outfile: join(out, "background.js"), format: "esm" });
for (const [name, file] of [
  ["content-product", "content/coupang-product.ts"],
  ["content-search", "content/coupang-search.ts"],
  ["content-wing", "content/coupang-wing.ts"],
  ["popup", "popup/popup.ts"],
]) {
  await build({ ...common, entryPoints: [src(file)], outfile: join(out, `${name}.js`), format: "iife" });
}
// 검사용 번들 (manifest 에 없음): 화면 읽기 함수만 window.__jarvisInspect 로 노출 — 실제 페이지에서 selector 를 대조할 때 쓴다
await build({ ...common, entryPoints: [join(root, "scripts", "extension", "inspect-entry.ts")], outfile: join(out, "inspect", "inspect.js"), format: "iife", minify: true });

copyFileSync(src("popup/popup.html"), join(out, "popup.html"));
copyFileSync(src("popup/popup.css"), join(out, "popup.css"));

const manifest = {
  ...manifestBase,
  host_permissions: [...manifestBase.host_permissions, `${apiBase}/*`, `${new URL(supabaseUrl).origin}/*`],
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

// 비밀 값이 결과물에 없는지 확인
const secrets = [env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean);
const files = readdirSync(out, { recursive: true }).filter((f) => /\.(js|json|html|css)$/.test(f));
for (const f of files) {
  const body = readFileSync(join(out, f), "utf8");
  for (const s of secrets) if (body.includes(s)) throw new Error(`비밀 키가 ${f} 에 들어갔습니다. 빌드를 중단합니다.`);
  if (/service_role/.test(body)) throw new Error(`${f} 에 service_role 문자열이 있습니다.`);
  if (!dev && /jarvisDev|dev-raw/.test(body)) throw new Error(`${f} 에 개발용 시험 경로가 남았습니다.`);
}

const size = (f) => (readFileSync(join(out, f)).length / 1024).toFixed(1);
console.log(`extension/dist 빌드 완료 (v${version}${dev ? " 개발 빌드: 시험 경로 켜짐" : ""}, API ${apiBase}, 키 ${role})`);
for (const f of files.sort()) console.log(`  ${f.padEnd(24)} ${size(f)} KB`);
