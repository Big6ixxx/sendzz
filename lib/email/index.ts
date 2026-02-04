/**
 * Email Module
 *
 * Centralized exports for email functionality.
 */

export { sendEmail } from './sendEmail';
export type { SendEmailOptions, SendEmailResult } from './sendEmail';

export {
    claimTransferTemplate, otpLoginTemplate, transferReceivedTemplate,
    withdrawalCompletedTemplate, withdrawalOTPTemplate
} from './templates';

