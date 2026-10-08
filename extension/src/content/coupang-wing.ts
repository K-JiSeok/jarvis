/**
 * 쿠팡 WING 콘텐츠 스크립트.
 * WING 화면에서 실제로 확인한 지표만 읽는다. 확인 전에는 아무것도 보내지 않는다.
 */

import type { DetectResponse } from "../shared/types";

import { start, type PageCollector } from "./common";
import { readWingPage, wingPageKind } from "./dom/wing";

const collector: PageCollector = {
  pageType: "wing",
  detect(): DetectResponse {
    const kind = wingPageKind();
    if (!kind.supported) return { pageType: "wing", collectable: false, reason: kind.reason, summary: [kind.label] };
    return { pageType: "wing", collectable: true, summary: [kind.label] };
  },
  read() {
    return readWingPage();
  },
};

start(collector);
