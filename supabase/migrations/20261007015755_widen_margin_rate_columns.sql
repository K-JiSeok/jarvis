-- JARVIS PHASE 2 · 순이익률 컬럼 범위 확대 (GPT 결정 ① A안)
--
-- numeric(7,4) 는 ±999.9999 까지만 저장되어, 손실이 매출의 1,000배를 넘으면 INSERT 가 실패한다.
-- (sales_results.net_margin_rate 는 생성 컬럼이라 앱에서 피할 수도 없다 → 실제 판매 결과 저장 불가)
-- 의미는 그대로 두고 저장 범위만 numeric(12,4) (±99,999,999.9999) 로 넓힌다.
--
-- v_prediction_vs_actual 이 predictions.net_margin_predicted 를 참조하므로
-- 뷰를 잠시 내리고 컬럼 타입을 바꾼 뒤, 0009 와 같은 정의로 다시 만든다.

drop view public.v_prediction_vs_actual;

alter table public.sales_results
  alter column net_margin_rate type numeric(12, 4);
alter table public.profit_calculations
  alter column net_margin_rate type numeric(12, 4);
alter table public.predictions
  alter column net_margin_predicted type numeric(12, 4);

-- v_prediction_vs_actual (0009 와 동일) -------------------------------------
create view public.v_prediction_vs_actual
with (security_invoker = true)
as
select
  pr.id as prediction_id,
  pr.owner_id,
  pr.product_id,
  pr.listing_id,
  pr.opportunity_score_id,
  pr.model_version,
  pr.predicted_at,
  pr.target_period_start,
  pr.target_period_end,
  (pr.target_period_end - pr.target_period_start + 1) as target_days,
  a.period_type,
  a.source_type,
  a.result_rows,
  a.coverage_days,
  (a.coverage_days = (pr.target_period_end - pr.target_period_start + 1)) as is_complete,

  pr.sales_predicted,
  a.units_sold as sales_actual,
  a.units_sold - pr.sales_predicted as sales_error,
  abs(a.units_sold - pr.sales_predicted) as sales_abs_error,
  round((a.units_sold - pr.sales_predicted)::numeric / nullif(a.units_sold, 0), 4) as sales_error_rate,

  pr.revenue_predicted,
  a.gross_revenue as revenue_actual,
  a.gross_revenue - pr.revenue_predicted as revenue_error,
  abs(a.gross_revenue - pr.revenue_predicted) as revenue_abs_error,
  round((a.gross_revenue - pr.revenue_predicted)::numeric / nullif(a.gross_revenue, 0), 4) as revenue_error_rate,

  pr.net_profit_predicted,
  a.net_profit as net_profit_actual,
  a.net_profit - pr.net_profit_predicted as net_profit_error,
  abs(a.net_profit - pr.net_profit_predicted) as net_profit_abs_error,
  round((a.net_profit - pr.net_profit_predicted)::numeric / nullif(a.net_profit, 0), 4) as net_profit_error_rate,

  pr.net_margin_predicted,
  round(a.net_profit::numeric / nullif(a.gross_revenue, 0), 4) as net_margin_actual
from public.predictions pr
left join lateral (
  select
    r.period_type,
    r.source_type,
    count(*) as result_rows,
    sum(r.period_end - r.period_start + 1) as coverage_days,
    case when count(r.units_sold) = count(*) then sum(r.units_sold) end as units_sold,
    case when count(r.gross_revenue) = count(*) then sum(r.gross_revenue) end as gross_revenue,
    case when count(r.net_profit) = count(*) then sum(r.net_profit) end as net_profit
  from public.sales_results r
  where r.listing_id = pr.listing_id
    and r.period_start >= pr.target_period_start
    and r.period_end <= pr.target_period_end
  group by r.period_type, r.source_type
) a on true;

comment on view public.v_prediction_vs_actual is '예측 vs 실제. listing_id 가 없는 예측은 실적 행이 붙지 않는다.';

-- 다시 만든 뷰의 권한: anon 차단 유지, authenticated 조회 (0011 과 동일한 상태)
revoke all on public.v_prediction_vs_actual from anon;
grant select on public.v_prediction_vs_actual to authenticated, service_role;
