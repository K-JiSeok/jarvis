import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // /import: 파일(최대 10MB, src/lib/import/core.ts MAX_FILE_BYTES)을 Server Function 으로 받는다. 폼 여유분 포함
    serverActions: { bodySizeLimit: "11mb" },
    // proxy.ts 가 요청 본문을 버퍼링하는 한도 (기본 10MB)
    proxyClientMaxBodySize: "11mb",
  },
};

export default nextConfig;
