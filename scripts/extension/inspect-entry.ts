/**
 * 검사용 번들 입구 (extension/dist/inspect/inspect.js). 확장 프로그램에는 들어가지 않는다.
 * 실제 쿠팡 페이지에 붙여 넣어 확장 프로그램과 같은 코드로 화면을 읽고 → 어댑터 결과(Collected*)를 본다 (DB 전송 없음).
 * 정규화는 결과 JSON 을 Node 에서 같은 함수로 돌려 확인한다 (번들을 작게 유지).
 */
import { adaptProductPage } from "../../src/lib/collectors/coupang/product";
import { adaptSearchPage } from "../../src/lib/collectors/coupang/search";
import { readProductPage } from "../../extension/src/content/dom/product";
import { readSearchPage } from "../../extension/src/content/dom/search";

const meta = () => ({ source: "COUPANG_PAGE" as const, confidence: "A" as const, capturedAt: new Date().toISOString() });

(globalThis as Record<string, unknown>).__jarvisInspect = {
  product() {
    const raw = readProductPage();
    return { raw, collected: adaptProductPage(raw, meta()) };
  },
  search() {
    const raw = readSearchPage();
    return { raw, collected: adaptSearchPage(raw, meta()) };
  },
};
