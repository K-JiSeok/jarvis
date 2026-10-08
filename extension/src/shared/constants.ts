/**
 * 빌드 시점에 scripts/extension/build.mjs 가 채우는 값 (esbuild define).
 * 공개해도 되는 값만 넣는다: Supabase URL · anon(publishable) 키 · JARVIS 주소. service role 키는 절대 넣지 않는다 (빌드가 검사한다).
 */

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
declare const __JARVIS_API_BASE__: string;
declare const __EXT_VERSION__: string;
declare const __JARVIS_DEV__: boolean;

export const SUPABASE_URL = __SUPABASE_URL__;
export const SUPABASE_ANON_KEY = __SUPABASE_ANON_KEY__;
export const JARVIS_API_BASE = __JARVIS_API_BASE__;
export const EXT_VERSION = __EXT_VERSION__;
export const EXT_TOOL = "jarvis-extension";
/** 개발 빌드(JARVIS_EXT_DEV=1)에서만 true — 시험용 원본 요청 경로를 켠다. 배포 빌드에서는 코드째 빠진다 */
export const JARVIS_DEV = __JARVIS_DEV__;
