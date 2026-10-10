export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  analytics: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      daily_funnel_metrics: {
        Row: {
          active_players: number | null
          active_to_run_rate: number | null
          date: string | null
          game_id: string | null
          game_name: string | null
          game_slug: string | null
          repeat_run_players: number | null
          run_start_players: number | null
          run_to_repeat_rate: number | null
          run_to_success_rate: number | null
          run_to_terminal_rate: number | null
          session_start_players: number | null
          success_players: number | null
          terminal_run_players: number | null
        }
        Relationships: []
      }
      daily_game_metrics: {
        Row: {
          active_players: number | null
          avg_closed_session_duration_sec: number | null
          avg_run_duration_sec: number | null
          avg_score: number | null
          closed_sessions: number | null
          date: string | null
          exited_runs: number | null
          failed_runs: number | null
          game_id: string | null
          game_name: string | null
          game_slug: string | null
          new_players: number | null
          open_runs: number | null
          repeat_player_rate: number | null
          repeat_run_players: number | null
          run_players: number | null
          runs: number | null
          sessions: number | null
          successful_runs: number | null
        }
        Relationships: []
      }
      event_contract_coverage_v1: {
        Row: {
          coverage_pct: number | null
          events_mapped: number | null
          events_total: number | null
          events_unmapped: number | null
          game_slug: string | null
          raw_event_types: number | null
          unmapped_event_types: number | null
        }
        Relationships: []
      }
      normalized_game_events_v1: {
        Row: {
          build_id: string | null
          canonical_event: string | null
          category: string | null
          combo: number | null
          created_at: string | null
          event_version: number | null
          game_id: string | null
          game_session_id: string | null
          game_slug: string | null
          id: number | null
          lifecycle_signal: string | null
          metadata: Json | null
          metric_role: string | null
          player_id: string | null
          raw_event_type: string | null
          run_id: string | null
          score: number | null
          stage_id: number | null
          stars: number | null
          status: string | null
        }
        Relationships: []
      }
      player_activity_days: {
        Row: {
          activity_date: string | null
          game_id: string | null
          game_name: string | null
          game_slug: string | null
          player_id: string | null
        }
        Relationships: []
      }
      retention_cohorts: {
        Row: {
          cohort_date: string | null
          cohort_size: number | null
          d1_retention: number | null
          d1_returners: number | null
          d14_retention: number | null
          d14_returners: number | null
          d3_retention: number | null
          d3_returners: number | null
          d30_retention: number | null
          d30_returners: number | null
          d7_retention: number | null
          d7_returners: number | null
          game_id: string | null
          game_name: string | null
          game_slug: string | null
        }
        Relationships: []
      }
      run_facts: {
        Row: {
          activity_date: string | null
          build_id: string | null
          duration_ms: number | null
          ended_at: string | null
          game_id: string | null
          game_name: string | null
          game_session_id: string | null
          game_slug: string | null
          metadata: Json | null
          mode: string | null
          outcome_class: string | null
          player_id: string | null
          result: string | null
          run_id: string | null
          score: number | null
          stage_key: string | null
          started_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  private: {
    Tables: {
      inhagame_member_activity_daily: {
        Row: {
          activity_date_kst: string
          first_seen_at: string
          last_seen_at: string
          surfaces: string[]
          user_id: string
        }
        Insert: {
          activity_date_kst: string
          first_seen_at?: string
          last_seen_at?: string
          surfaces?: string[]
          user_id: string
        }
        Update: {
          activity_date_kst?: string
          first_seen_at?: string
          last_seen_at?: string
          surfaces?: string[]
          user_id?: string
        }
        Relationships: []
      }
      world_activity_attempts: {
        Row: {
          activated_at: string | null
          activity_id: string
          attempt_id: string
          client_attempt_key: string
          created_at: string
          definition_version: number
          expires_at: string | null
          finalized_at: string | null
          outcome_type: string | null
          resolver_version: number
          result_ref: string | null
          source_ref: string
          status: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          activity_id: string
          attempt_id?: string
          client_attempt_key: string
          created_at?: string
          definition_version: number
          expires_at?: string | null
          finalized_at?: string | null
          outcome_type?: string | null
          resolver_version: number
          result_ref?: string | null
          source_ref: string
          status: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          activity_id?: string
          attempt_id?: string
          client_attempt_key?: string
          created_at?: string
          definition_version?: number
          expires_at?: string | null
          finalized_at?: string | null
          outcome_type?: string | null
          resolver_version?: number
          result_ref?: string | null
          source_ref?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      world_appearance_transactions: {
        Row: {
          action: string
          created_at: string
          idempotency_key: string
          next_item_id: string | null
          previous_item_id: string | null
          requested_item_id: string | null
          slot: string
          transaction_id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          idempotency_key: string
          next_item_id?: string | null
          previous_item_id?: string | null
          requested_item_id?: string | null
          slot: string
          transaction_id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          idempotency_key?: string
          next_item_id?: string | null
          previous_item_id?: string | null
          requested_item_id?: string | null
          slot?: string
          transaction_id?: string
          user_id?: string
        }
        Relationships: []
      }
      world_attendance_days: {
        Row: {
          attendance_date: string
          claimed_at: string
          daily_reward_transaction_id: string
          milestone: number | null
          milestone_reward_transaction_id: string | null
          user_id: string
        }
        Insert: {
          attendance_date: string
          claimed_at?: string
          daily_reward_transaction_id: string
          milestone?: number | null
          milestone_reward_transaction_id?: string | null
          user_id: string
        }
        Update: {
          attendance_date?: string
          claimed_at?: string
          daily_reward_transaction_id?: string
          milestone?: number | null
          milestone_reward_transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_attendance_days_daily_reward_transaction_id_fkey"
            columns: ["daily_reward_transaction_id"]
            isOneToOne: false
            referencedRelation: "world_reward_transactions"
            referencedColumns: ["reward_transaction_id"]
          },
          {
            foreignKeyName: "world_attendance_days_milestone_reward_transaction_id_fkey"
            columns: ["milestone_reward_transaction_id"]
            isOneToOne: false
            referencedRelation: "world_reward_transactions"
            referencedColumns: ["reward_transaction_id"]
          },
        ]
      }
      world_biryong_progress_v1: {
        Row: {
          completed_at: string | null
          discovered_at: string | null
          lore: string[]
          migrated_from_local: boolean
          shouts: number
          step: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          discovered_at?: string | null
          lore?: string[]
          migrated_from_local?: boolean
          shouts?: number
          step?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          discovered_at?: string | null
          lore?: string[]
          migrated_from_local?: boolean
          shouts?: number
          step?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      world_collection_discovery_events: {
        Row: {
          definition_version: number
          discovered_at: string
          discovery_event_id: string
          entry_id: string
          idempotency_key: string
          metadata: Json | null
          result_ref: string | null
          source_ref: string
          source_type: string
          user_id: string
        }
        Insert: {
          definition_version: number
          discovered_at?: string
          discovery_event_id?: string
          entry_id: string
          idempotency_key: string
          metadata?: Json | null
          result_ref?: string | null
          source_ref: string
          source_type: string
          user_id: string
        }
        Update: {
          definition_version?: number
          discovered_at?: string
          discovery_event_id?: string
          entry_id?: string
          idempotency_key?: string
          metadata?: Json | null
          result_ref?: string | null
          source_ref?: string
          source_type?: string
          user_id?: string
        }
        Relationships: []
      }
      world_collection_entry_catalog: {
        Row: {
          category: string
          definition_version: number
          entry_id: string
          owner_domain: string | null
          owner_ref: string | null
          persistence_mode: string
          status: string
        }
        Insert: {
          category: string
          definition_version: number
          entry_id: string
          owner_domain?: string | null
          owner_ref?: string | null
          persistence_mode: string
          status: string
        }
        Update: {
          category?: string
          definition_version?: number
          entry_id?: string
          owner_domain?: string | null
          owner_ref?: string | null
          persistence_mode?: string
          status?: string
        }
        Relationships: []
      }
      world_currencies: {
        Row: {
          created_at: string
          currency_id: string
          display_name: string
        }
        Insert: {
          created_at?: string
          currency_id: string
          display_name: string
        }
        Update: {
          created_at?: string
          currency_id?: string
          display_name?: string
        }
        Relationships: []
      }
      world_currency_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          currency_id: string
          idempotency_key: string
          reason: string | null
          source_id: string
          source_type: string
          transaction_id: string
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          currency_id: string
          idempotency_key: string
          reason?: string | null
          source_id: string
          source_type: string
          transaction_id?: string
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          currency_id?: string
          idempotency_key?: string
          reason?: string | null
          source_id?: string
          source_type?: string
          transaction_id?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_currency_transactions_wallet_fkey"
            columns: ["user_id", "currency_id"]
            isOneToOne: false
            referencedRelation: "world_wallets"
            referencedColumns: ["user_id", "currency_id"]
          },
        ]
      }
      world_daily_quiz_answers: {
        Row: {
          answered_at: string
          correct: boolean
          question_id: string
          question_index: number
          run_id: string
          selected_index: number
        }
        Insert: {
          answered_at?: string
          correct: boolean
          question_id: string
          question_index: number
          run_id: string
          selected_index: number
        }
        Update: {
          answered_at?: string
          correct?: boolean
          question_id?: string
          question_index?: number
          run_id?: string
          selected_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "world_daily_quiz_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "world_daily_quiz_questions"
            referencedColumns: ["question_id"]
          },
          {
            foreignKeyName: "world_daily_quiz_answers_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "world_daily_quiz_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      world_daily_quiz_questions: {
        Row: {
          category: string
          correct_index: number
          created_at: string
          options: Json
          position: number
          prompt: string
          question_id: string
          status: string
          version: number
        }
        Insert: {
          category: string
          correct_index: number
          created_at?: string
          options: Json
          position: number
          prompt: string
          question_id: string
          status?: string
          version?: number
        }
        Update: {
          category?: string
          correct_index?: number
          created_at?: string
          options?: Json
          position?: number
          prompt?: string
          question_id?: string
          status?: string
          version?: number
        }
        Relationships: []
      }
      world_daily_quiz_runs: {
        Row: {
          answered_count: number
          completed_at: string | null
          correct_count: number
          question_ids: string[]
          reward_date: string
          reward_transaction_id: string | null
          run_id: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          answered_count?: number
          completed_at?: string | null
          correct_count?: number
          question_ids: string[]
          reward_date: string
          reward_transaction_id?: string | null
          run_id?: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          answered_count?: number
          completed_at?: string | null
          correct_count?: number
          question_ids?: string[]
          reward_date?: string
          reward_transaction_id?: string | null
          run_id?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_daily_quiz_runs_reward_transaction_id_fkey"
            columns: ["reward_transaction_id"]
            isOneToOne: false
            referencedRelation: "world_reward_transactions"
            referencedColumns: ["reward_transaction_id"]
          },
        ]
      }
      world_event_progress: {
        Row: {
          completed_at: string | null
          event_id: string
          investigated: string[]
          stage: number
          started_at: string
          updated_at: string
          user_id: string
          venue_unlocked_at: string | null
        }
        Insert: {
          completed_at?: string | null
          event_id: string
          investigated?: string[]
          stage: number
          started_at?: string
          updated_at?: string
          user_id: string
          venue_unlocked_at?: string | null
        }
        Update: {
          completed_at?: string | null
          event_id?: string
          investigated?: string[]
          stage?: number
          started_at?: string
          updated_at?: string
          user_id?: string
          venue_unlocked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "world_event_progress_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "world_events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      world_events: {
        Row: {
          created_at: string
          ends_at: string
          event_id: string
          is_disabled: boolean
          starts_at: string
          title: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          event_id: string
          is_disabled?: boolean
          starts_at: string
          title: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          event_id?: string
          is_disabled?: boolean
          starts_at?: string
          title?: string
        }
        Relationships: []
      }
      world_exp_transactions: {
        Row: {
          amount: number
          created_at: string
          exp_after: number
          exp_before: number
          idempotency_key: string
          level_after: number
          level_before: number
          source_id: string
          source_type: string
          transaction_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          exp_after: number
          exp_before: number
          idempotency_key: string
          level_after: number
          level_before: number
          source_id: string
          source_type: string
          transaction_id?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          exp_after?: number
          exp_before?: number
          idempotency_key?: string
          level_after?: number
          level_before?: number
          source_id?: string
          source_type?: string
          transaction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_exp_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "world_player_progression"
            referencedColumns: ["user_id"]
          },
        ]
      }
      world_guestbook_post_log: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          location_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          location_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          location_key?: string
          user_id?: string
        }
        Relationships: []
      }
      world_inventory_mutation_entries: {
        Row: {
          child_idempotency_key: string
          child_ref: string
          direction: string
          item_id: string
          mutation_id: string
          position: number
          quantity: number
          quantity_after: number
          quantity_before: number
        }
        Insert: {
          child_idempotency_key: string
          child_ref: string
          direction: string
          item_id: string
          mutation_id: string
          position: number
          quantity: number
          quantity_after: number
          quantity_before: number
        }
        Update: {
          child_idempotency_key?: string
          child_ref?: string
          direction?: string
          item_id?: string
          mutation_id?: string
          position?: number
          quantity?: number
          quantity_after?: number
          quantity_before?: number
        }
        Relationships: [
          {
            foreignKeyName: "world_inventory_mutation_entries_mutation_id_fkey"
            columns: ["mutation_id"]
            isOneToOne: false
            referencedRelation: "world_inventory_mutations"
            referencedColumns: ["mutation_id"]
          },
        ]
      }
      world_inventory_mutations: {
        Row: {
          created_at: string
          idempotency_key: string
          mutation_id: string
          mutation_type: string
          plan: Json
          source_ref: string
          source_type: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key: string
          mutation_id?: string
          mutation_type: string
          plan: Json
          source_ref: string
          source_type: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          idempotency_key?: string
          mutation_id?: string
          mutation_type?: string
          plan?: Json
          source_ref?: string
          source_type?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      world_item_catalog: {
        Row: {
          category: string
          item_id: string
          max_stack: number | null
          ownership_policy: string
          status: string
        }
        Insert: {
          category: string
          item_id: string
          max_stack?: number | null
          ownership_policy: string
          status: string
        }
        Update: {
          category?: string
          item_id?: string
          max_stack?: number | null
          ownership_policy?: string
          status?: string
        }
        Relationships: []
      }
      world_item_consumptions: {
        Row: {
          consume_id: string
          created_at: string
          item_id: string
          metadata: Json | null
          parent_mutation_id: string | null
          quantity_after: number
          quantity_before: number
          quantity_consumed: number
          quantity_requested: number
          source_ref: string
          source_type: string
          user_id: string
        }
        Insert: {
          consume_id: string
          created_at?: string
          item_id: string
          metadata?: Json | null
          parent_mutation_id?: string | null
          quantity_after: number
          quantity_before: number
          quantity_consumed: number
          quantity_requested: number
          source_ref: string
          source_type: string
          user_id: string
        }
        Update: {
          consume_id?: string
          created_at?: string
          item_id?: string
          metadata?: Json | null
          parent_mutation_id?: string | null
          quantity_after?: number
          quantity_before?: number
          quantity_consumed?: number
          quantity_requested?: number
          source_ref?: string
          source_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_item_consumptions_parent_mutation_id_fkey"
            columns: ["parent_mutation_id"]
            isOneToOne: false
            referencedRelation: "world_inventory_mutations"
            referencedColumns: ["mutation_id"]
          },
        ]
      }
      world_item_grants: {
        Row: {
          acquisition_metadata: Json | null
          created_at: string
          event_id: string | null
          grant_id: string
          item_id: string
          quantity_after: number
          quantity_before: number
          quantity_granted: number
          quantity_requested: number
          result: string
          source_ref: string
          source_type: string
          user_id: string
        }
        Insert: {
          acquisition_metadata?: Json | null
          created_at?: string
          event_id?: string | null
          grant_id: string
          item_id: string
          quantity_after: number
          quantity_before: number
          quantity_granted: number
          quantity_requested: number
          result: string
          source_ref: string
          source_type: string
          user_id: string
        }
        Update: {
          acquisition_metadata?: Json | null
          created_at?: string
          event_id?: string | null
          grant_id?: string
          item_id?: string
          quantity_after?: number
          quantity_before?: number
          quantity_granted?: number
          quantity_requested?: number
          result?: string
          source_ref?: string
          source_type?: string
          user_id?: string
        }
        Relationships: []
      }
      world_landlord_first_clears: {
        Row: {
          event_id: string
          first_cleared_at: string
          run_id: string
          user_id: string
        }
        Insert: {
          event_id: string
          first_cleared_at?: string
          run_id: string
          user_id: string
        }
        Update: {
          event_id?: string
          first_cleared_at?: string
          run_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_landlord_first_clears_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "world_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "world_landlord_first_clears_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "world_landlord_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      world_landlord_runs: {
        Row: {
          deadline_at: string
          ended_at: string | null
          event_id: string
          run_id: string
          started_at: string
          status: string
          survivor_actor_id: string
          user_id: string
          wrong_count: number
        }
        Insert: {
          deadline_at: string
          ended_at?: string | null
          event_id: string
          run_id?: string
          started_at?: string
          status: string
          survivor_actor_id: string
          user_id: string
          wrong_count?: number
        }
        Update: {
          deadline_at?: string
          ended_at?: string | null
          event_id?: string
          run_id?: string
          started_at?: string
          status?: string
          survivor_actor_id?: string
          user_id?: string
          wrong_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "world_landlord_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "world_events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      world_level_thresholds: {
        Row: {
          created_at: string
          level: number
          min_total_exp: number
        }
        Insert: {
          created_at?: string
          level: number
          min_total_exp: number
        }
        Update: {
          created_at?: string
          level?: number
          min_total_exp?: number
        }
        Relationships: []
      }
      world_life_skill_catalog: {
        Row: {
          curve_id: string
          skill_id: string
          status: string
        }
        Insert: {
          curve_id: string
          skill_id: string
          status: string
        }
        Update: {
          curve_id?: string
          skill_id?: string
          status?: string
        }
        Relationships: []
      }
      world_life_skill_thresholds: {
        Row: {
          created_at: string
          curve_id: string
          level: number
          min_total_xp: number
        }
        Insert: {
          created_at?: string
          curve_id: string
          level: number
          min_total_xp: number
        }
        Update: {
          created_at?: string
          curve_id?: string
          level?: number
          min_total_xp?: number
        }
        Relationships: []
      }
      world_life_skill_xp_transactions: {
        Row: {
          amount: number
          created_at: string
          idempotency_key: string
          level_after: number
          level_before: number
          skill_id: string
          source_id: string
          source_type: string
          transaction_id: string
          user_id: string
          xp_after: number
          xp_before: number
        }
        Insert: {
          amount: number
          created_at?: string
          idempotency_key: string
          level_after: number
          level_before: number
          skill_id: string
          source_id: string
          source_type: string
          transaction_id?: string
          user_id: string
          xp_after: number
          xp_before: number
        }
        Update: {
          amount?: number
          created_at?: string
          idempotency_key?: string
          level_after?: number
          level_before?: number
          skill_id?: string
          source_id?: string
          source_type?: string
          transaction_id?: string
          user_id?: string
          xp_after?: number
          xp_before?: number
        }
        Relationships: [
          {
            foreignKeyName: "world_life_skill_xp_transactions_user_id_skill_id_fkey"
            columns: ["user_id", "skill_id"]
            isOneToOne: false
            referencedRelation: "world_player_life_skills"
            referencedColumns: ["user_id", "skill_id"]
          },
        ]
      }
      world_mcm_reward_claims: {
        Row: {
          claim_type: string
          claimed_at: string
          event_id: string
          idempotency_key: string
          reward_id: string
          reward_status: string
          reward_transaction_id: string
          source_completed_at: string
          user_id: string
        }
        Insert: {
          claim_type: string
          claimed_at?: string
          event_id: string
          idempotency_key: string
          reward_id: string
          reward_status: string
          reward_transaction_id: string
          source_completed_at: string
          user_id: string
        }
        Update: {
          claim_type?: string
          claimed_at?: string
          event_id?: string
          idempotency_key?: string
          reward_id?: string
          reward_status?: string
          reward_transaction_id?: string
          source_completed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_mcm_reward_claims_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "world_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "world_mcm_reward_claims_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "world_reward_definitions"
            referencedColumns: ["reward_id"]
          },
          {
            foreignKeyName: "world_mcm_reward_claims_reward_transaction_id_fkey"
            columns: ["reward_transaction_id"]
            isOneToOne: true
            referencedRelation: "world_reward_transactions"
            referencedColumns: ["reward_transaction_id"]
          },
        ]
      }
      world_npc_ai_daily_calls: {
        Row: {
          calls: number
          scope: string
          usage_day: string
        }
        Insert: {
          calls?: number
          scope: string
          usage_day: string
        }
        Update: {
          calls?: number
          scope?: string
          usage_day?: string
        }
        Relationships: []
      }
      world_npc_shared_ticks_v1: {
        Row: {
          claimed_at: string
          committed_at: string | null
          decisions: Json | null
          effective_at_ms: number
          period: string
          status: string
          tick: number
          tick_ms: number
        }
        Insert: {
          claimed_at?: string
          committed_at?: string | null
          decisions?: Json | null
          effective_at_ms: number
          period: string
          status?: string
          tick: number
          tick_ms?: number
        }
        Update: {
          claimed_at?: string
          committed_at?: string | null
          decisions?: Json | null
          effective_at_ms?: number
          period?: string
          status?: string
          tick?: number
          tick_ms?: number
        }
        Relationships: []
      }
      world_player_appearance_loadout: {
        Row: {
          item_id: string
          slot: string
          updated_at: string
          user_id: string
        }
        Insert: {
          item_id: string
          slot: string
          updated_at?: string
          user_id: string
        }
        Update: {
          item_id?: string
          slot?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_player_appearance_loadout_owned"
            columns: ["user_id", "item_id"]
            isOneToOne: false
            referencedRelation: "world_player_items"
            referencedColumns: ["user_id", "item_id"]
          },
        ]
      }
      world_player_collection_discoveries: {
        Row: {
          discovery_count: number
          entry_id: string
          first_discovered_at: string
          first_result_ref: string | null
          first_source_ref: string
          first_source_type: string
          last_discovered_at: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          discovery_count: number
          entry_id: string
          first_discovered_at: string
          first_result_ref?: string | null
          first_source_ref: string
          first_source_type: string
          last_discovered_at: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          discovery_count?: number
          entry_id?: string
          first_discovered_at?: string
          first_result_ref?: string | null
          first_source_ref?: string
          first_source_type?: string
          last_discovered_at?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      world_player_items: {
        Row: {
          acquired_at: string
          acquisition_metadata: Json | null
          event_id: string | null
          grant_id: string
          id: string
          item_id: string
          quantity: number
          source_ref: string
          source_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          acquisition_metadata?: Json | null
          event_id?: string | null
          grant_id: string
          id?: string
          item_id: string
          quantity: number
          source_ref: string
          source_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          acquisition_metadata?: Json | null
          event_id?: string | null
          grant_id?: string
          id?: string
          item_id?: string
          quantity?: number
          source_ref?: string
          source_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_player_items_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "world_item_grants"
            referencedColumns: ["grant_id"]
          },
        ]
      }
      world_player_life_skills: {
        Row: {
          created_at: string
          skill_id: string
          total_xp: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          skill_id: string
          total_xp?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          skill_id?: string
          total_xp?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      world_player_progression: {
        Row: {
          created_at: string
          total_exp: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          total_exp?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          total_exp?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      world_purchase_transactions: {
        Row: {
          balance_after: number
          balance_before: number
          created_at: string
          currency_id: string
          idempotency_key: string
          inventory_grant_id: string
          item_id: string
          listing_id: string
          price: number
          purchase_id: string
          quantity: number
          shop_id: string
          status: string
          user_id: string
          wallet_transaction_id: string
        }
        Insert: {
          balance_after: number
          balance_before: number
          created_at?: string
          currency_id: string
          idempotency_key: string
          inventory_grant_id: string
          item_id: string
          listing_id: string
          price: number
          purchase_id?: string
          quantity: number
          shop_id: string
          status?: string
          user_id: string
          wallet_transaction_id: string
        }
        Update: {
          balance_after?: number
          balance_before?: number
          created_at?: string
          currency_id?: string
          idempotency_key?: string
          inventory_grant_id?: string
          item_id?: string
          listing_id?: string
          price?: number
          purchase_id?: string
          quantity?: number
          shop_id?: string
          status?: string
          user_id?: string
          wallet_transaction_id?: string
        }
        Relationships: []
      }
      world_quest_progress_v1: {
        Row: {
          quest_id: string
          stage: number
          updated_at: string
          user_id: string
        }
        Insert: {
          quest_id: string
          stage: number
          updated_at?: string
          user_id: string
        }
        Update: {
          quest_id?: string
          stage?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      world_reward_definitions: {
        Row: {
          created_at: string
          description: string
          event_id: string | null
          reward_id: string
          status: string
          tags: string[]
          version: number
        }
        Insert: {
          created_at?: string
          description: string
          event_id?: string | null
          reward_id: string
          status: string
          tags?: string[]
          version?: number
        }
        Update: {
          created_at?: string
          description?: string
          event_id?: string | null
          reward_id?: string
          status?: string
          tags?: string[]
          version?: number
        }
        Relationships: []
      }
      world_reward_grants: {
        Row: {
          amount: number
          grant_entry_id: string
          grant_type: string
          position: number
          reward_id: string
          target_id: string
        }
        Insert: {
          amount: number
          grant_entry_id: string
          grant_type: string
          position: number
          reward_id: string
          target_id: string
        }
        Update: {
          amount?: number
          grant_entry_id?: string
          grant_type?: string
          position?: number
          reward_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_reward_grants_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "world_reward_definitions"
            referencedColumns: ["reward_id"]
          },
        ]
      }
      world_reward_transaction_entries: {
        Row: {
          attempts: number
          child_idempotency_key: string
          child_transaction_id: string | null
          grant_entry_id: string
          grant_type: string
          granted: number
          position: number
          reason: string | null
          requested: number
          reward_transaction_id: string
          status: string
          target_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          child_idempotency_key: string
          child_transaction_id?: string | null
          grant_entry_id: string
          grant_type: string
          granted?: number
          position: number
          reason?: string | null
          requested: number
          reward_transaction_id: string
          status: string
          target_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          child_idempotency_key?: string
          child_transaction_id?: string | null
          grant_entry_id?: string
          grant_type?: string
          granted?: number
          position?: number
          reason?: string | null
          requested?: number
          reward_transaction_id?: string
          status?: string
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_reward_transaction_entries_reward_transaction_id_fkey"
            columns: ["reward_transaction_id"]
            isOneToOne: false
            referencedRelation: "world_reward_transactions"
            referencedColumns: ["reward_transaction_id"]
          },
        ]
      }
      world_reward_transactions: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          event_id: string | null
          idempotency_key: string
          reward_id: string
          reward_transaction_id: string
          reward_version: number
          source_id: string
          source_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          event_id?: string | null
          idempotency_key: string
          reward_id: string
          reward_transaction_id?: string
          reward_version: number
          source_id: string
          source_type: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          event_id?: string | null
          idempotency_key?: string
          reward_id?: string
          reward_transaction_id?: string
          reward_version?: number
          source_id?: string
          source_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_reward_transactions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "world_reward_definitions"
            referencedColumns: ["reward_id"]
          },
        ]
      }
      world_room_layouts: {
        Row: {
          objects: Json
          revision: number
          room_id: string
          updated_at: string
        }
        Insert: {
          objects?: Json
          revision?: number
          room_id: string
          updated_at?: string
        }
        Update: {
          objects?: Json
          revision?: number
          room_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      world_shop_listings: {
        Row: {
          created_at: string
          currency_id: string
          end_at: string | null
          item_id: string
          listing_id: string
          position: number
          price: number
          purchase_limit: number | null
          quantity: number
          required_level: number | null
          shop_id: string
          start_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          currency_id: string
          end_at?: string | null
          item_id: string
          listing_id: string
          position: number
          price: number
          purchase_limit?: number | null
          quantity?: number
          required_level?: number | null
          shop_id: string
          start_at?: string | null
          status: string
        }
        Update: {
          created_at?: string
          currency_id?: string
          end_at?: string | null
          item_id?: string
          listing_id?: string
          position?: number
          price?: number
          purchase_limit?: number | null
          quantity?: number
          required_level?: number | null
          shop_id?: string
          start_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_shop_listings_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "world_currencies"
            referencedColumns: ["currency_id"]
          },
          {
            foreignKeyName: "world_shop_listings_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "world_shops"
            referencedColumns: ["shop_id"]
          },
        ]
      }
      world_shops: {
        Row: {
          created_at: string
          display_name: string
          shop_id: string
          status: string
          tags: string[]
          vendor_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          shop_id: string
          status: string
          tags?: string[]
          vendor_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          shop_id?: string
          status?: string
          tags?: string[]
          vendor_id?: string | null
        }
        Relationships: []
      }
      world_staff_assignments: {
        Row: {
          active: boolean
          created_at: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      world_staff_role_permissions: {
        Row: {
          permission: string
          role: string
        }
        Insert: {
          permission: string
          role: string
        }
        Update: {
          permission?: string
          role?: string
        }
        Relationships: []
      }
      world_user_moderation_actions: {
        Row: {
          action: string
          actor_id: string | null
          actor_source: string
          created_at: string
          ends_at: string | null
          id: number
          report_id: number | null
          starts_at: string
          target_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_source?: string
          created_at?: string
          ends_at?: string | null
          id?: number
          report_id?: number | null
          starts_at?: string
          target_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_source?: string
          created_at?: string
          ends_at?: string | null
          id?: number
          report_id?: number | null
          starts_at?: string
          target_id?: string
        }
        Relationships: []
      }
      world_wallets: {
        Row: {
          balance: number
          created_at: string
          currency_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          balance?: number
          created_at?: string
          currency_id: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          balance?: number
          created_at?: string
          currency_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "world_wallets_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "world_currencies"
            referencedColumns: ["currency_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hub_message_caller: { Args: never; Returns: string }
      hub_message_card: { Args: { p_user: string }; Returns: Json }
      hub_message_inha_verified: { Args: { p_user: string }; Returns: boolean }
      hub_message_lock_pair: {
        Args: { p_a: string; p_b: string }
        Returns: undefined
      }
      hub_message_lock_sender: { Args: { p_user: string }; Returns: undefined }
      hub_message_target: {
        Args: { p_caller: string; p_target: string }
        Returns: string
      }
      inha_duck_ops_basic_digest_valid_v1: {
        Args: { p_value: string }
        Returns: boolean
      }
      inha_duck_ops_credential_valid_v1: {
        Args: { p_value: string }
        Returns: boolean
      }
      install_world_online_realtime_policies: {
        Args: never
        Returns: undefined
      }
      purge_game_events_90d: { Args: never; Returns: number }
      purge_induck_grow_analytics_90d: { Args: never; Returns: number }
      purge_induck_grow_decisions_90d: { Args: never; Returns: number }
      purge_induck_grow_p2a_90d: { Args: never; Returns: number }
      purge_inhagame_hub_events_90d: { Args: never; Returns: number }
      purge_world_accompany_1d: { Args: never; Returns: number }
      touch_world_online_session_core: {
        Args: {
          p_place_zone_id: string
          p_session_id: string
          p_space: string
          p_visitor_id: string
        }
        Returns: undefined
      }
      validate_world_room_furniture_v1: {
        Args: { p_objects: Json; p_user: string }
        Returns: undefined
      }
      world_accompany_expire: { Args: { p_user: string }; Returns: undefined }
      world_accompany_lock_users: {
        Args: { p_a: string; p_b: string }
        Returns: undefined
      }
      world_activity_account_ok_v1: {
        Args: { p_user: string }
        Returns: boolean
      }
      world_activity_attempt_json_v1: {
        Args: {
          p_attempt: Database["private"]["Tables"]["world_activity_attempts"]["Row"]
        }
        Returns: Json
      }
      world_activity_finalize_v1: {
        Args: {
          p_attempt_id: string
          p_outcome_type: string
          p_result_ref?: string
          p_terminal_status: string
          p_user: string
        }
        Returns: Json
      }
      world_activity_start_v1: {
        Args: {
          p_activity_id: string
          p_client_attempt_key: string
          p_definition_version: number
          p_expires_at?: string
          p_resolver_version: number
          p_source_ref: string
          p_user: string
        }
        Returns: Json
      }
      world_activity_validate_identity_v1: {
        Args: {
          p_activity_id: string
          p_definition_version: number
          p_resolver_version: number
          p_source_ref: string
        }
        Returns: undefined
      }
      world_admin_caller_v1: { Args: { p_permission: string }; Returns: string }
      world_appearance_caller_v1: { Args: never; Returns: string }
      world_appearance_loadout_json_v1: {
        Args: { p_user: string }
        Returns: Json
      }
      world_appearance_record_v1: {
        Args: {
          p_action: string
          p_key: string
          p_next: string
          p_previous: string
          p_requested: string
          p_slot: string
          p_user: string
        }
        Returns: {
          action: string
          created_at: string
          idempotency_key: string
          next_item_id: string | null
          previous_item_id: string | null
          requested_item_id: string | null
          slot: string
          transaction_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "world_appearance_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      world_appearance_result_v1: {
        Args: {
          p_replayed: boolean
          p_tx: Database["private"]["Tables"]["world_appearance_transactions"]["Row"]
        }
        Returns: Json
      }
      world_appearance_slot_ok_v1: {
        Args: { p_slot: string }
        Returns: boolean
      }
      world_attendance_caller_v1: { Args: never; Returns: string }
      world_attendance_claim_v1: {
        Args: { p_today: string; p_user: string }
        Returns: Json
      }
      world_attendance_milestone_coin_v1: {
        Args: { p_days: number }
        Returns: number
      }
      world_attendance_state_v1: {
        Args: { p_today: string; p_user: string }
        Returns: Json
      }
      world_attendance_today_v1: { Args: { p_now?: string }; Returns: string }
      world_card: { Args: { p_user: string }; Returns: Json }
      world_collection_account_ok_v1: {
        Args: { p_user: string }
        Returns: boolean
      }
      world_collection_discover_v1: {
        Args: {
          p_entry_id: string
          p_idempotency_key: string
          p_metadata?: Json
          p_result_ref: string
          p_source_ref: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_collection_discovery_result_v1: {
        Args: {
          p_event: Database["private"]["Tables"]["world_collection_discovery_events"]["Row"]
          p_status: string
        }
        Returns: Json
      }
      world_collection_entry_snapshot_v1: {
        Args: {
          p_entry: Database["private"]["Tables"]["world_collection_entry_catalog"]["Row"]
          p_user: string
        }
        Returns: Json
      }
      world_collection_list_v1: { Args: { p_user: string }; Returns: Json }
      world_collection_projection_json_v1: {
        Args: {
          p_projection: Database["private"]["Tables"]["world_player_collection_discoveries"]["Row"]
        }
        Returns: Json
      }
      world_daily_quiz_account_ok_v1: {
        Args: { p_user: string }
        Returns: boolean
      }
      world_daily_quiz_caller_v1: { Args: never; Returns: string }
      world_daily_quiz_reward_view_v1: {
        Args: { p_reward: Json }
        Returns: Json
      }
      world_daily_quiz_state_v1: {
        Args: { p_date: string; p_user: string }
        Returns: Json
      }
      world_daily_quiz_today_v1: { Args: { p_now?: string }; Returns: string }
      world_event_state_v1: {
        Args: {
          p_event: Database["private"]["Tables"]["world_events"]["Row"]
          p_now: string
        }
        Returns: string
      }
      world_exp_apply_v1: {
        Args: {
          p_amount: number
          p_idempotency_key: string
          p_source_id: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_exp_result_v1: {
        Args: {
          p_status: string
          p_tx: Database["private"]["Tables"]["world_exp_transactions"]["Row"]
        }
        Returns: Json
      }
      world_guestbook_entry_json: {
        Args: { p_entry_id: string; p_viewer: string }
        Returns: Json
      }
      world_inventory_account_ok_v1: {
        Args: { p_user: string }
        Returns: boolean
      }
      world_inventory_consume_result_v1: {
        Args: {
          p_consumption: Database["private"]["Tables"]["world_item_consumptions"]["Row"]
          p_status: string
        }
        Returns: Json
      }
      world_inventory_consume_v1: {
        Args: {
          p_idempotency_key: string
          p_item_id: string
          p_metadata?: Json
          p_parent_mutation_id?: string
          p_quantity: number
          p_source_ref: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_inventory_grant_result_v1: {
        Args: {
          p_acquired_at: string
          p_grant: Database["private"]["Tables"]["world_item_grants"]["Row"]
          p_status: string
        }
        Returns: Json
      }
      world_inventory_grant_v1: {
        Args: {
          p_event_id: string
          p_idempotency_key: string
          p_item_id: string
          p_metadata: Json
          p_quantity: number
          p_source_ref: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_inventory_item_json_v1: {
        Args: {
          p_catalog_status: string
          p_item: Database["private"]["Tables"]["world_player_items"]["Row"]
          p_server_view: boolean
        }
        Returns: Json
      }
      world_inventory_mutate_v1: {
        Args: {
          p_idempotency_key: string
          p_mutation_type: string
          p_plan: Json
          p_source_ref: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_inventory_mutation_receipt_v1: {
        Args: {
          p_mutation: Database["private"]["Tables"]["world_inventory_mutations"]["Row"]
          p_status: string
        }
        Returns: Json
      }
      world_inventory_normalize_plan_v1: {
        Args: { p_plan: Json }
        Returns: Json
      }
      world_landlord_pick_survivor_v1: { Args: never; Returns: string }
      world_level_for_exp_v1: { Args: { p_total_exp: number }; Returns: number }
      world_life_skill_account_ok_v1: {
        Args: { p_user: string }
        Returns: boolean
      }
      world_life_skill_level_for_xp_v1: {
        Args: { p_curve_id: string; p_total_xp: number }
        Returns: number
      }
      world_life_skill_snapshot_v1: {
        Args: { p_skill_id: string; p_user: string }
        Returns: Json
      }
      world_life_skill_xp_apply_v1: {
        Args: {
          p_amount: number
          p_idempotency_key: string
          p_skill_id: string
          p_source_id: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_life_skill_xp_result_v1: {
        Args: {
          p_status: string
          p_tx: Database["private"]["Tables"]["world_life_skill_xp_transactions"]["Row"]
        }
        Returns: Json
      }
      world_life_skills_list_v1: { Args: { p_user: string }; Returns: Json }
      world_lock_pair: {
        Args: { p_a: string; p_b: string }
        Returns: undefined
      }
      world_mcm_account_ok_v1: { Args: { p_user: string }; Returns: boolean }
      world_mcm_claim_result_v1: {
        Args: {
          p_claim_type: string
          p_claimed_at: string
          p_replayed: boolean
          p_reward_transaction_id: string
          p_status: string
        }
        Returns: Json
      }
      world_mcm_claim_reward_v1: {
        Args: { p_claim_type: string; p_user: string }
        Returns: Json
      }
      world_mcm_state_v1: { Args: { p_user: string }; Returns: Json }
      world_mcm_try_complete_v1: {
        Args: { p_user: string }
        Returns: undefined
      }
      world_ops_read_allowed_v1: { Args: { p_token: string }; Returns: boolean }
      world_personal_room_json_v1: {
        Args: {
          p_room: Database["public"]["Tables"]["world_player_rooms"]["Row"]
        }
        Returns: Json
      }
      world_player_level_v1: { Args: { p_user: string }; Returns: number }
      world_progression_account_ok_v1: {
        Args: { p_user: string }
        Returns: boolean
      }
      world_progression_snapshot_v1: { Args: { p_user: string }; Returns: Json }
      world_purchase_result_v1: {
        Args: { p_purchase_id: string; p_replayed: boolean }
        Returns: Json
      }
      world_relationship: {
        Args: { p_caller: string; p_target: string }
        Returns: string
      }
      world_reward_grant_v1: {
        Args: {
          p_idempotency_key: string
          p_reward_id: string
          p_source_id: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_reward_result_v1: {
        Args: { p_replayed: boolean; p_reward_transaction_id: string }
        Returns: Json
      }
      world_room_access_v1: {
        Args: { p_room_id: string; p_viewer: string }
        Returns: string
      }
      world_room_caller_v1: { Args: never; Returns: string }
      world_room_furniture_v1: {
        Args: never
        Returns: {
          depth: number
          flat: boolean
          height: number
          item_id: string
          solid: boolean
          surfaces: string[]
          width: number
        }[]
      }
      world_shop_listing_block_v2: {
        Args: {
          p_listing: Database["private"]["Tables"]["world_shop_listings"]["Row"]
          p_now: string
          p_player_level: number
        }
        Returns: string
      }
      world_social_caller: { Args: never; Returns: string }
      world_social_target: {
        Args: { p_caller: string; p_target: string }
        Returns: string
      }
      world_wallet_account_ok_v1: { Args: { p_user: string }; Returns: boolean }
      world_wallet_apply_v1: {
        Args: {
          p_currency_id: string
          p_delta: number
          p_idempotency_key: string
          p_reason: string
          p_source_id: string
          p_source_type: string
          p_type: string
          p_user: string
        }
        Returns: Json
      }
      world_wallet_result_v1: {
        Args: {
          p_status: string
          p_tx: Database["private"]["Tables"]["world_currency_transactions"]["Row"]
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
  public: {
    Tables: {
      classic_event_badges: {
        Row: {
          awarded_at: string
          badge_code: string
          best_run_id: string
          event_key: string
          final_achieved_at: string
          final_combo: number
          final_score: number
          placement: number
          user_id: string
        }
        Insert: {
          awarded_at?: string
          badge_code: string
          best_run_id: string
          event_key: string
          final_achieved_at: string
          final_combo: number
          final_score: number
          placement: number
          user_id: string
        }
        Update: {
          awarded_at?: string
          badge_code?: string
          best_run_id?: string
          event_key?: string
          final_achieved_at?: string
          final_combo?: number
          final_score?: number
          placement?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classic_event_badges_best_run_id_fkey"
            columns: ["best_run_id"]
            isOneToOne: false
            referencedRelation: "ranked_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          active: boolean
          created_at: string
          id: number
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: number
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: number
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      experiment_assignments: {
        Row: {
          assigned_at: string
          experiment_id: string
          metadata: Json
          player_id: string
          variant: string
        }
        Insert: {
          assigned_at?: string
          experiment_id: string
          metadata?: Json
          player_id: string
          variant: string
        }
        Update: {
          assigned_at?: string
          experiment_id?: string
          metadata?: Json
          player_id?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_assignments_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          created_at: string
          ended_at: string | null
          game_id: string
          hypothesis: string | null
          id: string
          metadata: Json
          name: string
          started_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          game_id: string
          hypothesis?: string | null
          id?: string
          metadata?: Json
          name: string
          started_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          game_id?: string
          hypothesis?: string | null
          id?: string
          metadata?: Json
          name?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiments_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_builds: {
        Row: {
          balance_version: string | null
          client_version: string | null
          created_at: string
          deployed_at: string | null
          game_id: string
          git_commit: string | null
          id: string
          metadata: Json
          ruleset_version: string | null
          version: string
        }
        Insert: {
          balance_version?: string | null
          client_version?: string | null
          created_at?: string
          deployed_at?: string | null
          game_id: string
          git_commit?: string | null
          id?: string
          metadata?: Json
          ruleset_version?: string | null
          version: string
        }
        Update: {
          balance_version?: string | null
          client_version?: string | null
          created_at?: string
          deployed_at?: string | null
          game_id?: string
          git_commit?: string | null
          id?: string
          metadata?: Json
          ruleset_version?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_builds_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_events: {
        Row: {
          build_id: string | null
          combo: number | null
          created_at: string
          event_type: string
          event_version: number
          game_id: string | null
          game_session_id: string | null
          id: number
          metadata: Json
          player_id: string | null
          run_id: string | null
          score: number | null
          stage_id: number | null
          stars: number | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          build_id?: string | null
          combo?: number | null
          created_at?: string
          event_type: string
          event_version?: number
          game_id?: string | null
          game_session_id?: string | null
          id?: number
          metadata?: Json
          player_id?: string | null
          run_id?: string | null
          score?: number | null
          stage_id?: number | null
          stars?: number | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          build_id?: string | null
          combo?: number | null
          created_at?: string
          event_type?: string
          event_version?: number
          game_id?: string | null
          game_session_id?: string | null
          id?: number
          metadata?: Json
          player_id?: string | null
          run_id?: string | null
          score?: number | null
          stage_id?: number | null
          stars?: number | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_events_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "game_builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_events_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_events_game_session_id_fkey"
            columns: ["game_session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      game_sessions: {
        Row: {
          build_id: string | null
          client_session_id: string
          device: string | null
          ended_at: string | null
          game_id: string
          id: string
          metadata: Json
          platform: string | null
          player_id: string | null
          source: string | null
          started_at: string
        }
        Insert: {
          build_id?: string | null
          client_session_id: string
          device?: string | null
          ended_at?: string | null
          game_id: string
          id?: string
          metadata?: Json
          platform?: string | null
          player_id?: string | null
          source?: string | null
          started_at?: string
        }
        Update: {
          build_id?: string | null
          client_session_id?: string
          device?: string | null
          ended_at?: string | null
          game_id?: string
          id?: string
          metadata?: Json
          platform?: string | null
          player_id?: string | null
          source?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_sessions_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "game_builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_sessions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_sessions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          name: string
          released_at: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          released_at?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          released_at?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      general_stage_bests: {
        Row: {
          achieved_at: string
          best_combo: number
          best_score: number
          best_stars: number
          stage_id: number
          user_id: string
        }
        Insert: {
          achieved_at?: string
          best_combo?: number
          best_score?: number
          best_stars?: number
          stage_id: number
          user_id: string
        }
        Update: {
          achieved_at?: string
          best_combo?: number
          best_score?: number
          best_stars?: number
          stage_id?: number
          user_id?: string
        }
        Relationships: []
      }
      grow_rank_bests: {
        Row: {
          achieved_at: string
          credits: number
          department: string
          ruleset: string
          run_id: string
          twice_points: number
          user_id: string
        }
        Insert: {
          achieved_at: string
          credits: number
          department: string
          ruleset: string
          run_id: string
          twice_points: number
          user_id: string
        }
        Update: {
          achieved_at?: string
          credits?: number
          department?: string
          ruleset?: string
          run_id?: string
          twice_points?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grow_rank_bests_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "grow_rank_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      grow_rank_runs: {
        Row: {
          accepted_at: string
          credits: number
          department: string
          ruleset: string
          run_id: string
          twice_points: number
          user_id: string
        }
        Insert: {
          accepted_at?: string
          credits: number
          department: string
          ruleset: string
          run_id: string
          twice_points: number
          user_id: string
        }
        Update: {
          accepted_at?: string
          credits?: number
          department?: string
          ruleset?: string
          run_id?: string
          twice_points?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grow_rank_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "grow_rank_sessions"
            referencedColumns: ["run_id"]
          },
        ]
      }
      grow_rank_sessions: {
        Row: {
          department: string
          expires_at: string
          finished_at: string | null
          nonce: string
          reject_reason: string | null
          ruleset: string
          run_id: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          department: string
          expires_at?: string
          finished_at?: string | null
          nonce?: string
          reject_reason?: string | null
          ruleset: string
          run_id?: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          department?: string
          expires_at?: string
          finished_at?: string | null
          nonce?: string
          reject_reason?: string | null
          ruleset?: string
          run_id?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      grow_rank_visibility: {
        Row: {
          department: string
          is_public: boolean
          user_id: string
        }
        Insert: {
          department: string
          is_public?: boolean
          user_id: string
        }
        Update: {
          department?: string
          is_public?: boolean
          user_id?: string
        }
        Relationships: []
      }
      hub_conversation_members: {
        Row: {
          archived_at: string | null
          conversation_id: string
          joined_at: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          conversation_id: string
          joined_at?: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          archived_at?: string | null
          conversation_id?: string
          joined_at?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "hub_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_conversations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          updated_at: string
          user_high: string
          user_low: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          updated_at?: string
          user_high: string
          user_low: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          updated_at?: string
          user_high?: string
          user_low?: string
        }
        Relationships: []
      }
      hub_message_reports: {
        Row: {
          category: string
          created_at: string
          id: number
          message_id: string
          reporter_id: string
          reviewed_at: string | null
          status: string
          target_id: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: never
          message_id: string
          reporter_id: string
          reviewed_at?: string | null
          status?: string
          target_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: never
          message_id?: string
          reporter_id?: string
          reviewed_at?: string | null
          status?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_message_reports_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "hub_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_messages_sender_member_fk"
            columns: ["conversation_id", "sender_id"]
            isOneToOne: false
            referencedRelation: "hub_conversation_members"
            referencedColumns: ["conversation_id", "user_id"]
          },
        ]
      }
      induck_grow_analytics_events: {
        Row: {
          acquisition_source: string
          campaign: string | null
          created_at: string
          department: string | null
          event_id: string
          event_type: string
          gpa: number | null
          session_id: string
          week: number | null
        }
        Insert: {
          acquisition_source?: string
          campaign?: string | null
          created_at?: string
          department?: string | null
          event_id: string
          event_type: string
          gpa?: number | null
          session_id: string
          week?: number | null
        }
        Update: {
          acquisition_source?: string
          campaign?: string | null
          created_at?: string
          department?: string | null
          event_id?: string
          event_type?: string
          gpa?: number | null
          session_id?: string
          week?: number | null
        }
        Relationships: []
      }
      induck_grow_decision_events: {
        Row: {
          acquisition_source: string
          campaign: string | null
          category: string
          choice_id: string
          created_at: string
          decision_id: string
          department: string
          event_id: string
          session_id: string
          week: number | null
        }
        Insert: {
          acquisition_source?: string
          campaign?: string | null
          category: string
          choice_id: string
          created_at?: string
          decision_id: string
          department: string
          event_id: string
          session_id: string
          week?: number | null
        }
        Update: {
          acquisition_source?: string
          campaign?: string | null
          category?: string
          choice_id?: string
          created_at?: string
          decision_id?: string
          department?: string
          event_id?: string
          session_id?: string
          week?: number | null
        }
        Relationships: []
      }
      induck_grow_resource_checkpoints: {
        Row: {
          acquisition_source: string
          campaign: string | null
          created_at: string
          department: string
          event_id: string
          free_slots: number
          money: number
          session_id: string
          stamina: number
          stress: number
          week: number
        }
        Insert: {
          acquisition_source?: string
          campaign?: string | null
          created_at?: string
          department: string
          event_id: string
          free_slots: number
          money: number
          session_id: string
          stamina: number
          stress: number
          week: number
        }
        Update: {
          acquisition_source?: string
          campaign?: string | null
          created_at?: string
          department?: string
          event_id?: string
          free_slots?: number
          money?: number
          session_id?: string
          stamina?: number
          stress?: number
          week?: number
        }
        Relationships: []
      }
      induck_grow_session_ends: {
        Row: {
          acquisition_source: string
          campaign: string | null
          completed: boolean
          created_at: string
          department: string | null
          duration_sec: number
          end_reason: string
          event_id: string
          final_gpa: number | null
          last_screen: string | null
          last_week: number | null
          session_id: string
          updated_at: string
        }
        Insert: {
          acquisition_source?: string
          campaign?: string | null
          completed?: boolean
          created_at?: string
          department?: string | null
          duration_sec: number
          end_reason: string
          event_id: string
          final_gpa?: number | null
          last_screen?: string | null
          last_week?: number | null
          session_id: string
          updated_at?: string
        }
        Update: {
          acquisition_source?: string
          campaign?: string | null
          completed?: boolean
          created_at?: string
          department?: string | null
          duration_sec?: number
          end_reason?: string
          event_id?: string
          final_gpa?: number | null
          last_screen?: string | null
          last_week?: number | null
          session_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      induckup_ranked_bests: {
        Row: {
          achieved_at: string
          best_duration_ms: number
          best_score: number
          best_wave: number
          user_id: string
        }
        Insert: {
          achieved_at?: string
          best_duration_ms?: number
          best_score?: number
          best_wave?: number
          user_id: string
        }
        Update: {
          achieved_at?: string
          best_duration_ms?: number
          best_score?: number
          best_wave?: number
          user_id?: string
        }
        Relationships: []
      }
      inha_duck_ops_auth_state: {
        Row: {
          auth_key: string
          basic_sha256: string
          updated_at: string
        }
        Insert: {
          auth_key: string
          basic_sha256: string
          updated_at?: string
        }
        Update: {
          auth_key?: string
          basic_sha256?: string
          updated_at?: string
        }
        Relationships: []
      }
      inha_duck_ops_refresh: {
        Row: {
          id: number
          seq: number
          updated_at: string
        }
        Insert: {
          id?: number
          seq?: number
          updated_at?: string
        }
        Update: {
          id?: number
          seq?: number
          updated_at?: string
        }
        Relationships: []
      }
      inha_mail_badges: {
        Row: {
          email: string
          user_id: string
          verified_at: string
        }
        Insert: {
          email: string
          user_id: string
          verified_at?: string
        }
        Update: {
          email?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      inhagame_hub_events: {
        Row: {
          acquisition_source: string
          campaign: string | null
          created_at: string
          entry_id: string | null
          event_id: string
          event_type: string
          session_id: string
          surface: string
          target: string | null
          visitor_id: string
        }
        Insert: {
          acquisition_source?: string
          campaign?: string | null
          created_at?: string
          entry_id?: string | null
          event_id: string
          event_type: string
          session_id: string
          surface: string
          target?: string | null
          visitor_id: string
        }
        Update: {
          acquisition_source?: string
          campaign?: string | null
          created_at?: string
          entry_id?: string | null
          event_id?: string
          event_type?: string
          session_id?: string
          surface?: string
          target?: string | null
          visitor_id?: string
        }
        Relationships: []
      }
      ops_alert_state: {
        Row: {
          alert_key: string
          last_value: number | null
          notified_at: string | null
          payload: Json
          status: string
          threshold_value: number | null
          triggered_at: string | null
          updated_at: string
        }
        Insert: {
          alert_key: string
          last_value?: number | null
          notified_at?: string | null
          payload?: Json
          status?: string
          threshold_value?: number | null
          triggered_at?: string | null
          updated_at?: string
        }
        Update: {
          alert_key?: string
          last_value?: number | null
          notified_at?: string | null
          payload?: Json
          status?: string
          threshold_value?: number | null
          triggered_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ops_event_contracts: {
        Row: {
          canonical_event: string
          category: string
          contract_version: number
          created_at: string
          description: string
          lifecycle_signal: string
          required_context: Json
          run_scoped: boolean
          terminal_signal: boolean
        }
        Insert: {
          canonical_event: string
          category: string
          contract_version?: number
          created_at?: string
          description: string
          lifecycle_signal?: string
          required_context?: Json
          run_scoped?: boolean
          terminal_signal?: boolean
        }
        Update: {
          canonical_event?: string
          category?: string
          contract_version?: number
          created_at?: string
          description?: string
          lifecycle_signal?: string
          required_context?: Json
          run_scoped?: boolean
          terminal_signal?: boolean
        }
        Relationships: []
      }
      ops_event_mappings: {
        Row: {
          canonical_event: string
          created_at: string
          game_id: string
          mapping_version: number
          metric_role: string
          notes: string | null
          raw_event_type: string
        }
        Insert: {
          canonical_event: string
          created_at?: string
          game_id: string
          mapping_version?: number
          metric_role?: string
          notes?: string | null
          raw_event_type: string
        }
        Update: {
          canonical_event?: string
          created_at?: string
          game_id?: string
          mapping_version?: number
          metric_role?: string
          notes?: string | null
          raw_event_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_event_mappings_canonical_event_fkey"
            columns: ["canonical_event"]
            isOneToOne: false
            referencedRelation: "ops_event_contracts"
            referencedColumns: ["canonical_event"]
          },
          {
            foreignKeyName: "ops_event_mappings_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_lifecycle_profiles: {
        Row: {
          classifier_version: string
          game_id: string
          genuine_exit_grace_seconds: number
          metadata: Json
          mode: string
          reset_window_seconds: number
          supersede_on_new_run: boolean
          terminal_precedence: Json
          updated_at: string
        }
        Insert: {
          classifier_version?: string
          game_id: string
          genuine_exit_grace_seconds?: number
          metadata?: Json
          mode?: string
          reset_window_seconds?: number
          supersede_on_new_run?: boolean
          terminal_precedence?: Json
          updated_at?: string
        }
        Update: {
          classifier_version?: string
          game_id?: string
          genuine_exit_grace_seconds?: number
          metadata?: Json
          mode?: string
          reset_window_seconds?: number
          supersede_on_new_run?: boolean
          terminal_precedence?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_lifecycle_profiles_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      player_bests: {
        Row: {
          achieved_at: string
          best_combo: number
          best_run_id: string
          best_score: number
          stage_key: string
          user_id: string
        }
        Insert: {
          achieved_at?: string
          best_combo?: number
          best_run_id: string
          best_score: number
          stage_key?: string
          user_id: string
        }
        Update: {
          achieved_at?: string
          best_combo?: number
          best_run_id?: string
          best_score?: number
          stage_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_bests_best_run_id_fkey"
            columns: ["best_run_id"]
            isOneToOne: false
            referencedRelation: "ranked_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      player_identity_links: {
        Row: {
          auth_user_id: string
          canonical_player_id: string
          created_at: string
          evidence_count: number
          evidence_source: string
          first_evidence_at: string
          last_evidence_at: string
          status: string
          updated_at: string
          visitor_id: string
        }
        Insert: {
          auth_user_id: string
          canonical_player_id: string
          created_at?: string
          evidence_count?: number
          evidence_source?: string
          first_evidence_at?: string
          last_evidence_at?: string
          status?: string
          updated_at?: string
          visitor_id: string
        }
        Update: {
          auth_user_id?: string
          canonical_player_id?: string
          created_at?: string
          evidence_count?: number
          evidence_source?: string
          first_evidence_at?: string
          last_evidence_at?: string
          status?: string
          updated_at?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_identity_links_canonical_player_id_fkey"
            columns: ["canonical_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          auth_user_id: string | null
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          metadata: Json
          visitor_id: string | null
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          visitor_id?: string | null
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          visitor_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_key: string
          created_at: string
          department_id: number | null
          is_banned: boolean
          nickname: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_key?: string
          created_at?: string
          department_id?: number | null
          is_banned?: boolean
          nickname: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_key?: string
          created_at?: string
          department_id?: number | null
          is_banned?: boolean
          nickname?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      ranked_recovery_eligibility: {
        Row: {
          claimed_at: string | null
          created_at: string
          failure_count: number
          first_failed_at: string | null
          incident_key: string
          last_failed_at: string | null
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          failure_count: number
          first_failed_at?: string | null
          incident_key: string
          last_failed_at?: string | null
          user_id: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          failure_count?: number
          first_failed_at?: string | null
          incident_key?: string
          last_failed_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ranked_recovery_records: {
        Row: {
          best_contract: string | null
          client_snapshot_id: string | null
          client_version: string | null
          created_at: string
          id: string
          incident_key: string | null
          local_plays: number | null
          payload: Json
          reason: string | null
          record_kind: string
          ruleset_version: string | null
          score: number | null
          session_id: string | null
          source: string
          user_id: string | null
          validation_status: string
          visitor_id: string | null
        }
        Insert: {
          best_contract?: string | null
          client_snapshot_id?: string | null
          client_version?: string | null
          created_at?: string
          id?: string
          incident_key?: string | null
          local_plays?: number | null
          payload?: Json
          reason?: string | null
          record_kind: string
          ruleset_version?: string | null
          score?: number | null
          session_id?: string | null
          source?: string
          user_id?: string | null
          validation_status?: string
          visitor_id?: string | null
        }
        Update: {
          best_contract?: string | null
          client_snapshot_id?: string | null
          client_version?: string | null
          created_at?: string
          id?: string
          incident_key?: string | null
          local_plays?: number | null
          payload?: Json
          reason?: string | null
          record_kind?: string
          ruleset_version?: string | null
          score?: number | null
          session_id?: string | null
          source?: string
          user_id?: string | null
          validation_status?: string
          visitor_id?: string | null
        }
        Relationships: []
      }
      ranked_runs: {
        Row: {
          annyongi_hits: number
          ascension_bonus: number
          client_version: string | null
          combo_bonus: number
          completed_calls: number
          created_at: string
          dragon_bursts: number
          dragon_calls: number
          duration_ms: number
          flight_base_points: number
          flight_hits: number
          gold_hits: number
          id: string
          indeoki_hits: number
          input_count: number
          max_combo: number
          moon_bonus_hits: number
          normal_hits: number
          reaction_sample_count: number
          reject_reason: string | null
          ruleset_version: string
          run_id: string
          run_type: string
          score: number
          speedy_hits: number
          stage_key: string
          suspicion_reasons: string[]
          suspicious_flag: boolean
          tier1_ground_award: number
          tier1_hits: number
          tier2_ground_award: number
          tier2_hits: number
          total_hits: number
          ultra_fast_reaction_count: number
          user_id: string
          validation_status: string
        }
        Insert: {
          annyongi_hits?: number
          ascension_bonus?: number
          client_version?: string | null
          combo_bonus?: number
          completed_calls?: number
          created_at?: string
          dragon_bursts?: number
          dragon_calls?: number
          duration_ms: number
          flight_base_points?: number
          flight_hits?: number
          gold_hits?: number
          id?: string
          indeoki_hits?: number
          input_count?: number
          max_combo: number
          moon_bonus_hits?: number
          normal_hits?: number
          reaction_sample_count?: number
          reject_reason?: string | null
          ruleset_version?: string
          run_id: string
          run_type?: string
          score: number
          speedy_hits?: number
          stage_key?: string
          suspicion_reasons?: string[]
          suspicious_flag?: boolean
          tier1_ground_award?: number
          tier1_hits?: number
          tier2_ground_award?: number
          tier2_hits?: number
          total_hits?: number
          ultra_fast_reaction_count?: number
          user_id: string
          validation_status: string
        }
        Update: {
          annyongi_hits?: number
          ascension_bonus?: number
          client_version?: string | null
          combo_bonus?: number
          completed_calls?: number
          created_at?: string
          dragon_bursts?: number
          dragon_calls?: number
          duration_ms?: number
          flight_base_points?: number
          flight_hits?: number
          gold_hits?: number
          id?: string
          indeoki_hits?: number
          input_count?: number
          max_combo?: number
          moon_bonus_hits?: number
          normal_hits?: number
          reaction_sample_count?: number
          reject_reason?: string | null
          ruleset_version?: string
          run_id?: string
          run_type?: string
          score?: number
          speedy_hits?: number
          stage_key?: string
          suspicion_reasons?: string[]
          suspicious_flag?: boolean
          tier1_ground_award?: number
          tier1_hits?: number
          tier2_ground_award?: number
          tier2_hits?: number
          total_hits?: number
          ultra_fast_reaction_count?: number
          user_id?: string
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ranked_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ranked_sessions"
            referencedColumns: ["run_id"]
          },
        ]
      }
      ranked_sessions: {
        Row: {
          abandoned_at: string | null
          client_version: string | null
          created_at: string
          expired_at: string | null
          expires_at: string
          finished_at: string | null
          nonce: string
          ruleset_version: string
          run_id: string
          run_type: string
          stage_key: string
          started_at: string
          status: string
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          abandoned_at?: string | null
          client_version?: string | null
          created_at?: string
          expired_at?: string | null
          expires_at?: string
          finished_at?: string | null
          nonce?: string
          ruleset_version?: string
          run_id?: string
          run_type?: string
          stage_key?: string
          started_at?: string
          status?: string
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          abandoned_at?: string | null
          client_version?: string | null
          created_at?: string
          expired_at?: string | null
          expires_at?: string
          finished_at?: string | null
          nonce?: string
          ruleset_version?: string
          run_id?: string
          run_type?: string
          stage_key?: string
          started_at?: string
          status?: string
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      runs: {
        Row: {
          build_id: string | null
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          game_id: string
          game_session_id: string | null
          id: string
          metadata: Json
          mode: string | null
          player_id: string | null
          result: string | null
          score: number | null
          stage_key: string | null
          started_at: string | null
        }
        Insert: {
          build_id?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          game_id: string
          game_session_id?: string | null
          id: string
          metadata?: Json
          mode?: string | null
          player_id?: string | null
          result?: string | null
          score?: number | null
          stage_key?: string | null
          started_at?: string | null
        }
        Update: {
          build_id?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          game_id?: string
          game_session_id?: string | null
          id?: string
          metadata?: Json
          mode?: string | null
          player_id?: string | null
          result?: string | null
          score?: number | null
          stage_key?: string | null
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runs_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "game_builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_game_session_id_fkey"
            columns: ["game_session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_key: string
          awarded_at: string
          condition_version: number
          earned_at: string
          evidence_source: string
          user_id: string
        }
        Insert: {
          achievement_key: string
          awarded_at?: string
          condition_version?: number
          earned_at: string
          evidence_source: string
          user_id: string
        }
        Update: {
          achievement_key?: string
          awarded_at?: string
          condition_version?: number
          earned_at?: string
          evidence_source?: string
          user_id?: string
        }
        Relationships: []
      }
      user_game_progress: {
        Row: {
          first_synced_at: string
          game_id: string
          migrated_from_local: boolean
          progress: Json
          schema_version: number
          updated_at: string
          user_id: string
        }
        Insert: {
          first_synced_at?: string
          game_id: string
          migrated_from_local?: boolean
          progress?: Json
          schema_version?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          first_synced_at?: string
          game_id?: string
          migrated_from_local?: boolean
          progress?: Json
          schema_version?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_game_progress_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      world_accompany_sessions: {
        Row: {
          accepted_at: string | null
          created_at: string
          ended_at: string | null
          ended_reason: string | null
          expires_at: string
          id: string
          invitee_id: string
          inviter_id: string
          place_zone_id: string
          poi_id: string
          state: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          ended_at?: string | null
          ended_reason?: string | null
          expires_at?: string
          id?: string
          invitee_id: string
          inviter_id: string
          place_zone_id: string
          poi_id: string
          state?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          ended_at?: string | null
          ended_reason?: string | null
          expires_at?: string
          id?: string
          invitee_id?: string
          inviter_id?: string
          place_zone_id?: string
          poi_id?: string
          state?: string
        }
        Relationships: []
      }
      world_friendships: {
        Row: {
          accepted_at: string | null
          created_at: string
          requested_by: string
          status: string
          updated_at: string
          user_high: string
          user_low: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          requested_by: string
          status: string
          updated_at?: string
          user_high: string
          user_low: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          requested_by?: string
          status?: string
          updated_at?: string
          user_high?: string
          user_low?: string
        }
        Relationships: []
      }
      world_guestbook_entries: {
        Row: {
          content: string
          created_at: string
          id: string
          is_hidden: boolean
          location_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          location_key?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          location_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      world_online_sessions: {
        Row: {
          last_seen_at: string
          place_zone_id: string | null
          session_id: string
          space: string
          started_at: string
          user_id: string | null
          visitor_id: string | null
        }
        Insert: {
          last_seen_at?: string
          place_zone_id?: string | null
          session_id: string
          space?: string
          started_at?: string
          user_id?: string | null
          visitor_id?: string | null
        }
        Update: {
          last_seen_at?: string
          place_zone_id?: string | null
          session_id?: string
          space?: string
          started_at?: string
          user_id?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      world_player_rooms: {
        Row: {
          created_at: string
          id: string
          owner_user_id: string
          room_type: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_user_id: string
          room_type?: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_user_id?: string
          room_type?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: []
      }
      world_user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: []
      }
      world_user_reports: {
        Row: {
          category: string
          created_at: string
          id: number
          place_zone_id: string | null
          reporter_id: string
          resolution: string | null
          reviewed_at: string | null
          status: string
          target_id: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: never
          place_zone_id?: string | null
          reporter_id: string
          resolution?: string | null
          reviewed_at?: string | null
          status?: string
          target_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: never
          place_zone_id?: string | null
          reporter_id?: string
          resolution?: string | null
          reviewed_at?: string | null
          status?: string
          target_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      leaderboard_public: {
        Row: {
          achieved_at: string | null
          best_combo: number | null
          best_score: number | null
          department_id: number | null
          department_name: string | null
          nickname: string | null
          stage_key: string | null
          title: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abandon_ranked_session_v1: { Args: { p_run_id: string }; Returns: string }
      admin_review_world_user_report_v1: {
        Args: { p_action: string; p_report_id: number }
        Returns: Json
      }
      advance_mcm_2026_event_v1: {
        Args: { p_event: string; p_user: string }
        Returns: Json
      }
      advance_world_first_style_quest_v1: {
        Args: { p_event: string; p_user: string }
        Returns: Json
      }
      advance_world_navigation_quest_v1: {
        Args: { p_event: string; p_user: string }
        Returns: Json
      }
      advance_world_quest_v1: {
        Args: { p_event: string; p_user: string }
        Returns: Json
      }
      answer_my_world_daily_quiz_v1: {
        Args: {
          p_answer_index: number
          p_question_id: string
          p_run_id: string
        }
        Returns: Json
      }
      archive_hub_conversation_v1: {
        Args: { p_archived?: boolean; p_conversation: string }
        Returns: Json
      }
      block_world_user: { Args: { p_target: string }; Returns: Json }
      can_access_world_room_realtime_v1: {
        Args: { p_topic: string }
        Returns: boolean
      }
      cancel_world_friend_request: { Args: { p_target: string }; Returns: Json }
      check_world_room_access_v1: { Args: { p_room: string }; Returns: Json }
      claim_inha_mail_badge: {
        Args: { p_primary_id: string; p_school_id: string }
        Returns: boolean
      }
      claim_my_mcm_2026_main_reward_v1: { Args: never; Returns: Json }
      claim_my_mcm_landlord_first_clear_reward_v1: {
        Args: never
        Returns: Json
      }
      claim_my_world_attendance_v1: { Args: never; Returns: Json }
      claim_world_npc_ai_call_v1: { Args: { p_user: string }; Returns: string }
      claim_world_npc_shared_tick_v1: {
        Args: { p_period: string; p_tick: number }
        Returns: string
      }
      commit_world_npc_shared_tick_v1: {
        Args: {
          p_decisions: Json
          p_effective_at_ms: number
          p_period: string
          p_tick: number
        }
        Returns: Json
      }
      create_qa_ranked_session: {
        Args: {
          p_client_version?: string
          p_ruleset_version?: string
          p_user_id: string
        }
        Returns: {
          expires_at: string
          nonce: string
          ruleset_version: string
          run_id: string
          run_type: string
          started_at: string
        }[]
      }
      create_world_guestbook_entry_v2: {
        Args: { p_content: string; p_location_key?: string }
        Returns: Json
      }
      delete_my_grow_progress: {
        Args: { p_expected_updated_at: string }
        Returns: boolean
      }
      delete_my_inhagame_account_v1: {
        Args: { p_confirmation: string }
        Returns: Json
      }
      delete_world_guestbook_entry_v1: {
        Args: { p_location_key?: string }
        Returns: boolean
      }
      delete_world_guestbook_entry_v2: {
        Args: { p_entry_id: string }
        Returns: boolean
      }
      end_world_accompany: { Args: { p_session_id: string }; Returns: Json }
      equip_my_world_item_v1: {
        Args: { p_idempotency_key: string; p_item_id: string; p_slot: string }
        Returns: Json
      }
      expire_ranked_sessions_v1: { Args: never; Returns: number }
      finish_grow_rank_v1: {
        Args: {
          p_credits: number
          p_department: string
          p_nonce: string
          p_reject_reason?: string
          p_run_id: string
          p_twice_points: number
          p_user_id: string
        }
        Returns: string
      }
      general_badge_code: {
        Args: { p_score: number; p_stars: number }
        Returns: string
      }
      get_general_leaderboard: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          department_id: number
          department_name: string
          nickname: string
          rank: number
          stages_recorded: number
          total_score: number
          user_id: string
        }[]
      }
      get_general_leaderboard_v2: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          department_name: string
          is_me: boolean
          nickname: string
          rank: number
          stages_recorded: number
          total_score: number
        }[]
      }
      get_general_leaderboard_v3: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          department_name: string
          general_badge: string
          is_me: boolean
          nickname: string
          rank: number
          ranked_grade: string
          stages_recorded: number
          total_score: number
          total_stars: number
        }[]
      }
      get_general_leaderboard_v4: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          department_name: string
          general_badge: string
          inha_mail_verified: boolean
          is_me: boolean
          nickname: string
          rank: number
          ranked_grade: string
          stages_recorded: number
          total_score: number
          total_stars: number
        }[]
      }
      get_general_leaderboard_v5: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          department_name: string
          event_badge: string
          general_badge: string
          inha_mail_verified: boolean
          is_me: boolean
          nickname: string
          rank: number
          ranked_grade: string
          stages_recorded: number
          total_score: number
          total_stars: number
        }[]
      }
      get_grow_rank_board: {
        Args: { p_department: string }
        Returns: {
          achieved_at: string
          gpa: number
          nickname: string
          rank: number
        }[]
      }
      get_hub_messages_v1: {
        Args: { p_before?: string; p_conversation: string; p_limit?: number }
        Returns: Json
      }
      get_induck_grow_ops_p1_core_v1: { Args: never; Returns: Json }
      get_induck_grow_ops_p2a_core_v1: { Args: never; Returns: Json }
      get_induck_grow_ops_v1: { Args: never; Returns: Json }
      get_induckup_ranked_leaderboard_v1: {
        Args: { p_limit?: number }
        Returns: {
          achieved_at: string
          best_duration_ms: number
          best_score: number
          best_wave: number
          is_me: boolean
          nickname: string
          rank: number
        }[]
      }
      get_inha_duck_behavior_metrics_v1: { Args: never; Returns: Json }
      get_inha_duck_ops_core_private_v1: {
        Args: { p_token: string }
        Returns: Json
      }
      get_inha_duck_ops_dashboard_core_v1: { Args: never; Returns: Json }
      get_inha_duck_ops_dashboard_v1: { Args: never; Returns: Json }
      get_inha_duck_ops_private_v1: { Args: { p_token: string }; Returns: Json }
      get_inha_duck_ranked_lifecycle_v1: { Args: never; Returns: Json }
      get_inha_duck_ranked_lifecycle_v2: { Args: never; Returns: Json }
      get_inha_duck_stage_transition_v1: { Args: never; Returns: Json }
      get_inha_duck_stage3_sample_alert_v1: { Args: never; Returns: Json }
      get_inha_duck_stage3_sample_gate_v1: { Args: never; Returns: Json }
      get_inha_duck_visit_intent_v1: { Args: never; Returns: Json }
      get_inhagame_hub_ops_core_p1_v1: { Args: never; Returns: Json }
      get_inhagame_hub_ops_v1: { Args: never; Returns: Json }
      get_inhagame_member_activity_ops_v1: {
        Args: { p_token: string }
        Returns: Json
      }
      get_inhagame_member_ops_v1: { Args: { p_token: string }; Returns: Json }
      get_leaderboard: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          best_score: number
          department_id: number
          department_name: string
          nickname: string
          rank: number
          title: string
          user_id: string
        }[]
      }
      get_leaderboard_v2: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          best_score: number
          department_name: string
          is_me: boolean
          nickname: string
          rank: number
          title: string
        }[]
      }
      get_leaderboard_v3: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          best_score: number
          department_name: string
          general_badge: string
          is_me: boolean
          nickname: string
          rank: number
          ranked_grade: string
          total_stars: number
        }[]
      }
      get_leaderboard_v4: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          best_score: number
          department_name: string
          general_badge: string
          inha_mail_verified: boolean
          is_me: boolean
          nickname: string
          rank: number
          ranked_grade: string
          total_stars: number
        }[]
      }
      get_leaderboard_v5: {
        Args: { p_department_id?: number; p_limit?: number }
        Returns: {
          achieved_at: string
          best_combo: number
          best_score: number
          department_name: string
          event_badge: string
          general_badge: string
          inha_mail_verified: boolean
          is_me: boolean
          nickname: string
          rank: number
          ranked_grade: string
          total_stars: number
        }[]
      }
      get_my_achievements: { Args: never; Returns: Json }
      get_my_biryong_progress_v1: { Args: never; Returns: Json }
      get_my_game_progress: {
        Args: { p_game_slug: string }
        Returns: {
          migrated_from_local: boolean
          progress: Json
          schema_version: number
          updated_at: string
        }[]
      }
      get_my_general_rank: {
        Args: never
        Returns: {
          department_id: number
          department_rank: number
          overall_rank: number
          stages_recorded: number
          total_score: number
        }[]
      }
      get_my_general_rank_v2: {
        Args: never
        Returns: {
          department_id: number
          department_rank: number
          general_badge: string
          overall_rank: number
          ranked_grade: string
          stages_recorded: number
          total_score: number
          total_stars: number
        }[]
      }
      get_my_general_rank_v3: {
        Args: never
        Returns: {
          department_id: number
          department_rank: number
          event_badge: string
          general_badge: string
          overall_rank: number
          ranked_grade: string
          stages_recorded: number
          total_score: number
          total_stars: number
        }[]
      }
      get_my_grow_rank_visibility: {
        Args: { p_department: string }
        Returns: boolean
      }
      get_my_hub_conversations_v1: { Args: { p_limit?: number }; Returns: Json }
      get_my_hub_unread_count_v1: { Args: never; Returns: number }
      get_my_induckup_rank_v1: {
        Args: never
        Returns: {
          best_duration_ms: number
          best_score: number
          best_wave: number
          rank: number
        }[]
      }
      get_my_mcm_2026_event_v1: { Args: never; Returns: Json }
      get_my_profile: { Args: never; Returns: Json }
      get_my_rank: {
        Args: never
        Returns: {
          best_score: number
          department_id: number
          department_rank: number
          overall_rank: number
        }[]
      }
      get_my_rank_v2: {
        Args: never
        Returns: {
          best_score: number
          department_id: number
          department_rank: number
          overall_rank: number
        }[]
      }
      get_my_rank_v3: {
        Args: never
        Returns: {
          best_score: number
          department_id: number
          department_rank: number
          general_badge: string
          overall_rank: number
          ranked_grade: string
        }[]
      }
      get_my_rank_v4: {
        Args: never
        Returns: {
          best_score: number
          department_id: number
          department_rank: number
          event_badge: string
          general_badge: string
          overall_rank: number
          ranked_grade: string
        }[]
      }
      get_my_room_knock_v1: { Args: { p_knock: string }; Returns: Json }
      get_my_world_accompany: { Args: never; Returns: Json }
      get_my_world_admin_access_v1: { Args: never; Returns: Json }
      get_world_staff_badges_v1: {
        Args: { p_user_ids: string[] }
        Returns: { user_id: string; badge_code: string }[]
      }
      get_my_world_appearance_loadout_v1: { Args: never; Returns: Json }
      get_my_world_attendance_v1: { Args: never; Returns: Json }
      get_my_world_daily_quiz_v1: { Args: never; Returns: Json }
      get_my_world_inventory_v1: { Args: never; Returns: Json }
      get_my_world_moderation_admin_v1: { Args: never; Returns: Json }
      get_my_world_progression_v1: { Args: never; Returns: Json }
      get_my_world_social: { Args: never; Returns: Json }
      get_my_world_wallet_v1: { Args: never; Returns: Json }
      get_or_create_my_personal_room_v1: { Args: never; Returns: Json }
      get_world_guestbook_v1: {
        Args: { p_before?: string; p_limit?: number; p_location_key?: string }
        Returns: Json
      }
      get_world_guestbook_v2: {
        Args: { p_before?: string; p_limit?: number; p_location_key?: string }
        Returns: Json
      }
      get_world_moderation_ops_v1: { Args: { p_token: string }; Returns: Json }
      get_world_npc_shared_state_v1: { Args: never; Returns: Json }
      get_world_online_count_v1: { Args: never; Returns: Json }
      get_world_online_ops_v1: { Args: { p_token: string }; Returns: Json }
      get_world_public_profile: { Args: { p_target: string }; Returns: Json }
      get_world_relationship: { Args: { p_target: string }; Returns: Json }
      get_world_room_furniture_v1: { Args: { p_room: string }; Returns: Json }
      get_world_shop_v1: { Args: { p_shop_id: string }; Returns: Json }
      induckup_merge_meta_v1: {
        Args: { new_meta: Json; old_meta: Json }
        Returns: Json
      }
      is_inha_mail: { Args: { p_email: string }; Returns: boolean }
      is_permanent_account: { Args: never; Returns: boolean }
      knock_friend_personal_room_v1: { Args: { p_owner: string }; Returns: Json }
      list_my_room_knocks_v1: { Args: never; Returns: Json }
      log_general_progression_event_v1: {
        Args: {
          p_balance_version: string
          p_clear: boolean
          p_client_version: string
          p_device: string
          p_event_type: string
          p_run_id: string
          p_run_type: string
          p_session_id: string
          p_source: string
          p_stage_id: number
          p_target_stage_id: number
          p_visitor_id: string
        }
        Returns: undefined
      }
      log_general_session_start: {
        Args: {
          p_balance_version?: string
          p_client_version?: string
          p_device?: string
          p_run_type?: string
          p_session_id: string
          p_source?: string
          p_visitor_id: string
        }
        Returns: undefined
      }
      log_general_stage_attempt: {
        Args: { p_client_version?: string; p_stage_id: number }
        Returns: undefined
      }
      log_general_stage_attempt_v2: {
        Args: {
          p_client_version?: string
          p_device?: string
          p_run_id: string
          p_run_type?: string
          p_source?: string
          p_stage_id: number
        }
        Returns: undefined
      }
      log_general_stage_attempt_v3: {
        Args: {
          p_balance_version?: string
          p_client_version?: string
          p_device?: string
          p_run_id: string
          p_run_type?: string
          p_session_id: string
          p_source?: string
          p_stage_id: number
          p_visitor_id: string
        }
        Returns: undefined
      }
      log_general_stage_exit: {
        Args: {
          p_client_version?: string
          p_device?: string
          p_duration_ms?: number
          p_exit_state?: string
          p_run_id: string
          p_run_type?: string
          p_source?: string
          p_stage_id: number
        }
        Returns: undefined
      }
      log_general_stage_exit_v2: {
        Args: {
          p_client_version?: string
          p_device?: string
          p_duration_ms?: number
          p_exit_reason?: string
          p_exit_state?: string
          p_run_id: string
          p_run_type?: string
          p_source?: string
          p_stage_id: number
        }
        Returns: undefined
      }
      log_general_stage_exit_v3: {
        Args: {
          p_balance_version?: string
          p_client_version?: string
          p_device?: string
          p_duration_ms?: number
          p_exit_reason?: string
          p_exit_state?: string
          p_run_id: string
          p_run_type?: string
          p_session_id: string
          p_source?: string
          p_stage_id: number
          p_visitor_id: string
        }
        Returns: undefined
      }
      log_general_stage_result: {
        Args: {
          p_clear: boolean
          p_client_version?: string
          p_combo: number
          p_score: number
          p_stage_id: number
          p_stars: number
        }
        Returns: undefined
      }
      log_general_stage_result_v2: {
        Args: {
          p_clear: boolean
          p_client_version?: string
          p_combo: number
          p_device?: string
          p_duration_ms?: number
          p_run_id: string
          p_run_type?: string
          p_score: number
          p_source?: string
          p_stage_id: number
          p_stars: number
        }
        Returns: undefined
      }
      log_general_stage_result_v3: {
        Args: {
          p_annyongi_clicks?: number
          p_balance_version?: string
          p_clear: boolean
          p_client_version?: string
          p_combo: number
          p_device?: string
          p_duration_ms?: number
          p_gold_hits?: number
          p_indeok_hits?: number
          p_run_id: string
          p_run_type?: string
          p_score: number
          p_session_id: string
          p_source?: string
          p_stage_id: number
          p_stars: number
          p_visitor_id: string
        }
        Returns: undefined
      }
      log_general_ui_event_v1: {
        Args: {
          p_balance_version?: string
          p_client_version?: string
          p_device?: string
          p_event_type: string
          p_last_screen?: string
          p_run_type?: string
          p_session_id: string
          p_source?: string
          p_visitor_id: string
        }
        Returns: undefined
      }
      log_induck_grow_analytics_v1: {
        Args: {
          p_acquisition_source?: string
          p_campaign?: string
          p_department?: string
          p_event_id: string
          p_event_type: string
          p_gpa?: number
          p_session_id: string
          p_week?: number
        }
        Returns: boolean
      }
      log_induck_grow_decision_v1: {
        Args: {
          p_acquisition_source?: string
          p_campaign?: string
          p_category: string
          p_choice_id: string
          p_decision_id: string
          p_department: string
          p_event_id: string
          p_session_id: string
          p_week: number
        }
        Returns: boolean
      }
      log_induck_grow_resource_checkpoint_v1: {
        Args: {
          p_acquisition_source?: string
          p_campaign?: string
          p_department: string
          p_event_id: string
          p_free_slots: number
          p_money: number
          p_session_id: string
          p_stamina: number
          p_stress: number
          p_week: number
        }
        Returns: boolean
      }
      log_induck_grow_session_end_v1: {
        Args: {
          p_acquisition_source?: string
          p_campaign?: string
          p_completed?: boolean
          p_department?: string
          p_duration_sec?: number
          p_end_reason?: string
          p_event_id: string
          p_final_gpa?: number
          p_last_screen?: string
          p_last_week?: number
          p_session_id: string
        }
        Returns: boolean
      }
      log_inhagame_game_entry_v1: {
        Args: {
          p_entry_id: string
          p_event_id: string
          p_event_type: string
          p_target: string
        }
        Returns: boolean
      }
      log_inhagame_hub_event_v1: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_session_id: string
          p_surface: string
          p_target?: string
          p_visitor_id: string
        }
        Returns: boolean
      }
      log_inhagame_hub_event_v2: {
        Args: {
          p_acquisition_source?: string
          p_campaign?: string
          p_event_id: string
          p_event_type: string
          p_session_id: string
          p_surface: string
          p_target?: string
          p_visitor_id: string
        }
        Returns: boolean
      }
      mark_hub_conversation_read_v1: {
        Args: { p_conversation: string }
        Returns: Json
      }
      mark_inha_duck_stage3_sample_alert_notified_v1: {
        Args: never
        Returns: Json
      }
      merge_my_biryong_progress_v1: {
        Args: { p_migrated_from_local?: boolean; p_progress: Json }
        Returns: Json
      }
      my_inha_mail_badge: { Args: never; Returns: boolean }
      propose_world_accompany: {
        Args: { p_place_zone_id: string; p_poi_id: string; p_target: string }
        Returns: Json
      }
      purchase_world_shop_listing_v1: {
        Args: { p_idempotency_key: string; p_listing_id: string }
        Returns: Json
      }
      ranked_grade_code: {
        Args: {
          p_completed_calls: number
          p_eclipse: number
          p_flight: number
          p_rare: number
          p_score: number
        }
        Returns: string
      }
      ranked_grade_code_v5: {
        Args: {
          p_completed_calls: number
          p_eclipse: number
          p_flight: number
          p_rare: number
          p_score: number
        }
        Returns: string
      }
      record_general_stage_best: {
        Args: { p_combo?: number; p_score: number; p_stage_id: number }
        Returns: number
      }
      record_general_stage_best_v2: {
        Args: {
          p_combo?: number
          p_score: number
          p_stage_id: number
          p_stars?: number
        }
        Returns: number
      }
      record_induckup_ranked_best_v1: {
        Args: { p_duration_ms: number; p_score: number; p_wave: number }
        Returns: {
          best_duration_ms: number
          best_score: number
          best_wave: number
        }[]
      }
      record_ranked_result: {
        Args: {
          p_annyongi_hits: number
          p_client_version: string
          p_dragon_bursts: number
          p_duration_ms: number
          p_gold_hits: number
          p_indeoki_hits: number
          p_max_combo: number
          p_run_id: string
          p_score: number
          p_total_hits: number
          p_user_id: string
        }
        Returns: string
      }
      record_ranked_result_v3: {
        Args: {
          p_annyongi_hits: number
          p_client_version: string
          p_dragon_calls: number
          p_duration_ms: number
          p_flight_hits: number
          p_gold_hits: number
          p_indeoki_hits: number
          p_input_count?: number
          p_max_combo: number
          p_moon_bonus_hits: number
          p_normal_hits: number
          p_reaction_sample_count?: number
          p_run_id: string
          p_score: number
          p_speedy_hits: number
          p_suspicion_reasons?: string[]
          p_suspicious_flag?: boolean
          p_total_hits: number
          p_ultra_fast_reaction_count?: number
          p_user_id: string
        }
        Returns: string
      }
      record_ranked_result_v4: {
        Args: {
          p_annyongi_hits: number
          p_client_version: string
          p_completed_calls: number
          p_dragon_calls: number
          p_duration_ms: number
          p_flight_hits: number
          p_gold_hits: number
          p_indeoki_hits: number
          p_input_count?: number
          p_max_combo: number
          p_moon_bonus_hits: number
          p_normal_hits: number
          p_reaction_sample_count?: number
          p_run_id: string
          p_score: number
          p_speedy_hits: number
          p_suspicion_reasons?: string[]
          p_suspicious_flag?: boolean
          p_total_hits: number
          p_ultra_fast_reaction_count?: number
          p_user_id: string
        }
        Returns: string
      }
      record_ranked_result_v5: {
        Args: {
          p_annyongi_hits: number
          p_ascension_bonus: number
          p_client_version: string
          p_combo_bonus: number
          p_completed_calls: number
          p_dragon_calls: number
          p_duration_ms: number
          p_flight_base_points: number
          p_flight_hits: number
          p_gold_hits: number
          p_indeoki_hits: number
          p_input_count?: number
          p_max_combo: number
          p_moon_bonus_hits: number
          p_normal_hits: number
          p_reaction_sample_count?: number
          p_run_id: string
          p_score: number
          p_speedy_hits: number
          p_suspicion_reasons?: string[]
          p_suspicious_flag?: boolean
          p_tier1_ground_award: number
          p_tier1_hits: number
          p_tier2_ground_award: number
          p_tier2_hits: number
          p_total_hits: number
          p_ultra_fast_reaction_count?: number
          p_user_id: string
        }
        Returns: string
      }
      remove_world_friend: { Args: { p_target: string }; Returns: Json }
      report_hub_message_v1: {
        Args: { p_category: string; p_message: string }
        Returns: Json
      }
      report_world_user: {
        Args: { p_category: string; p_place_zone_id?: string; p_target: string }
        Returns: Json
      }
      resolve_friend_personal_room_v1: {
        Args: { p_owner: string }
        Returns: Json
      }
      respond_room_knock_v1: {
        Args: { p_accept: boolean; p_knock: string }
        Returns: Json
      }
      respond_world_accompany: {
        Args: { p_accept: boolean; p_session_id: string }
        Returns: Json
      }
      respond_world_friend_request: {
        Args: { p_accept: boolean; p_target: string }
        Returns: Json
      }
      review_world_user_report_ops_v1: {
        Args: { p_action: string; p_report_id: number; p_token: string }
        Returns: Json
      }
      save_my_game_progress: {
        Args: {
          p_game_slug: string
          p_migrated_from_local?: boolean
          p_progress: Json
          p_schema_version?: number
        }
        Returns: Json
      }
      save_my_grow_progress: {
        Args: {
          p_expected_updated_at: string
          p_migrated_from_local?: boolean
          p_progress: Json
        }
        Returns: string
      }
      save_my_room_furniture_v1: {
        Args: { p_objects: Json; p_revision: number; p_room: string }
        Returns: Json
      }
      send_hub_message_v1: {
        Args: { p_body: string; p_recipient: string }
        Returns: Json
      }
      send_world_friend_request: { Args: { p_target: string }; Returns: Json }
      set_my_grow_rank_visibility: {
        Args: { p_department: string; p_public: boolean }
        Returns: boolean
      }
      set_my_personal_room_visibility_v1: {
        Args: { p_visibility: string }
        Returns: Json
      }
      start_mcm_landlord_run_v1: { Args: never; Returns: Json }
      start_my_world_daily_quiz_v1: { Args: never; Returns: Json }
      submit_mcm_landlord_choice_v1: {
        Args: { p_actor_id: string; p_run_id: string }
        Returns: Json
      }
      submit_ranked_recovery_snapshot_v1: {
        Args: {
          p_client_snapshot_id: string
          p_client_version: string
          p_payload: Json
          p_reason: string
          p_ruleset_version: string
          p_session_id: string
          p_visitor_id: string
        }
        Returns: Json
      }
      submit_ranked_recovery_summary_v1: {
        Args: {
          p_best_contract: string
          p_best_score: number
          p_client_version: string
          p_incident_key: string
          p_local_plays: number
        }
        Returns: Json
      }
      sync_inha_duck_general_run: {
        Args: { p_run_id: string }
        Returns: undefined
      }
      sync_inha_duck_ranked_run: {
        Args: { p_run_id: string }
        Returns: undefined
      }
      touch_inhagame_member_activity_v1: {
        Args: { p_surface: string }
        Returns: undefined
      }
      touch_world_online_session_v1: {
        Args: {
          p_place_zone_id?: string
          p_session_id: string
          p_space?: string
        }
        Returns: undefined
      }
      touch_world_online_session_v2: {
        Args: {
          p_place_zone_id?: string
          p_session_id: string
          p_space?: string
          p_visitor_id?: string
        }
        Returns: undefined
      }
      unblock_world_user: { Args: { p_target: string }; Returns: Json }
      unequip_my_world_item_v1: {
        Args: { p_idempotency_key: string; p_slot: string }
        Returns: Json
      }
      update_world_guestbook_entry_v2: {
        Args: { p_content: string; p_entry_id: string }
        Returns: Json
      }
      upsert_world_guestbook_entry_v1: {
        Args: { p_content: string; p_location_key?: string }
        Returns: Json
      }
      verify_inha_duck_ops_basic_v1: {
        Args: { p_basic_sha256: string; p_token: string }
        Returns: boolean
      }
      world_activity_finalize_v1: {
        Args: {
          p_attempt_id: string
          p_outcome_type: string
          p_result_ref?: string
          p_terminal_status: string
          p_user: string
        }
        Returns: Json
      }
      world_activity_start_v1: {
        Args: {
          p_activity_id: string
          p_client_attempt_key: string
          p_definition_version: number
          p_expires_at?: string
          p_resolver_version: number
          p_source_ref: string
          p_user: string
        }
        Returns: Json
      }
      world_collection_discover_v1: {
        Args: {
          p_entry_id: string
          p_idempotency_key: string
          p_metadata?: Json
          p_result_ref: string
          p_source_ref: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_collection_list_v1: { Args: { p_user: string }; Returns: Json }
      world_exp_grant_v1: {
        Args: {
          p_amount: number
          p_idempotency_key: string
          p_source_id: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_inventory_ensure_default_items_v1: {
        Args: { p_user: string }
        Returns: Json
      }
      world_inventory_get_item_v1: {
        Args: { p_item_id: string; p_user: string }
        Returns: Json
      }
      world_inventory_grant_item_v1: {
        Args: {
          p_event_id?: string
          p_idempotency_key: string
          p_item_id: string
          p_metadata?: Json
          p_quantity: number
          p_source_ref: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_inventory_has_item_v1: {
        Args: { p_item_id: string; p_user: string }
        Returns: boolean
      }
      world_inventory_list_v1: { Args: { p_user: string }; Returns: Json }
      world_progression_get_v1: { Args: { p_user: string }; Returns: Json }
      world_reward_get_result_v1: {
        Args: { p_idempotency_key: string }
        Returns: Json
      }
      world_reward_grant_v1: {
        Args: {
          p_idempotency_key: string
          p_reward_id: string
          p_source_id: string
          p_source_type: string
          p_user: string
        }
        Returns: Json
      }
      world_wallet_credit_v1: {
        Args: {
          p_amount: number
          p_currency_id: string
          p_idempotency_key: string
          p_reason?: string
          p_source_id: string
          p_source_type: string
          p_type: string
          p_user: string
        }
        Returns: Json
      }
      world_wallet_debit_v1: {
        Args: {
          p_amount: number
          p_currency_id: string
          p_idempotency_key: string
          p_reason?: string
          p_source_id: string
          p_source_type: string
          p_type: string
          p_user: string
        }
        Returns: Json
      }
      world_wallet_get_balance_v1: {
        Args: { p_currency_id: string; p_user: string }
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
  analytics: {
    Enums: {},
  },
  private: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

