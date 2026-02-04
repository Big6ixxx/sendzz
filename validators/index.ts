/**
 * Zod Validators
 *
 * Validation schemas for all forms and API requests.
 */

import { z } from 'zod';

// ===========================================
// AUTH VALIDATORS
// ===========================================

export const emailSchema = z
  .string()
  .email('Please enter a valid email address')
  .min(1, 'Email is required')
  .max(255, 'Email is too long');

export const otpCodeSchema = z
  .string()
  .length(6, 'Code must be 6 digits')
  .regex(/^\d+$/, 'Code must contain only numbers');

export const loginRequestSchema = z.object({
  email: emailSchema,
});

export const verifyOtpRequestSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
});

// ===========================================
// TRANSFER VALIDATORS
// ===========================================

export const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, 'Invalid amount format')
  .refine((val) => parseFloat(val) > 0, 'Amount must be greater than 0')
  .refine((val) => parseFloat(val) <= 1000000, 'Amount exceeds maximum limit');

export const sendTransferSchema = z.object({
  recipientEmail: emailSchema,
  amount: amountSchema,
  note: z.string().max(500, 'Note is too long').optional(),
});

export const claimTransferSchema = z.object({
  token: z
    .string()
    .min(32, 'Invalid claim token')
    .max(128, 'Invalid claim token'),
});

// ===========================================
// WITHDRAWAL VALIDATORS
// ===========================================

export const bankAccountSchema = z
  .string()
  .min(5, 'Account number is too short')
  .max(20, 'Account number is too long')
  .regex(/^\d+$/, 'Account number must contain only digits');

export const institutionCodeSchema = z
  .string()
  .min(2, 'Invalid institution code')
  .max(20, 'Invalid institution code');

export const currencyCodeSchema = z
  .string()
  .length(3, 'Currency code must be 3 characters')
  .toUpperCase();

export const initiateWithdrawalSchema = z.object({
  amount: amountSchema,
  currency: currencyCodeSchema,
  institutionCode: institutionCodeSchema,
  accountNumber: bankAccountSchema,
  accountName: z.string().max(100, 'Account name is too long').optional(),
});

export const verifyWithdrawalSchema = z.object({
  withdrawalId: z.string().uuid('Invalid withdrawal ID'),
  code: otpCodeSchema,
});

// ===========================================
// DEPOSIT VALIDATORS
// ===========================================

export const depositSchema = z.object({
  amount: amountSchema,
  currency: currencyCodeSchema.optional(),
});

// ===========================================
// TYPE EXPORTS
// ===========================================

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;
export type SendTransferRequest = z.infer<typeof sendTransferSchema>;
export type ClaimTransferRequest = z.infer<typeof claimTransferSchema>;
export type InitiateWithdrawalRequest = z.infer<
  typeof initiateWithdrawalSchema
>;
export type VerifyWithdrawalRequest = z.infer<typeof verifyWithdrawalSchema>;
export type DepositRequest = z.infer<typeof depositSchema>;
