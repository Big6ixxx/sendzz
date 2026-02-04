/**
 * Supabase Database Types
 *
 * Generated types for the Sendzz database schema.
 * Update this file when the schema changes.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AssetType = 'USDC';

export type TransferStatus =
  | 'pending_claim'
  | 'claimed'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type DepositStatus = 'pending' | 'confirmed' | 'failed' | 'reversed';

export type WithdrawalStatus =
  | 'awaiting_verification'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'reversed';

export type WithdrawalVerificationStatus = 'pending' | 'verified' | 'expired';

export type OtpPurpose = 'login' | 'withdrawal_verification';

export type WebhookProvider = 'paycrest';

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          email: string;
          paycrest_customer_id: string | null;
          paycrest_wallet_id: string | null;
          onboarding_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          paycrest_customer_id?: string | null;
          paycrest_wallet_id?: string | null;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          paycrest_customer_id?: string | null;
          paycrest_wallet_id?: string | null;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      balances: {
        Row: {
          user_id: string;
          asset: AssetType;
          available_balance: number;
          locked_balance: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          asset?: AssetType;
          available_balance?: number;
          locked_balance?: number;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          asset?: AssetType;
          available_balance?: number;
          locked_balance?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      transfers: {
        Row: {
          id: string;
          sender_id: string;
          recipient_id: string | null;
          recipient_email: string;
          amount: number;
          asset: AssetType;
          status: TransferStatus;
          note: string | null;
          claim_token_hash: string | null;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          recipient_id?: string | null;
          recipient_email: string;
          amount: number;
          asset?: AssetType;
          status?: TransferStatus;
          note?: string | null;
          claim_token_hash?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sender_id?: string;
          recipient_id?: string | null;
          recipient_email?: string;
          amount?: number;
          asset?: AssetType;
          status?: TransferStatus;
          note?: string | null;
          claim_token_hash?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      deposits: {
        Row: {
          id: string;
          user_id: string;
          paycrest_tx_id: string | null;
          amount_fiat: number | null;
          currency_fiat: string | null;
          amount_usdc: number | null;
          status: DepositStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          paycrest_tx_id?: string | null;
          amount_fiat?: number | null;
          currency_fiat?: string | null;
          amount_usdc?: number | null;
          status?: DepositStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          paycrest_tx_id?: string | null;
          amount_fiat?: number | null;
          currency_fiat?: string | null;
          amount_usdc?: number | null;
          status?: DepositStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      withdrawals: {
        Row: {
          id: string;
          user_id: string;
          paycrest_order_id: string | null;
          amount_usdc: number;
          fiat_currency: string;
          institution_code: string;
          bank_account_masked: string;
          status: WithdrawalStatus;
          verification_status: WithdrawalVerificationStatus;
          verification_token_hash: string | null;
          verification_expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          paycrest_order_id?: string | null;
          amount_usdc: number;
          fiat_currency: string;
          institution_code: string;
          bank_account_masked: string;
          status?: WithdrawalStatus;
          verification_status?: WithdrawalVerificationStatus;
          verification_token_hash?: string | null;
          verification_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          paycrest_order_id?: string | null;
          amount_usdc?: number;
          fiat_currency?: string;
          institution_code?: string;
          bank_account_masked?: string;
          status?: WithdrawalStatus;
          verification_status?: WithdrawalVerificationStatus;
          verification_token_hash?: string | null;
          verification_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      otp_logs: {
        Row: {
          id: string;
          user_id: string | null;
          email: string;
          purpose: OtpPurpose;
          success: boolean;
          ip: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          email: string;
          purpose: OtpPurpose;
          success?: boolean;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          email?: string;
          purpose?: OtpPurpose;
          success?: boolean;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          metadata_json: Json;
          ip: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: string;
          metadata_json?: Json;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          action?: string;
          metadata_json?: Json;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          id: string;
          provider: WebhookProvider;
          event_id: string;
          payload_json: Json;
          processed: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          provider?: WebhookProvider;
          event_id: string;
          payload_json: Json;
          processed?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          provider?: WebhookProvider;
          event_id?: string;
          payload_json?: Json;
          processed?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      auth_otp: {
        Row: {
          id: string;
          email: string;
          otp_hash: string;
          expires_at: string;
          attempts: number;
          used: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          otp_hash: string;
          expires_at: string;
          attempts?: number;
          used?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          otp_hash?: string;
          expires_at?: string;
          attempts?: number;
          used?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          email: string;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          email: string;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          email?: string;
          avatar_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      asset_type: AssetType;
      transfer_status: TransferStatus;
      deposit_status: DepositStatus;
      withdrawal_status: WithdrawalStatus;
      withdrawal_verification_status: WithdrawalVerificationStatus;
      otp_purpose: OtpPurpose;
      webhook_provider: WebhookProvider;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// Helper types
type PublicSchema = Database[Extract<keyof Database, 'public'>];

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema['Tables'] & PublicSchema['Views'])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions['schema']]['Tables'] &
        Database[PublicTableNameOrOptions['schema']]['Views'])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions['schema']]['Tables'] &
      Database[PublicTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema['Tables'] &
        PublicSchema['Views'])
    ? (PublicSchema['Tables'] &
        PublicSchema['Views'])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema['Tables']
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema['Tables']
    ? PublicSchema['Tables'][PublicTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema['Tables']
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema['Tables']
    ? PublicSchema['Tables'][PublicTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema['Enums']
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions['schema']]['Enums'][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema['Enums']
    ? PublicSchema['Enums'][PublicEnumNameOrOptions]
    : never;
