-- JARVIS PHASE 6 · profit_calculations.break_even_price 추가
--
-- 손익분기 판매가(순이익이 0 이 되는 최저 판매가)를 계산 결과로 저장한다.
-- 기존 break_even_units(손익분기 판매량)와 다른 값이다. 기존 행은 NULL(모름) 로 남는다.

alter table public.profit_calculations
  add column break_even_price bigint;

comment on column public.profit_calculations.break_even_price is
  '손익분기 판매가 = 개당 고정 비용 ÷ (1 − 수수료율 − 광고비율). 비율 합이 100% 이상이면 NULL';
