// ⚠️ 자동 생성 파일 — 직접 수정하지 않는다.
// 생성: Supabase 공식 타입 생성 (JARVIS 프로젝트, supabase/migrations 0001~0012 적용 후)
// 다시 만들기: npm run db:types (supabase gen types) — 로컬 대안: npm run db:types:local
//
// DB 레벨 원시 타입이다. DOMAIN(source_type_t 등)은 string 으로 나온다.
// 앱에서 쓰는 좁은 타입(SourceType, Confidence …)은 src/types/common.ts, 연결은 src/types/db.ts.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          coupang_category_id: string | null
          coupang_fee_rate: number | null
          created_at: string
          depth: number | null
          id: string
          is_active: boolean
          name: string
          owner_id: string
          parent_id: string | null
          path: string | null
          source_type: string
          updated_at: string
        }
        Insert: {
          coupang_category_id?: string | null
          coupang_fee_rate?: number | null
          created_at?: string
          depth?: number | null
          id?: string
          is_active?: boolean
          name: string
          owner_id?: string
          parent_id?: string | null
          path?: string | null
          source_type: string
          updated_at?: string
        }
        Update: {
          coupang_category_id?: string | null
          coupang_fee_rate?: number | null
          created_at?: string
          depth?: number | null
          id?: string
          is_active?: boolean
          name?: string
          owner_id?: string
          parent_id?: string | null
          path?: string | null
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_fk"
            columns: ["owner_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      competitors: {
        Row: {
          competitor_product_id: string
          created_at: string
          id: string
          is_active: boolean
          keyword_id: string | null
          memo: string | null
          owner_id: string
          product_id: string
          relation_type: string
          source_type: string
          updated_at: string
        }
        Insert: {
          competitor_product_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          keyword_id?: string | null
          memo?: string | null
          owner_id?: string
          product_id: string
          relation_type: string
          source_type: string
          updated_at?: string
        }
        Update: {
          competitor_product_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keyword_id?: string | null
          memo?: string | null
          owner_id?: string
          product_id?: string
          relation_type?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitors_competitor_product_fk"
            columns: ["owner_id", "competitor_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "competitors_competitor_product_fk"
            columns: ["owner_id", "competitor_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
          {
            foreignKeyName: "competitors_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "competitors_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "v_keyword_latest"
            referencedColumns: ["owner_id", "keyword_id"]
          },
          {
            foreignKeyName: "competitors_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "competitors_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          channel: string
          column_mapping: Json | null
          created_at: string
          dry_run: boolean
          error_summary: string | null
          failed_rows: number
          file_hash: string | null
          file_name: string | null
          file_size_bytes: number | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          import_type: string
          inserted_rows: number
          owner_id: string
          schema_version: string | null
          skipped_rows: number
          source_tool: string | null
          source_type: string
          started_at: string | null
          status: string
          storage_path: string | null
          total_rows: number
          updated_rows: number
        }
        Insert: {
          channel: string
          column_mapping?: Json | null
          created_at?: string
          dry_run?: boolean
          error_summary?: string | null
          failed_rows?: number
          file_hash?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          import_type: string
          inserted_rows?: number
          owner_id?: string
          schema_version?: string | null
          skipped_rows?: number
          source_tool?: string | null
          source_type: string
          started_at?: string | null
          status?: string
          storage_path?: string | null
          total_rows?: number
          updated_rows?: number
        }
        Update: {
          channel?: string
          column_mapping?: Json | null
          created_at?: string
          dry_run?: boolean
          error_summary?: string | null
          failed_rows?: number
          file_hash?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          import_type?: string
          inserted_rows?: number
          owner_id?: string
          schema_version?: string | null
          skipped_rows?: number
          source_tool?: string | null
          source_type?: string
          started_at?: string | null
          status?: string
          storage_path?: string | null
          total_rows?: number
          updated_rows?: number
        }
        Relationships: []
      }
      import_rows: {
        Row: {
          created_at: string
          error_code: string | null
          error_message: string | null
          id: number
          import_job_id: string
          owner_id: string
          payload: Json
          previous_values: Json | null
          record_key: string | null
          result: string
          row_number: number
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: never
          import_job_id: string
          owner_id?: string
          payload: Json
          previous_values?: Json | null
          record_key?: string | null
          result?: string
          row_number: number
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: never
          import_job_id?: string
          owner_id?: string
          payload?: Json
          previous_values?: Json | null
          record_key?: string | null
          result?: string
          row_number?: number
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_job_fk"
            columns: ["owner_id", "import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      keyword_product_ranks: {
        Row: {
          captured_at: string
          captured_on: string
          confidence: string
          created_at: string
          id: number
          import_job_id: string | null
          is_ad: boolean
          keyword_id: string
          owner_id: string
          page: number | null
          product_id: string
          rank_position: number
          source_type: string
        }
        Insert: {
          captured_at: string
          captured_on: string
          confidence: string
          created_at?: string
          id?: never
          import_job_id?: string | null
          is_ad?: boolean
          keyword_id: string
          owner_id?: string
          page?: number | null
          product_id: string
          rank_position: number
          source_type: string
        }
        Update: {
          captured_at?: string
          captured_on?: string
          confidence?: string
          created_at?: string
          id?: never
          import_job_id?: string | null
          is_ad?: boolean
          keyword_id?: string
          owner_id?: string
          page?: number | null
          product_id?: string
          rank_position?: number
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "keyword_product_ranks_import_job_fk"
            columns: ["owner_id", "import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "keyword_product_ranks_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "keyword_product_ranks_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "v_keyword_latest"
            referencedColumns: ["owner_id", "keyword_id"]
          },
          {
            foreignKeyName: "keyword_product_ranks_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "keyword_product_ranks_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
        ]
      }
      keyword_snapshots: {
        Row: {
          ad_bid: number | null
          average_price: number | null
          average_reviews: number | null
          brand_concentration: number | null
          captured_at: string
          captured_on: string
          competition_intensity: number | null
          confidence: string
          coupang_product_count: number | null
          created_at: string
          excluded_reason: string | null
          id: number
          import_job_id: string | null
          is_excluded: boolean
          keyword_id: string
          metric_meta: Json
          owner_id: string
          rocket_ratio: number | null
          sample_size: number | null
          search_growth_rate: number | null
          search_volume: number | null
          search_volume_previous: number | null
          source_type: string
          wing_ratio: number | null
        }
        Insert: {
          ad_bid?: number | null
          average_price?: number | null
          average_reviews?: number | null
          brand_concentration?: number | null
          captured_at: string
          captured_on: string
          competition_intensity?: number | null
          confidence: string
          coupang_product_count?: number | null
          created_at?: string
          excluded_reason?: string | null
          id?: never
          import_job_id?: string | null
          is_excluded?: boolean
          keyword_id: string
          metric_meta?: Json
          owner_id?: string
          rocket_ratio?: number | null
          sample_size?: number | null
          search_growth_rate?: number | null
          search_volume?: number | null
          search_volume_previous?: number | null
          source_type: string
          wing_ratio?: number | null
        }
        Update: {
          ad_bid?: number | null
          average_price?: number | null
          average_reviews?: number | null
          brand_concentration?: number | null
          captured_at?: string
          captured_on?: string
          competition_intensity?: number | null
          confidence?: string
          coupang_product_count?: number | null
          created_at?: string
          excluded_reason?: string | null
          id?: never
          import_job_id?: string | null
          is_excluded?: boolean
          keyword_id?: string
          metric_meta?: Json
          owner_id?: string
          rocket_ratio?: number | null
          sample_size?: number | null
          search_growth_rate?: number | null
          search_volume?: number | null
          search_volume_previous?: number | null
          source_type?: string
          wing_ratio?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "keyword_snapshots_import_job_fk"
            columns: ["owner_id", "import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "keyword_snapshots_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "keyword_snapshots_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "v_keyword_latest"
            referencedColumns: ["owner_id", "keyword_id"]
          },
        ]
      }
      keywords: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          is_tracking: boolean
          keyword: string
          memo: string | null
          normalized_keyword: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          is_tracking?: boolean
          keyword: string
          memo?: string | null
          normalized_keyword: string
          owner_id?: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          is_tracking?: boolean
          keyword?: string
          memo?: string | null
          normalized_keyword?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "keywords_category_fk"
            columns: ["owner_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      my_listings: {
        Row: {
          baseline_profit_calc_id: string | null
          baseline_score_id: string | null
          channel: string
          created_at: string
          ended_on: string | null
          fulfillment_type: string | null
          id: string
          launch_date: string | null
          listing_name: string
          memo: string | null
          own_product_id: string | null
          owner_id: string
          reference_product_id: string
          sku: string | null
          status: string
          updated_at: string
          watchlist_id: string | null
        }
        Insert: {
          baseline_profit_calc_id?: string | null
          baseline_score_id?: string | null
          channel?: string
          created_at?: string
          ended_on?: string | null
          fulfillment_type?: string | null
          id?: string
          launch_date?: string | null
          listing_name: string
          memo?: string | null
          own_product_id?: string | null
          owner_id?: string
          reference_product_id: string
          sku?: string | null
          status?: string
          updated_at?: string
          watchlist_id?: string | null
        }
        Update: {
          baseline_profit_calc_id?: string | null
          baseline_score_id?: string | null
          channel?: string
          created_at?: string
          ended_on?: string | null
          fulfillment_type?: string | null
          id?: string
          launch_date?: string | null
          listing_name?: string
          memo?: string | null
          own_product_id?: string | null
          owner_id?: string
          reference_product_id?: string
          sku?: string | null
          status?: string
          updated_at?: string
          watchlist_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "my_listings_baseline_profit_calc_fk"
            columns: ["owner_id", "baseline_profit_calc_id"]
            isOneToOne: false
            referencedRelation: "profit_calculations"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "my_listings_baseline_score_fk"
            columns: ["owner_id", "baseline_score_id"]
            isOneToOne: false
            referencedRelation: "opportunity_scores"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "my_listings_baseline_score_fk"
            columns: ["owner_id", "baseline_score_id"]
            isOneToOne: false
            referencedRelation: "v_current_scores"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "my_listings_own_product_fk"
            columns: ["owner_id", "own_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "my_listings_own_product_fk"
            columns: ["owner_id", "own_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
          {
            foreignKeyName: "my_listings_reference_product_fk"
            columns: ["owner_id", "reference_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "my_listings_reference_product_fk"
            columns: ["owner_id", "reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
          {
            foreignKeyName: "my_listings_watchlist_fk"
            columns: ["owner_id", "watchlist_id"]
            isOneToOne: false
            referencedRelation: "watchlist"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      opportunity_scores: {
        Row: {
          calculated_at: string
          competition_score: number | null
          conversion_score: number | null
          data_confidence: string | null
          demand_score: number | null
          extra_factor_scores: Json
          growth_score: number | null
          id: string
          input_refs: Json
          is_current: boolean
          keyword_id: string | null
          margin_score: number | null
          missing_factors: string[] | null
          owner_id: string
          product_id: string
          reasons: Json
          review_barrier_score: number | null
          sales_score: number | null
          scoring_version: string
          stability_score: number | null
          total_score: number
          verdict: string
          wing_score: number | null
        }
        Insert: {
          calculated_at?: string
          competition_score?: number | null
          conversion_score?: number | null
          data_confidence?: string | null
          demand_score?: number | null
          extra_factor_scores?: Json
          growth_score?: number | null
          id?: string
          input_refs: Json
          is_current?: boolean
          keyword_id?: string | null
          margin_score?: number | null
          missing_factors?: string[] | null
          owner_id?: string
          product_id: string
          reasons?: Json
          review_barrier_score?: number | null
          sales_score?: number | null
          scoring_version: string
          stability_score?: number | null
          total_score: number
          verdict: string
          wing_score?: number | null
        }
        Update: {
          calculated_at?: string
          competition_score?: number | null
          conversion_score?: number | null
          data_confidence?: string | null
          demand_score?: number | null
          extra_factor_scores?: Json
          growth_score?: number | null
          id?: string
          input_refs?: Json
          is_current?: boolean
          keyword_id?: string | null
          margin_score?: number | null
          missing_factors?: string[] | null
          owner_id?: string
          product_id?: string
          reasons?: Json
          review_barrier_score?: number | null
          sales_score?: number | null
          scoring_version?: string
          stability_score?: number | null
          total_score?: number
          verdict?: string
          wing_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_scores_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "opportunity_scores_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "v_keyword_latest"
            referencedColumns: ["owner_id", "keyword_id"]
          },
          {
            foreignKeyName: "opportunity_scores_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "opportunity_scores_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
          {
            foreignKeyName: "opportunity_scores_scoring_version_fkey"
            columns: ["scoring_version"]
            isOneToOne: false
            referencedRelation: "scoring_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      predictions: {
        Row: {
          assumptions: Json | null
          created_at: string
          id: string
          listing_id: string | null
          model_version: string
          net_margin_predicted: number | null
          net_profit_predicted: number | null
          opportunity_score_id: string | null
          owner_id: string
          predicted_at: string
          product_id: string
          profit_calculation_id: string | null
          revenue_predicted: number | null
          sales_predicted: number | null
          target_period_end: string
          target_period_start: string
        }
        Insert: {
          assumptions?: Json | null
          created_at?: string
          id?: string
          listing_id?: string | null
          model_version: string
          net_margin_predicted?: number | null
          net_profit_predicted?: number | null
          opportunity_score_id?: string | null
          owner_id?: string
          predicted_at?: string
          product_id: string
          profit_calculation_id?: string | null
          revenue_predicted?: number | null
          sales_predicted?: number | null
          target_period_end: string
          target_period_start: string
        }
        Update: {
          assumptions?: Json | null
          created_at?: string
          id?: string
          listing_id?: string | null
          model_version?: string
          net_margin_predicted?: number | null
          net_profit_predicted?: number | null
          opportunity_score_id?: string | null
          owner_id?: string
          predicted_at?: string
          product_id?: string
          profit_calculation_id?: string | null
          revenue_predicted?: number | null
          sales_predicted?: number | null
          target_period_end?: string
          target_period_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_listing_fk"
            columns: ["owner_id", "listing_id"]
            isOneToOne: false
            referencedRelation: "my_listings"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "predictions_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "predictions_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
          {
            foreignKeyName: "predictions_profit_calc_fk"
            columns: ["owner_id", "profit_calculation_id"]
            isOneToOne: false
            referencedRelation: "profit_calculations"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "predictions_score_fk"
            columns: ["owner_id", "opportunity_score_id"]
            isOneToOne: false
            referencedRelation: "opportunity_scores"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "predictions_score_fk"
            columns: ["owner_id", "opportunity_score_id"]
            isOneToOne: false
            referencedRelation: "v_current_scores"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      product_risks: {
        Row: {
          created_at: string
          description: string
          detected_at: string
          evidence: Json | null
          id: string
          is_active: boolean
          opportunity_score_id: string | null
          owner_id: string
          product_id: string
          resolved_at: string | null
          risk_level: string
          risk_type: string
          source_type: string
        }
        Insert: {
          created_at?: string
          description: string
          detected_at?: string
          evidence?: Json | null
          id?: string
          is_active?: boolean
          opportunity_score_id?: string | null
          owner_id?: string
          product_id: string
          resolved_at?: string | null
          risk_level: string
          risk_type: string
          source_type: string
        }
        Update: {
          created_at?: string
          description?: string
          detected_at?: string
          evidence?: Json | null
          id?: string
          is_active?: boolean
          opportunity_score_id?: string | null
          owner_id?: string
          product_id?: string
          resolved_at?: string | null
          risk_level?: string
          risk_type?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_risks_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "product_risks_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
          {
            foreignKeyName: "product_risks_score_fk"
            columns: ["owner_id", "product_id", "opportunity_score_id"]
            isOneToOne: false
            referencedRelation: "opportunity_scores"
            referencedColumns: ["owner_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_risks_score_fk"
            columns: ["owner_id", "product_id", "opportunity_score_id"]
            isOneToOne: false
            referencedRelation: "v_current_scores"
            referencedColumns: ["owner_id", "product_id", "id"]
          },
        ]
      }
      product_snapshots: {
        Row: {
          captured_at: string
          captured_on: string
          category_rank: number | null
          confidence: string
          conversion_rate: number | null
          created_at: string
          delivery_type: string | null
          discount_rate: number | null
          excluded_reason: string | null
          id: number
          import_job_id: string | null
          is_excluded: boolean
          metric_meta: Json
          option_count: number | null
          original_price: number | null
          owner_id: string
          price: number | null
          product_id: string
          product_name_observed: string | null
          rating: number | null
          revenue_actual: number | null
          revenue_estimated: number | null
          review_count: number | null
          sales_actual: number | null
          sales_estimated: number | null
          sales_period_days: number | null
          seller_type_observed: string | null
          source_type: string
          views_28d: number | null
        }
        Insert: {
          captured_at: string
          captured_on: string
          category_rank?: number | null
          confidence: string
          conversion_rate?: number | null
          created_at?: string
          delivery_type?: string | null
          discount_rate?: number | null
          excluded_reason?: string | null
          id?: never
          import_job_id?: string | null
          is_excluded?: boolean
          metric_meta?: Json
          option_count?: number | null
          original_price?: number | null
          owner_id?: string
          price?: number | null
          product_id: string
          product_name_observed?: string | null
          rating?: number | null
          revenue_actual?: number | null
          revenue_estimated?: number | null
          review_count?: number | null
          sales_actual?: number | null
          sales_estimated?: number | null
          sales_period_days?: number | null
          seller_type_observed?: string | null
          source_type: string
          views_28d?: number | null
        }
        Update: {
          captured_at?: string
          captured_on?: string
          category_rank?: number | null
          confidence?: string
          conversion_rate?: number | null
          created_at?: string
          delivery_type?: string | null
          discount_rate?: number | null
          excluded_reason?: string | null
          id?: never
          import_job_id?: string | null
          is_excluded?: boolean
          metric_meta?: Json
          option_count?: number | null
          original_price?: number | null
          owner_id?: string
          price?: number | null
          product_id?: string
          product_name_observed?: string | null
          rating?: number | null
          revenue_actual?: number | null
          revenue_estimated?: number | null
          review_count?: number | null
          sales_actual?: number | null
          sales_estimated?: number | null
          sales_period_days?: number | null
          seller_type_observed?: string | null
          source_type?: string
          views_28d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_snapshots_import_job_fk"
            columns: ["owner_id", "import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "product_snapshots_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "product_snapshots_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          category_id: string | null
          coupang_item_id: string | null
          coupang_product_id: string
          coupang_vendor_item_id: string | null
          created_at: string
          deleted_detected_at: string | null
          first_seen_at: string
          id: string
          is_coupang_pb: boolean | null
          is_own_product: boolean
          last_seen_at: string
          lifecycle_status: string
          option_count: number | null
          owner_id: string
          product_name: string
          product_url: string | null
          seller_type: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category_id?: string | null
          coupang_item_id?: string | null
          coupang_product_id: string
          coupang_vendor_item_id?: string | null
          created_at?: string
          deleted_detected_at?: string | null
          first_seen_at?: string
          id?: string
          is_coupang_pb?: boolean | null
          is_own_product?: boolean
          last_seen_at?: string
          lifecycle_status?: string
          option_count?: number | null
          owner_id?: string
          product_name: string
          product_url?: string | null
          seller_type?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category_id?: string | null
          coupang_item_id?: string | null
          coupang_product_id?: string
          coupang_vendor_item_id?: string | null
          created_at?: string
          deleted_detected_at?: string | null
          first_seen_at?: string
          id?: string
          is_coupang_pb?: boolean | null
          is_own_product?: boolean
          last_seen_at?: string
          lifecycle_status?: string
          option_count?: number | null
          owner_id?: string
          product_name?: string
          product_url?: string | null
          seller_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_fk"
            columns: ["owner_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      profit_calculations: {
        Row: {
          ad_cost_amount: number | null
          break_even_price: number | null

          break_even_units: number | null
          calculated_at: string
          coupang_fee_amount: number | null
          formula_version: string
          id: string
          inputs_snapshot: Json
          is_current: boolean
          monthly_net_profit: number | null
          net_margin_rate: number | null
          net_profit_per_unit: number | null
          owner_id: string
          product_id: string
          roi: number | null
          scenario_id: string
          total_cost_per_unit: number | null
          unit_cost_krw: number | null
        }
        Insert: {
          ad_cost_amount?: number | null
          break_even_price?: number | null

          break_even_units?: number | null
          calculated_at?: string
          coupang_fee_amount?: number | null
          formula_version: string
          id?: string
          inputs_snapshot: Json
          is_current?: boolean
          monthly_net_profit?: number | null
          net_margin_rate?: number | null
          net_profit_per_unit?: number | null
          owner_id?: string
          product_id: string
          roi?: number | null
          scenario_id: string
          total_cost_per_unit?: number | null
          unit_cost_krw?: number | null
        }
        Update: {
          ad_cost_amount?: number | null
          break_even_price?: number | null

          break_even_units?: number | null
          calculated_at?: string
          coupang_fee_amount?: number | null
          formula_version?: string
          id?: string
          inputs_snapshot?: Json
          is_current?: boolean
          monthly_net_profit?: number | null
          net_margin_rate?: number | null
          net_profit_per_unit?: number | null
          owner_id?: string
          product_id?: string
          roi?: number | null
          scenario_id?: string
          total_cost_per_unit?: number | null
          unit_cost_krw?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profit_calculations_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "profit_calculations_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
          {
            foreignKeyName: "profit_calculations_scenario_fk"
            columns: ["owner_id", "product_id", "scenario_id"]
            isOneToOne: false
            referencedRelation: "profit_scenarios"
            referencedColumns: ["owner_id", "product_id", "id"]
          },
        ]
      }
      profit_scenarios: {
        Row: {
          ad_cost_per_unit: number | null
          ad_cost_rate: number | null
          confidence: string
          coupang_fee_rate: number | null
          created_at: string
          domestic_shipping_per_unit: number | null
          exchange_rate: number
          expected_monthly_units: number | null
          fixed_cost_total: number | null
          id: string
          intl_shipping_per_unit: number | null
          is_primary: boolean
          logistics_fee_per_unit: number | null
          memo: string | null
          name: string
          other_cost_per_unit: number | null
          owner_id: string
          product_id: string
          sale_price: number | null
          source_type: string
          unit_cost_amount: number | null
          unit_cost_currency: string
          updated_at: string
          vat_included: boolean
        }
        Insert: {
          ad_cost_per_unit?: number | null
          ad_cost_rate?: number | null
          confidence?: string
          coupang_fee_rate?: number | null
          created_at?: string
          domestic_shipping_per_unit?: number | null
          exchange_rate?: number
          expected_monthly_units?: number | null
          fixed_cost_total?: number | null
          id?: string
          intl_shipping_per_unit?: number | null
          is_primary?: boolean
          logistics_fee_per_unit?: number | null
          memo?: string | null
          name?: string
          other_cost_per_unit?: number | null
          owner_id?: string
          product_id: string
          sale_price?: number | null
          source_type?: string
          unit_cost_amount?: number | null
          unit_cost_currency?: string
          updated_at?: string
          vat_included?: boolean
        }
        Update: {
          ad_cost_per_unit?: number | null
          ad_cost_rate?: number | null
          confidence?: string
          coupang_fee_rate?: number | null
          created_at?: string
          domestic_shipping_per_unit?: number | null
          exchange_rate?: number
          expected_monthly_units?: number | null
          fixed_cost_total?: number | null
          id?: string
          intl_shipping_per_unit?: number | null
          is_primary?: boolean
          logistics_fee_per_unit?: number | null
          memo?: string | null
          name?: string
          other_cost_per_unit?: number | null
          owner_id?: string
          product_id?: string
          sale_price?: number | null
          source_type?: string
          unit_cost_amount?: number | null
          unit_cost_currency?: string
          updated_at?: string
          vat_included?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profit_scenarios_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "profit_scenarios_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
        ]
      }
      sales_results: {
        Row: {
          ad_spend: number | null
          cogs: number | null
          confidence: string
          coupang_fees: number | null
          created_at: string
          gross_revenue: number | null
          id: number
          import_job_id: string | null
          listing_id: string
          logistics_cost: number | null
          memo: string | null
          net_margin_rate: number | null
          net_profit: number | null
          other_costs: number | null
          owner_id: string
          period_end: string
          period_start: string
          period_type: string
          returned_units: number | null
          source_type: string
          units_sold: number | null
          updated_at: string
        }
        Insert: {
          ad_spend?: number | null
          cogs?: number | null
          confidence: string
          coupang_fees?: number | null
          created_at?: string
          gross_revenue?: number | null
          id?: never
          import_job_id?: string | null
          listing_id: string
          logistics_cost?: number | null
          memo?: string | null
          net_margin_rate?: number | null
          net_profit?: number | null
          other_costs?: number | null
          owner_id?: string
          period_end: string
          period_start: string
          period_type: string
          returned_units?: number | null
          source_type: string
          units_sold?: number | null
          updated_at?: string
        }
        Update: {
          ad_spend?: number | null
          cogs?: number | null
          confidence?: string
          coupang_fees?: number | null
          created_at?: string
          gross_revenue?: number | null
          id?: never
          import_job_id?: string | null
          listing_id?: string
          logistics_cost?: number | null
          memo?: string | null
          net_margin_rate?: number | null
          net_profit?: number | null
          other_costs?: number | null
          owner_id?: string
          period_end?: string
          period_start?: string
          period_type?: string
          returned_units?: number | null
          source_type?: string
          units_sold?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_results_import_job_fk"
            columns: ["owner_id", "import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "sales_results_listing_fk"
            columns: ["owner_id", "listing_id"]
            isOneToOne: false
            referencedRelation: "my_listings"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      scoring_versions: {
        Row: {
          description: string | null
          factor_definitions: Json | null
          is_active: boolean
          released_at: string
          retired_at: string | null
          thresholds: Json
          version: string
          weights: Json
        }
        Insert: {
          description?: string | null
          factor_definitions?: Json | null
          is_active?: boolean
          released_at?: string
          retired_at?: string | null
          thresholds: Json
          version: string
          weights: Json
        }
        Update: {
          description?: string | null
          factor_definitions?: Json | null
          is_active?: boolean
          released_at?: string
          retired_at?: string | null
          thresholds?: Json
          version?: string
          weights?: Json
        }
        Relationships: []
      }
      watchlist: {
        Row: {
          created_at: string
          id: string
          keyword_id: string | null
          memo: string | null
          outcome: string | null
          owner_id: string
          priority: number | null
          product_id: string
          status: string
          status_changed_at: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          keyword_id?: string | null
          memo?: string | null
          outcome?: string | null
          owner_id?: string
          priority?: number | null
          product_id: string
          status?: string
          status_changed_at?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          keyword_id?: string | null
          memo?: string | null
          outcome?: string | null
          owner_id?: string
          priority?: number | null
          product_id?: string
          status?: string
          status_changed_at?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "watchlist_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "v_keyword_latest"
            referencedColumns: ["owner_id", "keyword_id"]
          },
          {
            foreignKeyName: "watchlist_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "watchlist_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: true
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
        ]
      }
      watchlist_events: {
        Row: {
          changed_at: string
          from_status: string | null
          id: number
          note: string | null
          owner_id: string
          to_status: string
          watchlist_id: string
        }
        Insert: {
          changed_at?: string
          from_status?: string | null
          id?: never
          note?: string | null
          owner_id?: string
          to_status: string
          watchlist_id: string
        }
        Update: {
          changed_at?: string
          from_status?: string | null
          id?: never
          note?: string | null
          owner_id?: string
          to_status?: string
          watchlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_events_watchlist_fk"
            columns: ["owner_id", "watchlist_id"]
            isOneToOne: false
            referencedRelation: "watchlist"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
    }
    Views: {
      v_current_scores: {
        Row: {
          calculated_at: string | null
          competition_score: number | null
          conversion_score: number | null
          data_confidence: string | null
          demand_score: number | null
          extra_factor_scores: Json | null
          growth_score: number | null
          id: string | null
          input_refs: Json | null
          is_current: boolean | null
          keyword_id: string | null
          margin_score: number | null
          missing_factors: string[] | null
          owner_id: string | null
          product_id: string | null
          reasons: Json | null
          review_barrier_score: number | null
          sales_score: number | null
          scoring_version: string | null
          stability_score: number | null
          total_score: number | null
          verdict: string | null
          wing_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_scores_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "opportunity_scores_keyword_fk"
            columns: ["owner_id", "keyword_id"]
            isOneToOne: false
            referencedRelation: "v_keyword_latest"
            referencedColumns: ["owner_id", "keyword_id"]
          },
          {
            foreignKeyName: "opportunity_scores_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "opportunity_scores_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
          {
            foreignKeyName: "opportunity_scores_scoring_version_fkey"
            columns: ["scoring_version"]
            isOneToOne: false
            referencedRelation: "scoring_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      v_keyword_latest: {
        Row: {
          ad_bid: number | null
          ad_bid_captured_on: string | null
          ad_bid_confidence: string | null
          ad_bid_source: string | null
          average_price: number | null
          average_price_captured_on: string | null
          average_price_confidence: string | null
          average_price_source: string | null
          average_reviews: number | null
          average_reviews_captured_on: string | null
          average_reviews_confidence: string | null
          average_reviews_source: string | null
          brand_concentration: number | null
          brand_concentration_captured_on: string | null
          brand_concentration_confidence: string | null
          brand_concentration_source: string | null
          category_id: string | null
          competition_intensity: number | null
          competition_intensity_captured_on: string | null
          competition_intensity_confidence: string | null
          competition_intensity_source: string | null
          coupang_product_count: number | null
          coupang_product_count_captured_on: string | null
          coupang_product_count_confidence: string | null
          coupang_product_count_source: string | null
          is_tracking: boolean | null
          keyword: string | null
          keyword_id: string | null
          latest_captured_on: string | null
          normalized_keyword: string | null
          owner_id: string | null
          rocket_ratio: number | null
          rocket_ratio_captured_on: string | null
          rocket_ratio_confidence: string | null
          rocket_ratio_source: string | null
          sample_size: number | null
          sample_size_captured_on: string | null
          sample_size_confidence: string | null
          sample_size_source: string | null
          search_growth_rate: number | null
          search_growth_rate_captured_on: string | null
          search_growth_rate_confidence: string | null
          search_growth_rate_source: string | null
          search_volume: number | null
          search_volume_captured_on: string | null
          search_volume_confidence: string | null
          search_volume_previous: number | null
          search_volume_previous_captured_on: string | null
          search_volume_previous_confidence: string | null
          search_volume_previous_source: string | null
          search_volume_source: string | null
          snapshot_count: number | null
          wing_ratio: number | null
          wing_ratio_captured_on: string | null
          wing_ratio_confidence: string | null
          wing_ratio_source: string | null
        }
        Relationships: [
          {
            foreignKeyName: "keywords_category_fk"
            columns: ["owner_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      v_prediction_vs_actual: {
        Row: {
          coverage_days: number | null
          is_complete: boolean | null
          listing_id: string | null
          model_version: string | null
          net_margin_actual: number | null
          net_margin_predicted: number | null
          net_profit_abs_error: number | null
          net_profit_actual: number | null
          net_profit_error: number | null
          net_profit_error_rate: number | null
          net_profit_predicted: number | null
          opportunity_score_id: string | null
          owner_id: string | null
          period_type: string | null
          predicted_at: string | null
          prediction_id: string | null
          product_id: string | null
          result_rows: number | null
          revenue_abs_error: number | null
          revenue_actual: number | null
          revenue_error: number | null
          revenue_error_rate: number | null
          revenue_predicted: number | null
          sales_abs_error: number | null
          sales_actual: number | null
          sales_error: number | null
          sales_error_rate: number | null
          sales_predicted: number | null
          source_type: string | null
          target_days: number | null
          target_period_end: string | null
          target_period_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "predictions_listing_fk"
            columns: ["owner_id", "listing_id"]
            isOneToOne: false
            referencedRelation: "my_listings"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "predictions_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "predictions_product_fk"
            columns: ["owner_id", "product_id"]
            isOneToOne: false
            referencedRelation: "v_product_latest"
            referencedColumns: ["owner_id", "product_id"]
          },
          {
            foreignKeyName: "predictions_score_fk"
            columns: ["owner_id", "opportunity_score_id"]
            isOneToOne: false
            referencedRelation: "opportunity_scores"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "predictions_score_fk"
            columns: ["owner_id", "opportunity_score_id"]
            isOneToOne: false
            referencedRelation: "v_current_scores"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      v_product_latest: {
        Row: {
          brand: string | null
          category_id: string | null
          category_rank: number | null
          category_rank_captured_on: string | null
          category_rank_confidence: string | null
          category_rank_source: string | null
          conversion_rate: number | null
          conversion_rate_captured_on: string | null
          conversion_rate_confidence: string | null
          conversion_rate_source: string | null
          coupang_product_id: string | null
          delivery_type: string | null
          delivery_type_captured_on: string | null
          delivery_type_confidence: string | null
          delivery_type_source: string | null
          discount_rate: number | null
          discount_rate_captured_on: string | null
          discount_rate_confidence: string | null
          discount_rate_source: string | null
          is_coupang_pb: boolean | null
          is_own_product: boolean | null
          last_seen_at: string | null
          latest_captured_on: string | null
          lifecycle_status: string | null
          option_count: number | null
          option_count_captured_on: string | null
          option_count_confidence: string | null
          option_count_source: string | null
          original_price: number | null
          original_price_captured_on: string | null
          original_price_confidence: string | null
          original_price_source: string | null
          owner_id: string | null
          price: number | null
          price_captured_on: string | null
          price_confidence: string | null
          price_source: string | null
          product_id: string | null
          product_name: string | null
          product_name_observed: string | null
          product_name_observed_captured_on: string | null
          product_name_observed_confidence: string | null
          product_name_observed_source: string | null
          rating: number | null
          rating_captured_on: string | null
          rating_confidence: string | null
          rating_source: string | null
          revenue_actual: number | null
          revenue_actual_captured_on: string | null
          revenue_actual_confidence: string | null
          revenue_actual_period_days: number | null
          revenue_actual_source: string | null
          revenue_estimated: number | null
          revenue_estimated_captured_on: string | null
          revenue_estimated_confidence: string | null
          revenue_estimated_period_days: number | null
          revenue_estimated_source: string | null
          review_count: number | null
          review_count_captured_on: string | null
          review_count_confidence: string | null
          review_count_source: string | null
          sales_actual: number | null
          sales_actual_captured_on: string | null
          sales_actual_confidence: string | null
          sales_actual_period_days: number | null
          sales_actual_source: string | null
          sales_estimated: number | null
          sales_estimated_captured_on: string | null
          sales_estimated_confidence: string | null
          sales_estimated_period_days: number | null
          sales_estimated_source: string | null
          seller_type: string | null
          seller_type_observed: string | null
          seller_type_observed_captured_on: string | null
          seller_type_observed_confidence: string | null
          seller_type_observed_source: string | null
          snapshot_count: number | null
          views_28d: number | null
          views_28d_captured_on: string | null
          views_28d_confidence: string | null
          views_28d_source: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_fk"
            columns: ["owner_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
    }
    Functions: {
      confidence_rank: { Args: { conf: string }; Returns: number }
      rollback_import: { Args: { p_job_id: string }; Returns: Json }
      source_priority: { Args: { src: string }; Returns: number }
      upsert_keyword_snapshot: { Args: { p: Json }; Returns: Json }
      upsert_product_snapshot: { Args: { p: Json }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
