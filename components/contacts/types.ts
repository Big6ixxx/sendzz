'use client';

// Shared type for a contact row from the DB
export interface Contact {
  id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
}

export interface ContactToDelete {
  id: string;
  name: string;
}
