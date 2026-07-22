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

export type AssetType = "USDC";

export type TransferStatus =
  | "pending_claim"
  | "claimed"
  | "completed"
  | "cancelled"
  | "expired";

export type DepositStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "reversed"
  | "expired";

export type WithdrawalStatus =
  | "awaiting_verification"
  | "processing"
  | "completed"
  | "failed"
  | "reversed";

export type WithdrawalVerificationStatus = "pending" | "verified" | "expired";

export type OtpPurpose = "login" | "withdrawal_verification";

export type WebhookProvider = "paycrest" | "bitnob";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          smart_account_address: string | null;
          solana_address: string | null;
          stellar_address: string | null;
          stellar_wallet_id: string | null;
          stellar_signer_granted: boolean;
          last_deposit_scan_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          smart_account_address?: string | null;
          solana_address?: string | null;
          stellar_address?: string | null;
          stellar_wallet_id?: string | null;
          stellar_signer_granted?: boolean;
          last_deposit_scan_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          smart_account_address?: string | null;
          solana_address?: string | null;
          stellar_address?: string | null;
          stellar_wallet_id?: string | null;
          stellar_signer_granted?: boolean;
          last_deposit_scan_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      deposit_sync_state: {
        Row: {
          user_id: string;
          chain: string;
          cursor: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          chain: string;
          cursor?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          chain?: string;
          cursor?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          id: string;
          email: string;
          paycrest_customer_id: string | null;
          paycrest_wallet_id: string | null;
          onboarding_completed: boolean;
          two_fa_enabled: boolean;
          two_fa_threshold: number;
          two_fa_nudge_dismissed_at: string | null;
          totp_secret: string | null;
          totp_enabled: boolean;
          totp_verified_at: string | null;
          webauthn_credentials: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          paycrest_customer_id?: string | null;
          paycrest_wallet_id?: string | null;
          onboarding_completed?: boolean;
          two_fa_enabled?: boolean;
          two_fa_threshold?: number;
          two_fa_nudge_dismissed_at?: string | null;
          totp_secret?: string | null;
          totp_enabled?: boolean;
          totp_verified_at?: string | null;
          webauthn_credentials?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          paycrest_customer_id?: string | null;
          paycrest_wallet_id?: string | null;
          onboarding_completed?: boolean;
          two_fa_enabled?: boolean;
          two_fa_threshold?: number;
          two_fa_nudge_dismissed_at?: string | null;
          totp_secret?: string | null;
          totp_enabled?: boolean;
          totp_verified_at?: string | null;
          webauthn_credentials?: Json;
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
          sender_email: string | null;
          recipient_id: string | null;
          recipient_email: string;
          amount: number;
          asset: AssetType;
          status: TransferStatus;
          note: string | null;
          tx_hash: string | null;
          source_chain: string | null;
          claim_token_hash: string | null;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          sender_email?: string | null;
          recipient_id?: string | null;
          recipient_email: string;
          amount: number;
          asset?: AssetType;
          status?: TransferStatus;
          note?: string | null;
          tx_hash?: string | null;
          source_chain?: string | null;
          claim_token_hash?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sender_id?: string;
          sender_email?: string | null;
          recipient_id?: string | null;
          recipient_email?: string;
          amount?: number;
          asset?: AssetType;
          status?: TransferStatus;
          note?: string | null;
          tx_hash?: string | null;
          source_chain?: string | null;
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
          tx_hash: string | null;
          amount_fiat: number | null;
          currency_fiat: string | null;
          amount_usdc: number | null;
          status: DepositStatus;
          network: string | null;
          provider: string | null;
          provider_order_id: string | null;
          provider_metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          paycrest_tx_id?: string | null;
          tx_hash?: string | null;
          amount_fiat?: number | null;
          currency_fiat?: string | null;
          amount_usdc?: number | null;
          status?: DepositStatus;
          network?: string | null;
          provider?: string | null;
          provider_order_id?: string | null;
          provider_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          paycrest_tx_id?: string | null;
          tx_hash?: string | null;
          amount_fiat?: number | null;
          currency_fiat?: string | null;
          amount_usdc?: number | null;
          status?: DepositStatus;
          network?: string | null;
          provider?: string | null;
          provider_order_id?: string | null;
          provider_metadata?: Json;
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
          tx_hash: string | null;
          amount_usdc: number;
          fiat_amount: number | null;
          exchange_rate: number | null;
          fiat_currency: string;
          institution_code: string;
          bank_account_masked: string;
          status: WithdrawalStatus;
          verification_status: WithdrawalVerificationStatus;
          verification_token_hash: string | null;
          verification_expires_at: string | null;
          source_chain: string | null;
          consolidated: boolean;
          provider: string | null;
          provider_order_id: string | null;
          provider_metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          paycrest_order_id?: string | null;
          tx_hash?: string | null;
          amount_usdc: number;
          fiat_amount?: number | null;
          exchange_rate?: number | null;
          fiat_currency: string;
          institution_code: string;
          bank_account_masked: string;
          status?: WithdrawalStatus;
          verification_status?: WithdrawalVerificationStatus;
          verification_token_hash?: string | null;
          verification_expires_at?: string | null;
          source_chain?: string | null;
          consolidated?: boolean;
          provider?: string | null;
          provider_order_id?: string | null;
          provider_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          paycrest_order_id?: string | null;
          tx_hash?: string | null;
          amount_usdc?: number;
          fiat_amount?: number | null;
          exchange_rate?: number | null;
          fiat_currency?: string;
          institution_code?: string;
          bank_account_masked?: string;
          status?: WithdrawalStatus;
          verification_status?: WithdrawalVerificationStatus;
          verification_token_hash?: string | null;
          verification_expires_at?: string | null;
          source_chain?: string | null;
          consolidated?: boolean;
          provider?: string | null;
          provider_order_id?: string | null;
          provider_metadata?: Json;
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
          event_type: string | null;
          payload_json: Json;
          processed: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          provider?: WebhookProvider;
          event_id: string;
          event_type?: string | null;
          payload_json: Json;
          processed?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          provider?: WebhookProvider;
          event_id?: string;
          event_type?: string | null;
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
      bridge_transactions: {
        Row: {
          id: string;
          user_id: string;
          source_chain: string;
          dest_chain: string;
          amount: number;
          burn_tx_hash: string;
          attestation_status: "pending" | "complete" | "failed" | "pending_confirmations";
          mint_tx_hash: string | null;
          notifications_sent: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_chain: string;
          dest_chain: string;
          amount: number;
          burn_tx_hash: string;
          attestation_status?: "pending" | "complete" | "failed" | "pending_confirmations";
          mint_tx_hash?: string | null;
          notifications_sent?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_chain?: string;
          dest_chain?: string;
          amount?: number;
          burn_tx_hash?: string;
          attestation_status?: "pending" | "complete" | "failed" | "pending_confirmations";
          mint_tx_hash?: string | null;
          notifications_sent?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          id: string;
          email: string;
          role: "super_admin" | "admin" | "moderator";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          role?: "super_admin" | "admin" | "moderator";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          role?: "super_admin" | "admin" | "moderator";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      bank_contacts: {
        Row: {
          id: string;
          user_id: string;
          bank_name: string;
          bank_code: string;
          account_number: string;
          account_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          bank_name: string;
          bank_code: string;
          account_number: string;
          account_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          bank_name?: string;
          bank_code?: string;
          account_number?: string;
          account_name?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bank_contacts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      transaction_otps: {
        Row: {
          id: string;
          user_email: string;
          otp_code: string;
          action_type: Database["public"]["Enums"]["transaction_otp_action"];
          payload: Json;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_email: string;
          otp_code: string;
          action_type: Database["public"]["Enums"]["transaction_otp_action"];
          payload: Json;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_email?: string;
          otp_code?: string;
          action_type?: Database["public"]["Enums"]["transaction_otp_action"];
          payload?: Json;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      // Anonymized, PII-free union of all transaction tables (migration 031).
      // Read-only source for the public /explore dashboard.
      public_transaction_feed: {
        Row: {
          id: string;
          tx_type: "transfer" | "deposit" | "withdrawal" | "bridge";
          amount: number;
          asset: string;
          status: string;
          is_settled: boolean;
          source_chain: string | null;
          dest_chain: string | null;
          consolidated: boolean;
          tx_hash: string | null;
          secondary_tx_hash: string | null;
          fiat_currency: string | null;
          created_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      // Public dashboard aggregates (migration 031). Return JSON blobs.
      get_public_stats: {
        Args: Record<string, never>;
        Returns: Json;
      };
      get_public_feed_totals: {
        Args: {
          p_type?: string | null;
          p_chain?: string | null;
          p_start?: string | null;
          p_end?: string | null;
          p_search?: string | null;
        };
        Returns: Json;
      };
      create_transfer_and_lock_balance: {
        Args: {
          p_sender_id: string;
          p_recipient_email: string;
          p_amount: number;
          p_note?: string | null;
          p_claim_token_hash?: string | null;
          p_expires_at?: string | null;
        };
        Returns: string;
      };
      finalize_withdrawal_success: {
        Args: { p_paycrest_order_id: string };
        Returns: boolean;
      };
      finalize_withdrawal_failed: {
        Args: { p_paycrest_order_id: string; p_reason?: string | null };
        Returns: boolean;
      };
      claim_transfer: {
        Args: {
          p_recipient_id: string;
          p_claim_token_hash: string;
        };
        Returns: string;
      };
      reclaim_transfer: {
        Args: {
          p_transfer_id: string;
          p_sender_id: string;
        };
        Returns: void;
      };
      accept_transfer: {
        Args: {
          p_transfer_id: string;
          p_recipient_id: string;
        };
        Returns: void;
      };
    };
    Enums: {
      asset_type: AssetType;
      transfer_status: TransferStatus;
      deposit_status: DepositStatus;
      withdrawal_status: WithdrawalStatus;
      withdrawal_verification_status: WithdrawalVerificationStatus;
      otp_purpose: OtpPurpose;
      webhook_provider: WebhookProvider;
      transaction_otp_action: "transfer" | "withdrawal";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// Helper types
type PublicSchema = Database[Extract<keyof Database, "public">];

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never;
