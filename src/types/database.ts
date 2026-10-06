// ⚠️ 자동 생성 파일 — 직접 수정하지 않는다.
// 생성: npm run db:types:local (scripts/db/gen-types.mjs, supabase/migrations 기준)
// Supabase 프로젝트 연결 후에는 npm run db:types (supabase gen types) 결과로 교체한다. 모양은 동일하다.
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
  public: {
    Tables: {
      categories: {
        Row: {
          id: string
          owner_id: string
          coupang_category_id: string | null
          name: string
          parent_id: string | null
          depth: number | null
          path: string | null
          coupang_fee_rate: number | null
          is_active: boolean
          source_type: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          coupang_category_id?: string | null
          name: string
          parent_id?: string | null
          depth?: number | null
          path?: string | null
          coupang_fee_rate?: number | null
          is_active?: boolean
          source_type: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          coupang_category_id?: string | null
          name?: string
          parent_id?: string | null
          depth?: number | null
          path?: string | null
          coupang_fee_rate?: number | null
          is_active?: boolean
          source_type?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_fk"
            columns: ["owner_id","parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      competitors: {
        Row: {
          id: string
          owner_id: string
          product_id: string
          competitor_product_id: string
          keyword_id: string | null
          relation_type: string
          source_type: string
          memo: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          product_id: string
          competitor_product_id: string
          keyword_id?: string | null
          relation_type: string
          source_type: string
          memo?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          product_id?: string
          competitor_product_id?: string
          keyword_id?: string | null
          relation_type?: string
          source_type?: string
          memo?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitors_competitor_product_fk"
            columns: ["owner_id","competitor_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "competitors_keyword_fk"
            columns: ["owner_id","keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "competitors_product_fk"
            columns: ["owner_id","product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          id: string
          owner_id: string
          channel: string
          import_type: string
          source_type: string
          source_tool: string | null
          file_name: string | null
          file_size_bytes: number | null
          file_hash: string | null
          storage_path: string | null
          idempotency_key: string | null
          schema_version: string | null
          column_mapping: Json | null
          dry_run: boolean
          status: string
          total_rows: number
          inserted_rows: number
          updated_rows: number
          skipped_rows: number
          failed_rows: number
          error_summary: string | null
          started_at: string | null
          finished_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          channel: string
          import_type: string
          source_type: string
          source_tool?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_hash?: string | null
          storage_path?: string | null
          idempotency_key?: string | null
          schema_version?: string | null
          column_mapping?: Json | null
          dry_run?: boolean
          status?: string
          total_rows?: number
          inserted_rows?: number
          updated_rows?: number
          skipped_rows?: number
          failed_rows?: number
          error_summary?: string | null
          started_at?: string | null
          finished_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          channel?: string
          import_type?: string
          source_type?: string
          source_tool?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_hash?: string | null
          storage_path?: string | null
          idempotency_key?: string | null
          schema_version?: string | null
          column_mapping?: Json | null
          dry_run?: boolean
          status?: string
          total_rows?: number
          inserted_rows?: number
          updated_rows?: number
          skipped_rows?: number
          failed_rows?: number
          error_summary?: string | null
          started_at?: string | null
          finished_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      import_rows: {
        Row: {
          id: number
          owner_id: string
          import_job_id: string
          row_number: number
          record_key: string | null
          payload: Json
          result: string
          target_table: string | null
          target_id: string | null
          previous_values: Json | null
          error_code: string | null
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: never
          owner_id?: string
          import_job_id: string
          row_number: number
          record_key?: string | null
          payload: Json
          result?: string
          target_table?: string | null
          target_id?: string | null
          previous_values?: Json | null
          error_code?: string | null
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: never
          owner_id?: string
          import_job_id?: string
          row_number?: number
          record_key?: string | null
          payload?: Json
          result?: string
          target_table?: string | null
          target_id?: string | null
          previous_values?: Json | null
          error_code?: string | null
          error_message?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_job_fk"
            columns: ["owner_id","import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      keyword_product_ranks: {
        Row: {
          id: number
          owner_id: string
          keyword_id: string
          product_id: string
          captured_on: string
          captured_at: string
          source_type: string
          confidence: string
          rank_position: number
          is_ad: boolean
          page: number | null
          import_job_id: string | null
          created_at: string
        }
        Insert: {
          id?: never
          owner_id?: string
          keyword_id: string
          product_id: string
          captured_on: string
          captured_at: string
          source_type: string
          confidence: string
          rank_position: number
          is_ad?: boolean
          page?: number | null
          import_job_id?: string | null
          created_at?: string
        }
        Update: {
          id?: never
          owner_id?: string
          keyword_id?: string
          product_id?: string
          captured_on?: string
          captured_at?: string
          source_type?: string
          confidence?: string
          rank_position?: number
          is_ad?: boolean
          page?: number | null
          import_job_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "keyword_product_ranks_import_job_fk"
            columns: ["owner_id","import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "keyword_product_ranks_keyword_fk"
            columns: ["owner_id","keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "keyword_product_ranks_product_fk"
            columns: ["owner_id","product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      keyword_snapshots: {
        Row: {
          id: number
          owner_id: string
          keyword_id: string
          captured_on: string
          captured_at: string
          source_type: string
          confidence: string
          search_volume: number | null
          search_volume_previous: number | null
          search_growth_rate: number | null
          coupang_product_count: number | null
          competition_intensity: number | null
          wing_ratio: number | null
          rocket_ratio: number | null
          average_price: number | null
          average_reviews: number | null
          brand_concentration: number | null
          sample_size: number | null
          ad_bid: number | null
          metric_meta: Json
          import_job_id: string | null
          is_excluded: boolean
          excluded_reason: string | null
          created_at: string
        }
        Insert: {
          id?: never
          owner_id?: string
          keyword_id: string
          captured_on: string
          captured_at: string
          source_type: string
          confidence: string
          search_volume?: number | null
          search_volume_previous?: number | null
          search_growth_rate?: number | null
          coupang_product_count?: number | null
          competition_intensity?: number | null
          wing_ratio?: number | null
          rocket_ratio?: number | null
          average_price?: number | null
          average_reviews?: number | null
          brand_concentration?: number | null
          sample_size?: number | null
          ad_bid?: number | null
          metric_meta?: Json
          import_job_id?: string | null
          is_excluded?: boolean
          excluded_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: never
          owner_id?: string
          keyword_id?: string
          captured_on?: string
          captured_at?: string
          source_type?: string
          confidence?: string
          search_volume?: number | null
          search_volume_previous?: number | null
          search_growth_rate?: number | null
          coupang_product_count?: number | null
          competition_intensity?: number | null
          wing_ratio?: number | null
          rocket_ratio?: number | null
          average_price?: number | null
          average_reviews?: number | null
          brand_concentration?: number | null
          sample_size?: number | null
          ad_bid?: number | null
          metric_meta?: Json
          import_job_id?: string | null
          is_excluded?: boolean
          excluded_reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "keyword_snapshots_import_job_fk"
            columns: ["owner_id","import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "keyword_snapshots_keyword_fk"
            columns: ["owner_id","keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      keywords: {
        Row: {
          id: string
          owner_id: string
          keyword: string
          normalized_keyword: string
          category_id: string | null
          is_tracking: boolean
          memo: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          keyword: string
          normalized_keyword: string
          category_id?: string | null
          is_tracking?: boolean
          memo?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          keyword?: string
          normalized_keyword?: string
          category_id?: string | null
          is_tracking?: boolean
          memo?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "keywords_category_fk"
            columns: ["owner_id","category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      my_listings: {
        Row: {
          id: string
          owner_id: string
          watchlist_id: string | null
          reference_product_id: string
          own_product_id: string | null
          listing_name: string
          sku: string | null
          channel: string
          fulfillment_type: string | null
          status: string
          launch_date: string | null
          ended_on: string | null
          baseline_score_id: string | null
          baseline_profit_calc_id: string | null
          memo: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          watchlist_id?: string | null
          reference_product_id: string
          own_product_id?: string | null
          listing_name: string
          sku?: string | null
          channel?: string
          fulfillment_type?: string | null
          status?: string
          launch_date?: string | null
          ended_on?: string | null
          baseline_score_id?: string | null
          baseline_profit_calc_id?: string | null
          memo?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          watchlist_id?: string | null
          reference_product_id?: string
          own_product_id?: string | null
          listing_name?: string
          sku?: string | null
          channel?: string
          fulfillment_type?: string | null
          status?: string
          launch_date?: string | null
          ended_on?: string | null
          baseline_score_id?: string | null
          baseline_profit_calc_id?: string | null
          memo?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "my_listings_baseline_profit_calc_fk"
            columns: ["owner_id","baseline_profit_calc_id"]
            isOneToOne: false
            referencedRelation: "profit_calculations"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "my_listings_baseline_score_fk"
            columns: ["owner_id","baseline_score_id"]
            isOneToOne: false
            referencedRelation: "opportunity_scores"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "my_listings_own_product_fk"
            columns: ["owner_id","own_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "my_listings_reference_product_fk"
            columns: ["owner_id","reference_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "my_listings_watchlist_fk"
            columns: ["owner_id","watchlist_id"]
            isOneToOne: false
            referencedRelation: "watchlist"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      opportunity_scores: {
        Row: {
          id: string
          owner_id: string
          product_id: string
          keyword_id: string | null
          scoring_version: string
          total_score: number
          demand_score: number | null
          sales_score: number | null
          growth_score: number | null
          competition_score: number | null
          wing_score: number | null
          review_barrier_score: number | null
          conversion_score: number | null
          margin_score: number | null
          stability_score: number | null
          extra_factor_scores: Json
          verdict: string
          data_confidence: string | null
          missing_factors: string[] | null
          reasons: Json
          input_refs: Json
          is_current: boolean
          calculated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          product_id: string
          keyword_id?: string | null
          scoring_version: string
          total_score: number
          demand_score?: number | null
          sales_score?: number | null
          growth_score?: number | null
          competition_score?: number | null
          wing_score?: number | null
          review_barrier_score?: number | null
          conversion_score?: number | null
          margin_score?: number | null
          stability_score?: number | null
          extra_factor_scores?: Json
          verdict: string
          data_confidence?: string | null
          missing_factors?: string[] | null
          reasons?: Json
          input_refs: Json
          is_current?: boolean
          calculated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          product_id?: string
          keyword_id?: string | null
          scoring_version?: string
          total_score?: number
          demand_score?: number | null
          sales_score?: number | null
          growth_score?: number | null
          competition_score?: number | null
          wing_score?: number | null
          review_barrier_score?: number | null
          conversion_score?: number | null
          margin_score?: number | null
          stability_score?: number | null
          extra_factor_scores?: Json
          verdict?: string
          data_confidence?: string | null
          missing_factors?: string[] | null
          reasons?: Json
          input_refs?: Json
          is_current?: boolean
          calculated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_scores_keyword_fk"
            columns: ["owner_id","keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "opportunity_scores_product_fk"
            columns: ["owner_id","product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
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
          id: string
          owner_id: string
          product_id: string
          listing_id: string | null
          opportunity_score_id: string | null
          profit_calculation_id: string | null
          model_version: string
          predicted_at: string
          target_period_start: string
          target_period_end: string
          sales_predicted: number | null
          revenue_predicted: number | null
          net_profit_predicted: number | null
          net_margin_predicted: number | null
          assumptions: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          product_id: string
          listing_id?: string | null
          opportunity_score_id?: string | null
          profit_calculation_id?: string | null
          model_version: string
          predicted_at?: string
          target_period_start: string
          target_period_end: string
          sales_predicted?: number | null
          revenue_predicted?: number | null
          net_profit_predicted?: number | null
          net_margin_predicted?: number | null
          assumptions?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          product_id?: string
          listing_id?: string | null
          opportunity_score_id?: string | null
          profit_calculation_id?: string | null
          model_version?: string
          predicted_at?: string
          target_period_start?: string
          target_period_end?: string
          sales_predicted?: number | null
          revenue_predicted?: number | null
          net_profit_predicted?: number | null
          net_margin_predicted?: number | null
          assumptions?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_listing_fk"
            columns: ["owner_id","listing_id"]
            isOneToOne: false
            referencedRelation: "my_listings"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "predictions_product_fk"
            columns: ["owner_id","product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "predictions_profit_calc_fk"
            columns: ["owner_id","profit_calculation_id"]
            isOneToOne: false
            referencedRelation: "profit_calculations"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "predictions_score_fk"
            columns: ["owner_id","opportunity_score_id"]
            isOneToOne: false
            referencedRelation: "opportunity_scores"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      product_risks: {
        Row: {
          id: string
          owner_id: string
          product_id: string
          opportunity_score_id: string | null
          risk_type: string
          risk_level: string
          description: string
          evidence: Json | null
          source_type: string
          is_active: boolean
          detected_at: string
          resolved_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          product_id: string
          opportunity_score_id?: string | null
          risk_type: string
          risk_level: string
          description: string
          evidence?: Json | null
          source_type: string
          is_active?: boolean
          detected_at?: string
          resolved_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          product_id?: string
          opportunity_score_id?: string | null
          risk_type?: string
          risk_level?: string
          description?: string
          evidence?: Json | null
          source_type?: string
          is_active?: boolean
          detected_at?: string
          resolved_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_risks_product_fk"
            columns: ["owner_id","product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "product_risks_score_fk"
            columns: ["owner_id","product_id","opportunity_score_id"]
            isOneToOne: false
            referencedRelation: "opportunity_scores"
            referencedColumns: ["owner_id","product_id","id"]
          },
        ]
      }
      product_snapshots: {
        Row: {
          id: number
          owner_id: string
          product_id: string
          captured_on: string
          captured_at: string
          source_type: string
          confidence: string
          product_name_observed: string | null
          price: number | null
          original_price: number | null
          discount_rate: number | null
          delivery_type: string | null
          seller_type_observed: string | null
          review_count: number | null
          rating: number | null
          category_rank: number | null
          option_count: number | null
          views_28d: number | null
          sales_period_days: number | null
          sales_actual: number | null
          sales_estimated: number | null
          revenue_actual: number | null
          revenue_estimated: number | null
          conversion_rate: number | null
          metric_meta: Json
          import_job_id: string | null
          is_excluded: boolean
          excluded_reason: string | null
          created_at: string
        }
        Insert: {
          id?: never
          owner_id?: string
          product_id: string
          captured_on: string
          captured_at: string
          source_type: string
          confidence: string
          product_name_observed?: string | null
          price?: number | null
          original_price?: number | null
          discount_rate?: number | null
          delivery_type?: string | null
          seller_type_observed?: string | null
          review_count?: number | null
          rating?: number | null
          category_rank?: number | null
          option_count?: number | null
          views_28d?: number | null
          sales_period_days?: number | null
          sales_actual?: number | null
          sales_estimated?: number | null
          revenue_actual?: number | null
          revenue_estimated?: number | null
          conversion_rate?: number | null
          metric_meta?: Json
          import_job_id?: string | null
          is_excluded?: boolean
          excluded_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: never
          owner_id?: string
          product_id?: string
          captured_on?: string
          captured_at?: string
          source_type?: string
          confidence?: string
          product_name_observed?: string | null
          price?: number | null
          original_price?: number | null
          discount_rate?: number | null
          delivery_type?: string | null
          seller_type_observed?: string | null
          review_count?: number | null
          rating?: number | null
          category_rank?: number | null
          option_count?: number | null
          views_28d?: number | null
          sales_period_days?: number | null
          sales_actual?: number | null
          sales_estimated?: number | null
          revenue_actual?: number | null
          revenue_estimated?: number | null
          conversion_rate?: number | null
          metric_meta?: Json
          import_job_id?: string | null
          is_excluded?: boolean
          excluded_reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_snapshots_import_job_fk"
            columns: ["owner_id","import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "product_snapshots_product_fk"
            columns: ["owner_id","product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      products: {
        Row: {
          id: string
          owner_id: string
          coupang_product_id: string
          coupang_item_id: string | null
          coupang_vendor_item_id: string | null
          product_url: string | null
          product_name: string
          brand: string | null
          category_id: string | null
          seller_type: string | null
          option_count: number | null
          is_coupang_pb: boolean | null
          is_own_product: boolean
          lifecycle_status: string
          first_seen_at: string
          last_seen_at: string
          deleted_detected_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          coupang_product_id: string
          coupang_item_id?: string | null
          coupang_vendor_item_id?: string | null
          product_url?: string | null
          product_name: string
          brand?: string | null
          category_id?: string | null
          seller_type?: string | null
          option_count?: number | null
          is_coupang_pb?: boolean | null
          is_own_product?: boolean
          lifecycle_status?: string
          first_seen_at?: string
          last_seen_at?: string
          deleted_detected_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          coupang_product_id?: string
          coupang_item_id?: string | null
          coupang_vendor_item_id?: string | null
          product_url?: string | null
          product_name?: string
          brand?: string | null
          category_id?: string | null
          seller_type?: string | null
          option_count?: number | null
          is_coupang_pb?: boolean | null
          is_own_product?: boolean
          lifecycle_status?: string
          first_seen_at?: string
          last_seen_at?: string
          deleted_detected_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_fk"
            columns: ["owner_id","category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      profit_calculations: {
        Row: {
          id: string
          owner_id: string
          scenario_id: string
          product_id: string
          formula_version: string
          inputs_snapshot: Json
          unit_cost_krw: number | null
          coupang_fee_amount: number | null
          ad_cost_amount: number | null
          total_cost_per_unit: number | null
          net_profit_per_unit: number | null
          net_margin_rate: number | null
          roi: number | null
          break_even_units: number | null
          monthly_net_profit: number | null
          is_current: boolean
          calculated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          scenario_id: string
          product_id: string
          formula_version: string
          inputs_snapshot: Json
          unit_cost_krw?: number | null
          coupang_fee_amount?: number | null
          ad_cost_amount?: number | null
          total_cost_per_unit?: number | null
          net_profit_per_unit?: number | null
          net_margin_rate?: number | null
          roi?: number | null
          break_even_units?: number | null
          monthly_net_profit?: number | null
          is_current?: boolean
          calculated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          scenario_id?: string
          product_id?: string
          formula_version?: string
          inputs_snapshot?: Json
          unit_cost_krw?: number | null
          coupang_fee_amount?: number | null
          ad_cost_amount?: number | null
          total_cost_per_unit?: number | null
          net_profit_per_unit?: number | null
          net_margin_rate?: number | null
          roi?: number | null
          break_even_units?: number | null
          monthly_net_profit?: number | null
          is_current?: boolean
          calculated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profit_calculations_product_fk"
            columns: ["owner_id","product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "profit_calculations_scenario_fk"
            columns: ["owner_id","product_id","scenario_id"]
            isOneToOne: false
            referencedRelation: "profit_scenarios"
            referencedColumns: ["owner_id","product_id","id"]
          },
        ]
      }
      profit_scenarios: {
        Row: {
          id: string
          owner_id: string
          product_id: string
          name: string
          is_primary: boolean
          sale_price: number | null
          vat_included: boolean
          unit_cost_amount: number | null
          unit_cost_currency: string
          exchange_rate: number
          intl_shipping_per_unit: number | null
          domestic_shipping_per_unit: number | null
          coupang_fee_rate: number | null
          logistics_fee_per_unit: number | null
          ad_cost_rate: number | null
          ad_cost_per_unit: number | null
          other_cost_per_unit: number | null
          fixed_cost_total: number | null
          expected_monthly_units: number | null
          source_type: string
          confidence: string
          memo: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          product_id: string
          name?: string
          is_primary?: boolean
          sale_price?: number | null
          vat_included?: boolean
          unit_cost_amount?: number | null
          unit_cost_currency?: string
          exchange_rate?: number
          intl_shipping_per_unit?: number | null
          domestic_shipping_per_unit?: number | null
          coupang_fee_rate?: number | null
          logistics_fee_per_unit?: number | null
          ad_cost_rate?: number | null
          ad_cost_per_unit?: number | null
          other_cost_per_unit?: number | null
          fixed_cost_total?: number | null
          expected_monthly_units?: number | null
          source_type?: string
          confidence?: string
          memo?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          product_id?: string
          name?: string
          is_primary?: boolean
          sale_price?: number | null
          vat_included?: boolean
          unit_cost_amount?: number | null
          unit_cost_currency?: string
          exchange_rate?: number
          intl_shipping_per_unit?: number | null
          domestic_shipping_per_unit?: number | null
          coupang_fee_rate?: number | null
          logistics_fee_per_unit?: number | null
          ad_cost_rate?: number | null
          ad_cost_per_unit?: number | null
          other_cost_per_unit?: number | null
          fixed_cost_total?: number | null
          expected_monthly_units?: number | null
          source_type?: string
          confidence?: string
          memo?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profit_scenarios_product_fk"
            columns: ["owner_id","product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      sales_results: {
        Row: {
          id: number
          owner_id: string
          listing_id: string
          period_type: string
          period_start: string
          period_end: string
          units_sold: number | null
          returned_units: number | null
          gross_revenue: number | null
          ad_spend: number | null
          cogs: number | null
          logistics_cost: number | null
          coupang_fees: number | null
          other_costs: number | null
          net_profit: number | null
          net_margin_rate: number | null
          source_type: string
          confidence: string
          import_job_id: string | null
          memo: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: never
          owner_id?: string
          listing_id: string
          period_type: string
          period_start: string
          period_end: string
          units_sold?: number | null
          returned_units?: number | null
          gross_revenue?: number | null
          ad_spend?: number | null
          cogs?: number | null
          logistics_cost?: number | null
          coupang_fees?: number | null
          other_costs?: number | null
          net_profit?: never
          net_margin_rate?: never
          source_type: string
          confidence: string
          import_job_id?: string | null
          memo?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: never
          owner_id?: string
          listing_id?: string
          period_type?: string
          period_start?: string
          period_end?: string
          units_sold?: number | null
          returned_units?: number | null
          gross_revenue?: number | null
          ad_spend?: number | null
          cogs?: number | null
          logistics_cost?: number | null
          coupang_fees?: number | null
          other_costs?: number | null
          net_profit?: never
          net_margin_rate?: never
          source_type?: string
          confidence?: string
          import_job_id?: string | null
          memo?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_results_import_job_fk"
            columns: ["owner_id","import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "sales_results_listing_fk"
            columns: ["owner_id","listing_id"]
            isOneToOne: false
            referencedRelation: "my_listings"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      scoring_versions: {
        Row: {
          version: string
          weights: Json
          thresholds: Json
          factor_definitions: Json | null
          description: string | null
          is_active: boolean
          released_at: string
          retired_at: string | null
        }
        Insert: {
          version: string
          weights: Json
          thresholds: Json
          factor_definitions?: Json | null
          description?: string | null
          is_active?: boolean
          released_at?: string
          retired_at?: string | null
        }
        Update: {
          version?: string
          weights?: Json
          thresholds?: Json
          factor_definitions?: Json | null
          description?: string | null
          is_active?: boolean
          released_at?: string
          retired_at?: string | null
        }
        Relationships: []
      }
      watchlist: {
        Row: {
          id: string
          owner_id: string
          product_id: string
          keyword_id: string | null
          status: string
          outcome: string | null
          memo: string | null
          priority: number | null
          tags: string[]
          status_changed_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id?: string
          product_id: string
          keyword_id?: string | null
          status?: string
          outcome?: string | null
          memo?: string | null
          priority?: number | null
          tags?: string[]
          status_changed_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          product_id?: string
          keyword_id?: string | null
          status?: string
          outcome?: string | null
          memo?: string | null
          priority?: number | null
          tags?: string[]
          status_changed_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_keyword_fk"
            columns: ["owner_id","keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["owner_id","id"]
          },
          {
            foreignKeyName: "watchlist_product_fk"
            columns: ["owner_id","product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
      watchlist_events: {
        Row: {
          id: number
          owner_id: string
          watchlist_id: string
          from_status: string | null
          to_status: string
          note: string | null
          changed_at: string
        }
        Insert: {
          id?: never
          owner_id?: string
          watchlist_id: string
          from_status?: string | null
          to_status: string
          note?: string | null
          changed_at?: string
        }
        Update: {
          id?: never
          owner_id?: string
          watchlist_id?: string
          from_status?: string | null
          to_status?: string
          note?: string | null
          changed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_events_watchlist_fk"
            columns: ["owner_id","watchlist_id"]
            isOneToOne: false
            referencedRelation: "watchlist"
            referencedColumns: ["owner_id","id"]
          },
        ]
      }
    }
    Views: {
      v_current_scores: {
        Row: {
          id: string | null
          owner_id: string | null
          product_id: string | null
          keyword_id: string | null
          scoring_version: string | null
          total_score: number | null
          demand_score: number | null
          sales_score: number | null
          growth_score: number | null
          competition_score: number | null
          wing_score: number | null
          review_barrier_score: number | null
          conversion_score: number | null
          margin_score: number | null
          stability_score: number | null
          extra_factor_scores: Json | null
          verdict: string | null
          data_confidence: string | null
          missing_factors: string[] | null
          reasons: Json | null
          input_refs: Json | null
          is_current: boolean | null
          calculated_at: string | null
        }
        Relationships: []
      }
      v_keyword_latest: {
        Row: {
          keyword_id: string | null
          owner_id: string | null
          keyword: string | null
          normalized_keyword: string | null
          category_id: string | null
          is_tracking: boolean | null
          snapshot_count: number | null
          latest_captured_on: string | null
          search_volume: number | null
          search_volume_source: string | null
          search_volume_confidence: string | null
          search_volume_captured_on: string | null
          search_volume_previous: number | null
          search_volume_previous_source: string | null
          search_volume_previous_confidence: string | null
          search_volume_previous_captured_on: string | null
          search_growth_rate: number | null
          search_growth_rate_source: string | null
          search_growth_rate_confidence: string | null
          search_growth_rate_captured_on: string | null
          coupang_product_count: number | null
          coupang_product_count_source: string | null
          coupang_product_count_confidence: string | null
          coupang_product_count_captured_on: string | null
          competition_intensity: number | null
          competition_intensity_source: string | null
          competition_intensity_confidence: string | null
          competition_intensity_captured_on: string | null
          wing_ratio: number | null
          wing_ratio_source: string | null
          wing_ratio_confidence: string | null
          wing_ratio_captured_on: string | null
          rocket_ratio: number | null
          rocket_ratio_source: string | null
          rocket_ratio_confidence: string | null
          rocket_ratio_captured_on: string | null
          average_price: number | null
          average_price_source: string | null
          average_price_confidence: string | null
          average_price_captured_on: string | null
          average_reviews: number | null
          average_reviews_source: string | null
          average_reviews_confidence: string | null
          average_reviews_captured_on: string | null
          brand_concentration: number | null
          brand_concentration_source: string | null
          brand_concentration_confidence: string | null
          brand_concentration_captured_on: string | null
          sample_size: number | null
          sample_size_source: string | null
          sample_size_confidence: string | null
          sample_size_captured_on: string | null
          ad_bid: number | null
          ad_bid_source: string | null
          ad_bid_confidence: string | null
          ad_bid_captured_on: string | null
        }
        Relationships: []
      }
      v_prediction_vs_actual: {
        Row: {
          prediction_id: string | null
          owner_id: string | null
          product_id: string | null
          listing_id: string | null
          opportunity_score_id: string | null
          model_version: string | null
          predicted_at: string | null
          target_period_start: string | null
          target_period_end: string | null
          target_days: number | null
          period_type: string | null
          source_type: string | null
          result_rows: number | null
          coverage_days: number | null
          is_complete: boolean | null
          sales_predicted: number | null
          sales_actual: number | null
          sales_error: number | null
          sales_abs_error: number | null
          sales_error_rate: number | null
          revenue_predicted: number | null
          revenue_actual: number | null
          revenue_error: number | null
          revenue_abs_error: number | null
          revenue_error_rate: number | null
          net_profit_predicted: number | null
          net_profit_actual: number | null
          net_profit_error: number | null
          net_profit_abs_error: number | null
          net_profit_error_rate: number | null
          net_margin_predicted: number | null
          net_margin_actual: number | null
        }
        Relationships: []
      }
      v_product_latest: {
        Row: {
          product_id: string | null
          owner_id: string | null
          coupang_product_id: string | null
          product_name: string | null
          brand: string | null
          category_id: string | null
          seller_type: string | null
          is_coupang_pb: boolean | null
          is_own_product: boolean | null
          lifecycle_status: string | null
          last_seen_at: string | null
          snapshot_count: number | null
          latest_captured_on: string | null
          product_name_observed: string | null
          product_name_observed_source: string | null
          product_name_observed_confidence: string | null
          product_name_observed_captured_on: string | null
          price: number | null
          price_source: string | null
          price_confidence: string | null
          price_captured_on: string | null
          original_price: number | null
          original_price_source: string | null
          original_price_confidence: string | null
          original_price_captured_on: string | null
          discount_rate: number | null
          discount_rate_source: string | null
          discount_rate_confidence: string | null
          discount_rate_captured_on: string | null
          delivery_type: string | null
          delivery_type_source: string | null
          delivery_type_confidence: string | null
          delivery_type_captured_on: string | null
          seller_type_observed: string | null
          seller_type_observed_source: string | null
          seller_type_observed_confidence: string | null
          seller_type_observed_captured_on: string | null
          review_count: number | null
          review_count_source: string | null
          review_count_confidence: string | null
          review_count_captured_on: string | null
          rating: number | null
          rating_source: string | null
          rating_confidence: string | null
          rating_captured_on: string | null
          category_rank: number | null
          category_rank_source: string | null
          category_rank_confidence: string | null
          category_rank_captured_on: string | null
          option_count: number | null
          option_count_source: string | null
          option_count_confidence: string | null
          option_count_captured_on: string | null
          views_28d: number | null
          views_28d_source: string | null
          views_28d_confidence: string | null
          views_28d_captured_on: string | null
          sales_actual: number | null
          sales_actual_source: string | null
          sales_actual_confidence: string | null
          sales_actual_captured_on: string | null
          sales_actual_period_days: number | null
          sales_estimated: number | null
          sales_estimated_source: string | null
          sales_estimated_confidence: string | null
          sales_estimated_captured_on: string | null
          sales_estimated_period_days: number | null
          revenue_actual: number | null
          revenue_actual_source: string | null
          revenue_actual_confidence: string | null
          revenue_actual_captured_on: string | null
          revenue_actual_period_days: number | null
          revenue_estimated: number | null
          revenue_estimated_source: string | null
          revenue_estimated_confidence: string | null
          revenue_estimated_captured_on: string | null
          revenue_estimated_period_days: number | null
          conversion_rate: number | null
          conversion_rate_source: string | null
          conversion_rate_confidence: string | null
          conversion_rate_captured_on: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      confidence_rank: {
        Args: {
          conf: string
        }
        Returns: number
      }
      rollback_import: {
        Args: {
          p_job_id: string
        }
        Returns: Json
      }
      source_priority: {
        Args: {
          src: string
        }
        Returns: number
      }
      upsert_keyword_snapshot: {
        Args: {
          p: Json
        }
        Returns: Json
      }
      upsert_product_snapshot: {
        Args: {
          p: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"] | keyof PublicSchema["Views"]> = (PublicSchema["Tables"] &
  PublicSchema["Views"])[T]["Row"]

export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
