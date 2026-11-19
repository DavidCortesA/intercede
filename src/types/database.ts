export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      addons: {
        Row: {
          community_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          kind: string;
          minutes_remaining: number | null;
          order_id: string | null;
          quantity: number;
        };
        ComputedFields: never;
        Insert: {
          community_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          kind: string;
          minutes_remaining?: number | null;
          order_id?: string | null;
          quantity?: number;
        };
        Update: {
          community_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          kind?: string;
          minutes_remaining?: number | null;
          order_id?: string | null;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "addons_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "addons_kind_fkey";
            columns: ["kind"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "addons_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
        };
        ComputedFields: never;
        Insert: {
          blocked_id: string;
          blocker_id?: string;
          created_at?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      breakout_assignments: {
        Row: {
          breakout_id: string;
          group_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          breakout_id: string;
          group_id: string;
          user_id: string;
        };
        Update: {
          breakout_id?: string;
          group_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "breakout_assignments_breakout_id_fkey";
            columns: ["breakout_id"];
            isOneToOne: false;
            referencedRelation: "room_breakouts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "breakout_assignments_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "breakout_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      breakout_groups: {
        Row: {
          breakout_id: string;
          id: string;
          livekit_room: string;
          name: string;
          position: number;
          request_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          breakout_id: string;
          id?: string;
          livekit_room: string;
          name: string;
          position: number;
          request_id?: string | null;
        };
        Update: {
          breakout_id?: string;
          id?: string;
          livekit_room?: string;
          name?: string;
          position?: number;
          request_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "breakout_groups_breakout_id_fkey";
            columns: ["breakout_id"];
            isOneToOne: false;
            referencedRelation: "room_breakouts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "breakout_groups_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "prayer_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      communities: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          kind: string;
          logo_url: string | null;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          kind?: string;
          logo_url?: string | null;
          name: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          kind?: string;
          logo_url?: string | null;
          name?: string;
        };
        Relationships: [];
      };
      community_brands: {
        Row: {
          accent: string;
          community_id: string;
          display_name: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          accent: string;
          community_id: string;
          display_name?: string | null;
          updated_at?: string;
        };
        Update: {
          accent?: string;
          community_id?: string;
          display_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_brands_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: true;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      community_invites: {
        Row: {
          community_id: string;
          created_at: string;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          community_id: string;
          created_at?: string;
          token?: string;
        };
        Update: {
          community_id?: string;
          created_at?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_invites_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: true;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      community_members: {
        Row: {
          avatar_url: string | null;
          community_id: string;
          display_name: string;
          joined_at: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          community_id: string;
          display_name: string;
          joined_at?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          avatar_url?: string | null;
          community_id?: string;
          display_name?: string;
          joined_at?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      community_request_support: {
        Row: {
          community_id: string;
          created_at: string;
          request_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          community_id: string;
          created_at?: string;
          request_id: string;
          user_id?: string;
        };
        Update: {
          community_id?: string;
          created_at?: string;
          request_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_request_support_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_request_support_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "community_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      community_requests: {
        Row: {
          answered_at: string | null;
          author_id: string;
          community_id: string;
          content: string;
          created_at: string;
          id: string;
          is_answered: boolean;
          testimony: string | null;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          answered_at?: string | null;
          author_id?: string;
          community_id: string;
          content: string;
          created_at?: string;
          id?: string;
          is_answered?: boolean;
          testimony?: string | null;
          visibility?: string;
        };
        Update: {
          answered_at?: string | null;
          author_id?: string;
          community_id?: string;
          content?: string;
          created_at?: string;
          id?: string;
          is_answered?: boolean;
          testimony?: string | null;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_requests_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      devotional_progress: {
        Row: {
          devotional_id: string;
          note: string | null;
          read_at: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          devotional_id: string;
          note?: string | null;
          read_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          devotional_id?: string;
          note?: string | null;
          read_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "devotional_progress_devotional_id_fkey";
            columns: ["devotional_id"];
            isOneToOne: false;
            referencedRelation: "devotionals";
            referencedColumns: ["id"];
          },
        ];
      };
      devotionals: {
        Row: {
          bible_version: string;
          community_id: string | null;
          created_at: string;
          devotional_date: string;
          id: string;
          passage_reference: string;
          passage_text: string;
          question: string;
          reflection: string;
          suggested_prayer: string | null;
        };
        ComputedFields: never;
        Insert: {
          bible_version: string;
          community_id?: string | null;
          created_at?: string;
          devotional_date: string;
          id?: string;
          passage_reference: string;
          passage_text: string;
          question: string;
          reflection: string;
          suggested_prayer?: string | null;
        };
        Update: {
          bible_version?: string;
          community_id?: string | null;
          created_at?: string;
          devotional_date?: string;
          id?: string;
          passage_reference?: string;
          passage_text?: string;
          question?: string;
          reflection?: string;
          suggested_prayer?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "devotionals_community_fk";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      event_rsvps: {
        Row: {
          event_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          event_id: string;
          status: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          event_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          community_id: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string;
          id: string;
          opens_room: boolean;
          reminder_minutes: number;
          room_id: string | null;
          starts_at: string;
          timezone: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          community_id: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          ends_at: string;
          id?: string;
          opens_room?: boolean;
          reminder_minutes?: number;
          room_id?: string | null;
          starts_at: string;
          timezone: string;
          title: string;
        };
        Update: {
          community_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          ends_at?: string;
          id?: string;
          opens_room?: boolean;
          reminder_minutes?: number;
          room_id?: string | null;
          starts_at?: string;
          timezone?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          devotional_reminder: boolean;
          devotional_reminder_time: string;
          email_enabled: boolean;
          push_enabled: boolean;
          schedule_reminders: boolean;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          devotional_reminder?: boolean;
          devotional_reminder_time?: string;
          email_enabled?: boolean;
          push_enabled?: boolean;
          schedule_reminders?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          devotional_reminder?: boolean;
          devotional_reminder_time?: string;
          email_enabled?: boolean;
          push_enabled?: boolean;
          schedule_reminders?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string;
          claimed_at: string | null;
          created_at: string;
          dedupe_key: string;
          delivery_error: string | null;
          email_sent_at: string | null;
          email_state: string;
          id: string;
          kind: string;
          push_sent_at: string | null;
          push_state: string;
          read_at: string | null;
          title: string;
          url: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          claimed_at?: string | null;
          created_at?: string;
          dedupe_key: string;
          delivery_error?: string | null;
          email_sent_at?: string | null;
          email_state?: string;
          id?: string;
          kind: string;
          push_sent_at?: string | null;
          push_state?: string;
          read_at?: string | null;
          title: string;
          url: string;
          user_id: string;
        };
        Update: {
          body?: string;
          claimed_at?: string | null;
          created_at?: string;
          dedupe_key?: string;
          delivery_error?: string | null;
          email_sent_at?: string | null;
          email_state?: string;
          id?: string;
          kind?: string;
          push_sent_at?: string | null;
          push_state?: string;
          read_at?: string | null;
          title?: string;
          url?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          amount_mxn: number;
          billing_period: string | null;
          buyer_id: string | null;
          checkout_url: string | null;
          community_id: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          item_code: string;
          kind: string;
          paid_at: string | null;
          provider: string;
          provider_order_id: string | null;
          quantity: number;
          room_id: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          amount_mxn: number;
          billing_period?: string | null;
          buyer_id?: string | null;
          checkout_url?: string | null;
          community_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          item_code: string;
          kind: string;
          paid_at?: string | null;
          provider?: string;
          provider_order_id?: string | null;
          quantity?: number;
          room_id?: string | null;
          status?: string;
        };
        Update: {
          amount_mxn?: number;
          billing_period?: string | null;
          buyer_id?: string | null;
          checkout_url?: string | null;
          community_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          item_code?: string;
          kind?: string;
          paid_at?: string | null;
          provider?: string;
          provider_order_id?: string | null;
          quantity?: number;
          room_id?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      passes: {
        Row: {
          buyer_id: string | null;
          community_id: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          limits: NonNullable<Json>;
          order_id: string | null;
          product_code: string;
          room_id: string | null;
          starts_at: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          buyer_id?: string | null;
          community_id?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          limits: NonNullable<Json>;
          order_id?: string | null;
          product_code: string;
          room_id?: string | null;
          starts_at?: string | null;
          status?: string;
        };
        Update: {
          buyer_id?: string | null;
          community_id?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          limits?: NonNullable<Json>;
          order_id?: string | null;
          product_code?: string;
          room_id?: string | null;
          starts_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "passes_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "passes_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "passes_product_code_fkey";
            columns: ["product_code"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "passes_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_events: {
        Row: {
          error: string | null;
          id: string;
          payload: NonNullable<Json>;
          processed_at: string | null;
          provider: string;
          provider_event_id: string;
          received_at: string;
          type: string;
        };
        ComputedFields: never;
        Insert: {
          error?: string | null;
          id?: string;
          payload: NonNullable<Json>;
          processed_at?: string | null;
          provider: string;
          provider_event_id: string;
          received_at?: string;
          type: string;
        };
        Update: {
          error?: string | null;
          id?: string;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          provider?: string;
          provider_event_id?: string;
          received_at?: string;
          type?: string;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          annual_price_mxn: number;
          code: string;
          limits: NonNullable<Json>;
          monthly_price_mxn: number;
          name: string;
          sort_order: number;
          trial_days: number;
        };
        ComputedFields: never;
        Insert: {
          annual_price_mxn?: number;
          code: string;
          limits: NonNullable<Json>;
          monthly_price_mxn?: number;
          name: string;
          sort_order?: number;
          trial_days?: number;
        };
        Update: {
          annual_price_mxn?: number;
          code?: string;
          limits?: NonNullable<Json>;
          monthly_price_mxn?: number;
          name?: string;
          sort_order?: number;
          trial_days?: number;
        };
        Relationships: [];
      };
      prayer_guides: {
        Row: {
          community_id: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_system: boolean;
          language: string;
          segments: NonNullable<Json>;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          community_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          language?: string;
          segments: NonNullable<Json>;
          title: string;
        };
        Update: {
          community_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          language?: string;
          segments?: NonNullable<Json>;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prayer_guides_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      prayer_journal_entries: {
        Row: {
          answered_at: string | null;
          category: string;
          content: string;
          created_at: string;
          id: string;
          source_request_id: string | null;
          status: string;
          testimony: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          answered_at?: string | null;
          category?: string;
          content: string;
          created_at?: string;
          id?: string;
          source_request_id?: string | null;
          status?: string;
          testimony?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          answered_at?: string | null;
          category?: string;
          content?: string;
          created_at?: string;
          id?: string;
          source_request_id?: string | null;
          status?: string;
          testimony?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prayer_journal_entries_source_request_id_fkey";
            columns: ["source_request_id"];
            isOneToOne: false;
            referencedRelation: "prayer_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      prayer_requests: {
        Row: {
          answered_at: string | null;
          author_id: string;
          content: string;
          created_at: string;
          id: string;
          is_answered: boolean;
          room_id: string;
          testimony: string | null;
        };
        ComputedFields: never;
        Insert: {
          answered_at?: string | null;
          author_id?: string;
          content: string;
          created_at?: string;
          id?: string;
          is_answered?: boolean;
          room_id: string;
          testimony?: string | null;
        };
        Update: {
          answered_at?: string | null;
          author_id?: string;
          content?: string;
          created_at?: string;
          id?: string;
          is_answered?: boolean;
          room_id?: string;
          testimony?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "prayer_requests_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      prayer_support: {
        Row: {
          created_at: string;
          request_id: string;
          room_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          request_id: string;
          room_id: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          request_id?: string;
          room_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prayer_support_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "prayer_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prayer_support_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          code: string;
          is_monthly: boolean;
          kind: string;
          limits: NonNullable<Json>;
          name: string;
          org_price_mxn: number | null;
          price_mxn: number;
          sort_order: number;
        };
        ComputedFields: never;
        Insert: {
          code: string;
          is_monthly?: boolean;
          kind: string;
          limits?: NonNullable<Json>;
          name: string;
          org_price_mxn?: number | null;
          price_mxn: number;
          sort_order?: number;
        };
        Update: {
          code?: string;
          is_monthly?: boolean;
          kind?: string;
          limits?: NonNullable<Json>;
          name?: string;
          org_price_mxn?: number | null;
          price_mxn?: number;
          sort_order?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          locale: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id: string;
          locale?: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          locale?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_seen_at: string;
          p256dh: string;
          user_agent: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_seen_at?: string;
          p256dh: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_seen_at?: string;
          p256dh?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          community_id: string | null;
          created_at: string;
          details: string | null;
          id: string;
          reason: string;
          reporter_id: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
          target_id: string;
          target_type: string;
          target_user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          community_id?: string | null;
          created_at?: string;
          details?: string | null;
          id?: string;
          reason: string;
          reporter_id?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          target_id: string;
          target_type: string;
          target_user_id?: string | null;
        };
        Update: {
          community_id?: string | null;
          created_at?: string;
          details?: string | null;
          id?: string;
          reason?: string;
          reporter_id?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          target_id?: string;
          target_type?: string;
          target_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reports_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      room_breakouts: {
        Row: {
          announced_at: string | null;
          announcement: string | null;
          ended_at: string | null;
          ends_at: string;
          id: string;
          minutes: number;
          room_id: string;
          started_at: string;
          started_by: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          announced_at?: string | null;
          announcement?: string | null;
          ended_at?: string | null;
          ends_at: string;
          id?: string;
          minutes: number;
          room_id: string;
          started_at?: string;
          started_by?: string | null;
          status?: string;
        };
        Update: {
          announced_at?: string | null;
          announcement?: string | null;
          ended_at?: string | null;
          ends_at?: string;
          id?: string;
          minutes?: number;
          room_id?: string;
          started_at?: string;
          started_by?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_breakouts_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      room_display_links: {
        Row: {
          created_at: string;
          room_id: string;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          room_id: string;
          token?: string;
        };
        Update: {
          created_at?: string;
          room_id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_display_links_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: true;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      room_guide_runs: {
        Row: {
          base_elapsed_ms: number;
          extra_ms: number[];
          guide_id: string | null;
          room_id: string;
          running_since: string | null;
          segments: NonNullable<Json>;
          started_at: string;
          status: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          base_elapsed_ms?: number;
          extra_ms: number[];
          guide_id?: string | null;
          room_id: string;
          running_since?: string | null;
          segments: NonNullable<Json>;
          started_at?: string;
          status: string;
          title: string;
        };
        Update: {
          base_elapsed_ms?: number;
          extra_ms?: number[];
          guide_id?: string | null;
          room_id?: string;
          running_since?: string | null;
          segments?: NonNullable<Json>;
          started_at?: string;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_guide_runs_guide_id_fkey";
            columns: ["guide_id"];
            isOneToOne: false;
            referencedRelation: "prayer_guides";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "room_guide_runs_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: true;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      room_members: {
        Row: {
          avatar_url: string | null;
          display_name: string;
          joined_at: string;
          left_at: string | null;
          removed_at: string | null;
          role: string;
          room_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          display_name: string;
          joined_at?: string;
          left_at?: string | null;
          removed_at?: string | null;
          role?: string;
          room_id: string;
          user_id: string;
        };
        Update: {
          avatar_url?: string | null;
          display_name?: string;
          joined_at?: string;
          left_at?: string | null;
          removed_at?: string | null;
          role?: string;
          room_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_members_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      room_schedules: {
        Row: {
          community_id: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          last_room_id: string | null;
          local_time: string;
          name: string;
          next_occurrence_at: string | null;
          owner_id: string;
          recurrence: string;
          reminder_minutes: number;
          start_date: string;
          timezone: string;
          weekdays: number[];
        };
        ComputedFields: never;
        Insert: {
          community_id?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          last_room_id?: string | null;
          local_time: string;
          name: string;
          next_occurrence_at?: string | null;
          owner_id: string;
          recurrence: string;
          reminder_minutes?: number;
          start_date: string;
          timezone: string;
          weekdays?: number[];
        };
        Update: {
          community_id?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          last_room_id?: string | null;
          local_time?: string;
          name?: string;
          next_occurrence_at?: string | null;
          owner_id?: string;
          recurrence?: string;
          reminder_minutes?: number;
          start_date?: string;
          timezone?: string;
          weekdays?: number[];
        };
        Relationships: [
          {
            foreignKeyName: "room_schedules_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "room_schedules_last_room_id_fkey";
            columns: ["last_room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      rooms: {
        Row: {
          closed_at: string | null;
          code: string;
          community_id: string | null;
          created_at: string;
          ends_at: string;
          focus_request_id: string | null;
          host_id: string;
          id: string;
          is_locked: boolean;
          max_participants: number;
          name: string;
          schedule_id: string | null;
          scheduled_at: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          closed_at?: string | null;
          code: string;
          community_id?: string | null;
          created_at?: string;
          ends_at: string;
          focus_request_id?: string | null;
          host_id: string;
          id?: string;
          is_locked?: boolean;
          max_participants: number;
          name: string;
          schedule_id?: string | null;
          scheduled_at?: string | null;
          status?: string;
        };
        Update: {
          closed_at?: string | null;
          code?: string;
          community_id?: string | null;
          created_at?: string;
          ends_at?: string;
          focus_request_id?: string | null;
          host_id?: string;
          id?: string;
          is_locked?: boolean;
          max_participants?: number;
          name?: string;
          schedule_id?: string | null;
          scheduled_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rooms_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rooms_focus_request_id_fkey";
            columns: ["focus_request_id"];
            isOneToOne: false;
            referencedRelation: "prayer_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rooms_schedule_id_fkey";
            columns: ["schedule_id"];
            isOneToOne: false;
            referencedRelation: "room_schedules";
            referencedColumns: ["id"];
          },
        ];
      };
      schedule_invites: {
        Row: {
          created_at: string;
          schedule_id: string;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          schedule_id: string;
          token?: string;
        };
        Update: {
          created_at?: string;
          schedule_id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_invites_schedule_id_fkey";
            columns: ["schedule_id"];
            isOneToOne: true;
            referencedRelation: "room_schedules";
            referencedColumns: ["id"];
          },
        ];
      };
      schedule_subscriptions: {
        Row: {
          created_at: string;
          schedule_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          schedule_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          schedule_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_subscriptions_schedule_id_fkey";
            columns: ["schedule_id"];
            isOneToOne: false;
            referencedRelation: "room_schedules";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          billing_period: string;
          cancel_at_period_end: boolean;
          community_id: string | null;
          created_at: string;
          current_period_end: string;
          id: string;
          owner_type: string;
          plan_code: string;
          provider: string;
          provider_subscription_id: string | null;
          status: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          billing_period?: string;
          cancel_at_period_end?: boolean;
          community_id?: string | null;
          created_at?: string;
          current_period_end: string;
          id?: string;
          owner_type: string;
          plan_code: string;
          provider?: string;
          provider_subscription_id?: string | null;
          status: string;
          user_id?: string | null;
        };
        Update: {
          billing_period?: string;
          cancel_at_period_end?: boolean;
          community_id?: string | null;
          created_at?: string;
          current_period_end?: string;
          id?: string;
          owner_type?: string;
          plan_code?: string;
          provider?: string;
          provider_subscription_id?: string | null;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: true;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_plan_code_fkey";
            columns: ["plan_code"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["code"];
          },
        ];
      };
      usage_events: {
        Row: {
          community_id: string | null;
          id: string;
          joined_at: string;
          left_at: string;
          livekit_event_id: string;
          minutes: number;
          room_id: string | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          community_id?: string | null;
          id?: string;
          joined_at: string;
          left_at: string;
          livekit_event_id: string;
          minutes: number;
          room_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          community_id?: string | null;
          id?: string;
          joined_at?: string;
          left_at?: string;
          livekit_event_id?: string;
          minutes?: number;
          room_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "usage_events_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_events_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      usage_periods: {
        Row: {
          community_id: string;
          pack_minutes_used: number;
          period: string;
          person_minutes: number;
        };
        ComputedFields: never;
        Insert: {
          community_id: string;
          pack_minutes_used?: number;
          period: string;
          person_minutes?: number;
        };
        Update: {
          community_id?: string;
          pack_minutes_used?: number;
          period?: string;
          person_minutes?: number;
        };
        Relationships: [
          {
            foreignKeyName: "usage_periods_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accent_contrast_ok: { Args: { p_hex: string }; Returns: boolean };
      announce_breakout: {
        Args: { p_message: string; p_room_id: string };
        Returns: undefined;
      };
      apply_pass: {
        Args: { p_pass_id: string; p_room_id: string };
        Returns: undefined;
      };
      apply_pass_to_room: {
        Args: { p_pass_id: string; p_room_id: string };
        Returns: undefined;
      };
      attach_order_checkout: {
        Args: {
          p_checkout_url: string;
          p_expires_at: string;
          p_order_id: string;
          p_provider_order_id: string;
        };
        Returns: undefined;
      };
      block_user: { Args: { p_user_id: string }; Returns: undefined };
      breakout_group_rooms: { Args: { p_room_id: string }; Returns: string[] };
      breakout_main_room: { Args: { p_livekit_room: string }; Returns: string };
      breakout_room: { Args: { p_breakout_id: string }; Returns: string };
      can_manage_schedule: {
        Args: { p_schedule_id: string };
        Returns: boolean;
      };
      claim_notifications: { Args: { p_limit?: number }; Returns: Json };
      clear_community_brand: {
        Args: { p_community_id: string };
        Returns: undefined;
      };
      close_room: { Args: { p_room_id: string }; Returns: undefined };
      close_room_system: { Args: { p_room_id: string }; Returns: undefined };
      community_billing: { Args: { p_community_id: string }; Returns: Json };
      community_brand: { Args: { p_community_id: string }; Returns: Json };
      community_role: { Args: { p_community_id: string }; Returns: string };
      community_stats: { Args: { p_community_id: string }; Returns: Json };
      compute_next_occurrence: {
        Args: {
          p_after: string;
          p_local_time: string;
          p_recurrence: string;
          p_start_date: string;
          p_timezone: string;
          p_weekdays: number[];
        };
        Returns: string;
      };
      control_guide: {
        Args: { p_action: string; p_room_id: string };
        Returns: undefined;
      };
      create_community: {
        Args: { p_description?: string; p_kind?: string; p_name: string };
        Returns: string;
      };
      create_community_room: {
        Args: {
          p_community_id: string;
          p_display_name: string;
          p_name: string;
        };
        Returns: {
          room_code: string;
          room_id: string;
        }[];
      };
      create_display_link: { Args: { p_room_id: string }; Returns: string };
      create_event: {
        Args: {
          p_community_id: string;
          p_date: string;
          p_description: string;
          p_duration_minutes?: number;
          p_opens_room?: boolean;
          p_reminder_minutes?: number;
          p_time: string;
          p_timezone: string;
          p_title: string;
        };
        Returns: string;
      };
      create_guide: {
        Args: {
          p_community_id: string;
          p_description: string;
          p_segments: Json;
          p_title: string;
        };
        Returns: string;
      };
      create_order: {
        Args: {
          p_code: string;
          p_community_id?: string;
          p_kind: string;
          p_period?: string;
          p_quantity?: number;
          p_room_id?: string;
        };
        Returns: {
          amount_mxn: number;
          item_name: string;
          order_id: string;
        }[];
      };
      create_report: {
        Args: {
          p_community_id?: string;
          p_details?: string;
          p_reason: string;
          p_target_id: string;
          p_type: string;
        };
        Returns: string;
      };
      create_room: {
        Args: { p_display_name: string; p_name: string };
        Returns: {
          room_code: string;
          room_id: string;
        }[];
      };
      create_schedule: {
        Args: {
          p_community_id?: string;
          p_local_time: string;
          p_name: string;
          p_recurrence: string;
          p_reminder_minutes?: number;
          p_start_date: string;
          p_timezone: string;
          p_weekdays: number[];
        };
        Returns: string;
      };
      delete_guide: { Args: { p_guide_id: string }; Returns: undefined };
      devotional_stats: {
        Args: Record<PropertyKey, never>;
        Returns: {
          read_today: boolean;
          streak: number;
          total_read: number;
        }[];
      };
      display_state: {
        Args: { p_code: string; p_token: string };
        Returns: Json;
      };
      end_breakout: { Args: { p_room_id: string }; Returns: string[] };
      end_expired_breakouts: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      entitlements_for: { Args: { p_community_id?: string }; Returns: Json };
      expire_passes: { Args: Record<PropertyKey, never>; Returns: undefined };
      fail_order: {
        Args: { p_order_id: string; p_status: string };
        Returns: undefined;
      };
      finish_notification: {
        Args: {
          p_dead_endpoints?: string[];
          p_email_state: string;
          p_error?: string;
          p_id: string;
          p_push_state: string;
        };
        Returns: undefined;
      };
      finish_payment_event: {
        Args: { p_error?: string; p_id: string };
        Returns: undefined;
      };
      follow_community_schedule: {
        Args: { p_schedule_id: string };
        Returns: undefined;
      };
      fulfill_order: { Args: { p_order_id: string }; Returns: Json };
      generate_room_code: { Args: Record<PropertyKey, never>; Returns: string };
      get_breakout_access: {
        Args: { p_group_id: string; p_room_id: string };
        Returns: {
          ends_at: string;
          livekit_room: string;
        }[];
      };
      get_community_invite: {
        Args: { p_community_id: string };
        Returns: string;
      };
      get_entitlements: { Args: { p_community_id?: string }; Returns: Json };
      get_schedule_invite: { Args: { p_schedule_id: string }; Returns: string };
      get_server_time: { Args: Record<PropertyKey, never>; Returns: string };
      guide_segment_at: {
        Args: { p_extra: number[]; p_pos: number; p_segments: Json };
        Returns: {
          idx: number;
          seg_end: number;
          seg_start: number;
        }[];
      };
      has_joined_room: { Args: { p_room_id: string }; Returns: boolean };
      hex_luminance: { Args: { p_hex: string }; Returns: number };
      in_breakout_group: { Args: { p_group_id: string }; Returns: boolean };
      invoke_dispatcher: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      invoke_enforcer: { Args: Record<PropertyKey, never>; Returns: undefined };
      is_allowed_push_endpoint: {
        Args: { p_endpoint: string };
        Returns: boolean;
      };
      is_blocked_between: { Args: { p_other: string }; Returns: boolean };
      is_community_admin: {
        Args: { p_community_id: string };
        Returns: boolean;
      };
      is_community_admin_folder: {
        Args: { p_folder: string };
        Returns: boolean;
      };
      is_community_leader: {
        Args: { p_community_id: string };
        Returns: boolean;
      };
      is_community_member: {
        Args: { p_community_id: string };
        Returns: boolean;
      };
      is_event_member: { Args: { p_event_id: string }; Returns: boolean };
      is_permanent_user: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_room_host: { Args: { p_room_id: string }; Returns: boolean };
      is_room_member: { Args: { p_room_id: string }; Returns: boolean };
      is_room_open: { Args: { p_room_id: string }; Returns: boolean };
      is_schedule_owner: { Args: { p_schedule_id: string }; Returns: boolean };
      is_schedule_subscriber: {
        Args: { p_schedule_id: string };
        Returns: boolean;
      };
      join_community: { Args: { p_token: string }; Returns: string };
      join_room: {
        Args: { p_code: string; p_display_name: string };
        Returns: string;
      };
      leave_community: { Args: { p_community_id: string }; Returns: undefined };
      leave_room: { Args: { p_room_id: string }; Returns: undefined };
      new_invite_token: { Args: Record<PropertyKey, never>; Returns: string };
      normalize_brand_name: { Args: { p_name: string }; Returns: string };
      peek_community: {
        Args: { p_token: string };
        Returns: {
          description: string;
          kind: string;
          logo_url: string;
          members: number;
          name: string;
        }[];
      };
      peek_room: {
        Args: { p_code: string };
        Returns: {
          active_members: number;
          is_locked: boolean;
          name: string;
          status: string;
        }[];
      };
      peek_schedule: {
        Args: { p_token: string };
        Returns: {
          is_active: boolean;
          local_time: string;
          name: string;
          recurrence: string;
          timezone: string;
          weekdays: number[];
        }[];
      };
      prepare_account_deletion: { Args: { p_user_id: string }; Returns: Json };
      process_scheduled_work: { Args: { p_now?: string }; Returns: Json };
      purge_inactive_guests: {
        Args: { p_days?: number; p_only?: string[] };
        Returns: number;
      };
      record_payment_event: {
        Args: {
          p_event_id: string;
          p_payload: Json;
          p_provider: string;
          p_type: string;
        };
        Returns: {
          already_processed: boolean;
          event_row_id: string;
        }[];
      };
      record_usage: {
        Args: {
          p_event_id: string;
          p_joined_at: string;
          p_left_at: string;
          p_room_id: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      refund_order: { Args: { p_order_id: string }; Returns: undefined };
      regenerate_community_invite: {
        Args: { p_community_id: string };
        Returns: string;
      };
      regenerate_schedule_invite: {
        Args: { p_schedule_id: string };
        Returns: string;
      };
      remove_community_member: {
        Args: { p_community_id: string; p_user_id: string };
        Returns: undefined;
      };
      remove_member: {
        Args: { p_room_id: string; p_user_id: string };
        Returns: undefined;
      };
      resolve_report: {
        Args: { p_report_id: string; p_status: string };
        Returns: undefined;
      };
      revoke_display_link: { Args: { p_room_id: string }; Returns: undefined };
      rooms_over_limit: { Args: Record<PropertyKey, never>; Returns: string[] };
      security_audit: {
        Args: Record<PropertyKey, never>;
        Returns: {
          category: string;
          detail: string;
          object_name: string;
        }[];
      };
      set_community_brand: {
        Args: {
          p_accent: string;
          p_community_id: string;
          p_display_name: string;
        };
        Returns: undefined;
      };
      set_member_role: {
        Args: { p_community_id: string; p_role: string; p_user_id: string };
        Returns: undefined;
      };
      set_room_focus: {
        Args: { p_request_id: string; p_room_id: string };
        Returns: undefined;
      };
      set_room_locked: {
        Args: { p_locked: boolean; p_room_id: string };
        Returns: undefined;
      };
      set_rsvp: {
        Args: { p_event_id: string; p_status: string };
        Returns: undefined;
      };
      set_schedule_active: {
        Args: { p_active: boolean; p_schedule_id: string };
        Returns: undefined;
      };
      shares_context_with: { Args: { p_user_id: string }; Returns: boolean };
      start_breakout: {
        Args: {
          p_assignments?: Json;
          p_group_count: number;
          p_minutes: number;
          p_requests?: string[];
          p_room_id: string;
        };
        Returns: string;
      };
      start_guide: {
        Args: { p_guide_id: string; p_room_id: string };
        Returns: undefined;
      };
      subscribe_to_schedule: { Args: { p_token: string }; Returns: string };
      upsert_push_subscription: {
        Args: {
          p_auth: string;
          p_endpoint: string;
          p_p256dh: string;
          p_user_agent?: string;
        };
        Returns: undefined;
      };
      valid_guide_segments: { Args: { p_segments: Json }; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
