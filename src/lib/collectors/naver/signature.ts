/**
 * 네이버 검색광고 API 서명 (공식 샘플 signaturehelper.py 와 같음): Base64(HMAC-SHA256(secret, "{timestamp}.{METHOD}.{uri}"))
 * 서버에서만 쓴다 (node:crypto). 확장 프로그램 번들에 넣지 않는다.
 */
import { createHmac } from "node:crypto";

import { signatureMessage } from "./searchad";

export function naverSignature(secretKey: string, timestamp: string, method: string, uri: string): string {
  return createHmac("sha256", secretKey).update(signatureMessage(timestamp, method, uri), "utf8").digest("base64");
}
