// node --import ./scripts/lib/ts-resolve.mjs …
// 테스트에서 src 의 확장자 없는 상대 import (예: "../import/core") 를 .ts 파일로 찾는다 (Next 번들러와 같은 동작).
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});
