/**
 * Email Module
 *
 * Centralized exports for email functionality.
 */

export { 
  sendEmail, 
  sendTransferEmail, 
  sendBridgeEmail, 
  sendDepositEmail, 
  sendWithdrawalEmail,
  sendSecurityEmail,
  sendTransferSentEmail
} from './sendEmail';
export type { SendEmailOptions, SendEmailResult } from './sendEmail';

export {
    claimTransferTemplate,
    otpLoginTemplate,
    transferReceivedTemplate,
    withdrawalCompletedTemplate,
    withdrawalOTPTemplate,
    depositConfirmedTemplate,
    bridgeCompletedTemplate,
    securityAlertTemplate,
    transactionOTPTemplate,
    otpEmailSubject,
    transferSentTemplate
} from './templates';

