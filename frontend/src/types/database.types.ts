/**
 * Supabase Database types for the schema in supabase/migrations/.
 *
 * Written in the `supabase gen types typescript` output format so it can be
 * regenerated once the Supabase CLI is in use:
 *   npx supabase gen types typescript --db-url "$DATABASE_URL"
 *
 * These mirror the database exactly (snake_case, check-constrained text as
 * plain string). App code should use the camelCase domain types in
 * `domain.ts` and map at the service boundary.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      budgets: {
        Row: {
          id: string
          user_id: string
          category_id: string | null
          amount_minor: number
          currency: string
          period: string
          starts_on: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          category_id?: string | null
          amount_minor: number
          currency: string
          period?: string
          starts_on: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          category_id?: string | null
          amount_minor?: number
          currency?: string
          period?: string
          starts_on?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'budgets_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'budgets_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'budgets_currency_fkey'
            columns: ['currency']
            isOneToOne: false
            referencedRelation: 'currencies'
            referencedColumns: ['code']
          },
        ]
      }
      categories: {
        Row: {
          id: string
          user_id: string | null
          name: string
          icon: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          name: string
          icon?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          name?: string
          icon?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'categories_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          name: string
          symbol: string
          decimal_digits: number
        }
        Insert: {
          code: string
          name: string
          symbol: string
          decimal_digits?: number
        }
        Update: {
          code?: string
          name?: string
          symbol?: string
          decimal_digits?: number
        }
        Relationships: []
      }
      expense_comments: {
        Row: {
          id: string
          expense_id: string
          user_id: string
          body: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          expense_id: string
          user_id: string
          body: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          expense_id?: string
          user_id?: string
          body?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'expense_comments_expense_id_fkey'
            columns: ['expense_id']
            isOneToOne: false
            referencedRelation: 'expenses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expense_comments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      expense_item_shares: {
        Row: {
          item_id: string
          user_id: string
        }
        Insert: {
          item_id: string
          user_id: string
        }
        Update: {
          item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'expense_item_shares_item_id_fkey'
            columns: ['item_id']
            isOneToOne: false
            referencedRelation: 'expense_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expense_item_shares_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      expense_items: {
        Row: {
          id: string
          expense_id: string
          description: string
          amount_minor: number
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          expense_id: string
          description: string
          amount_minor: number
          position?: number
          created_at?: string
        }
        Update: {
          id?: string
          expense_id?: string
          description?: string
          amount_minor?: number
          position?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'expense_items_expense_id_fkey'
            columns: ['expense_id']
            isOneToOne: false
            referencedRelation: 'expenses'
            referencedColumns: ['id']
          },
        ]
      }
      expense_splits: {
        Row: {
          id: string
          expense_id: string
          user_id: string
          owed_minor: number
          share_basis_points: number | null
          share_units: number | null
          method: string
        }
        Insert: {
          id?: string
          expense_id: string
          user_id: string
          owed_minor: number
          share_basis_points?: number | null
          share_units?: number | null
          method: string
        }
        Update: {
          id?: string
          expense_id?: string
          user_id?: string
          owed_minor?: number
          share_basis_points?: number | null
          share_units?: number | null
          method?: string
        }
        Relationships: [
          {
            foreignKeyName: 'expense_splits_expense_id_fkey'
            columns: ['expense_id']
            isOneToOne: false
            referencedRelation: 'expenses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expense_splits_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      expenses: {
        Row: {
          id: string
          user_id: string
          group_id: string | null
          // Who paid, as opposed to who recorded it. Filled by a trigger when
          // omitted, and not in the client's INSERT grant (20260807100000).
          paid_by: string
          category_id: string | null
          description: string
          amount_minor: number
          currency: string
          date: string
          kind: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          group_id?: string | null
          paid_by?: string
          category_id?: string | null
          description: string
          amount_minor: number
          currency: string
          date: string
          kind?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          group_id?: string | null
          paid_by?: string
          category_id?: string | null
          description?: string
          amount_minor?: number
          currency?: string
          date?: string
          kind?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'expenses_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_currency_fkey'
            columns: ['currency']
            isOneToOne: false
            referencedRelation: 'currencies'
            referencedColumns: ['code']
          },
        ]
      }
      group_activity: {
        Row: {
          id: string
          group_id: string
          actor_id: string | null
          kind: string
          detail: Json
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          actor_id?: string | null
          kind: string
          detail?: Json
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          actor_id?: string | null
          kind?: string
          detail?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'group_activity_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_activity_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      group_invites: {
        Row: {
          id: string
          group_id: string
          token_hash: string
          created_by: string
          expires_at: string
          max_uses: number | null
          uses: number
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          token_hash: string
          created_by: string
          expires_at: string
          max_uses?: number | null
          uses?: number
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          token_hash?: string
          created_by?: string
          expires_at?: string
          max_uses?: number | null
          uses?: number
          revoked_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'group_invites_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_invites_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          user_id: string
          role: string
          joined_at: string
        }
        Insert: {
          group_id: string
          user_id: string
          role?: string
          joined_at?: string
        }
        Update: {
          group_id?: string
          user_id?: string
          role?: string
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'group_members_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      groups: {
        Row: {
          id: string
          name: string
          description: string | null
          currency: string
          created_by: string
          created_at: string
          archived_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          currency: string
          created_by: string
          created_at?: string
          archived_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          currency?: string
          created_by?: string
          created_at?: string
          archived_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'groups_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'groups_currency_fkey'
            columns: ['currency']
            isOneToOne: false
            referencedRelation: 'currencies'
            referencedColumns: ['code']
          },
        ]
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          default_currency: string
          // Set when the underlying auth user was deleted; the row is retained
          // so group ledgers stay balanced (20260806140000).
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          default_currency?: string
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          default_currency?: string
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_default_currency_fkey'
            columns: ['default_currency']
            isOneToOne: false
            referencedRelation: 'currencies'
            referencedColumns: ['code']
          },
        ]
      }
      settlements: {
        Row: {
          id: string
          group_id: string
          from_user_id: string
          to_user_id: string
          amount_minor: number
          currency: string
          note: string | null
          settled_at: string
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          from_user_id: string
          to_user_id: string
          amount_minor: number
          currency: string
          note?: string | null
          settled_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          from_user_id?: string
          to_user_id?: string
          amount_minor?: number
          currency?: string
          note?: string | null
          settled_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'settlements_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'settlements_from_user_id_fkey'
            columns: ['from_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'settlements_to_user_id_fkey'
            columns: ['to_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'settlements_currency_fkey'
            columns: ['currency']
            isOneToOne: false
            referencedRelation: 'currencies'
            referencedColumns: ['code']
          },
        ]
      }
      split_presets: {
        Row: {
          id: string
          group_id: string
          name: string
          method: string
          participants: Json
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          name: string
          method: string
          participants: Json
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          name?: string
          method?: string
          participants?: Json
          created_by?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'split_presets_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'split_presets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      is_group_member: {
        Args: { target_group_id: string; target_user_id?: string }
        Returns: boolean
      }
      is_group_owner: {
        Args: { target_group_id: string }
        Returns: boolean
      }
      shares_group_with: {
        Args: { other_user_id: string }
        Returns: boolean
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update']
