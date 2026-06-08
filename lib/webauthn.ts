import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";

// RP (Relying Party) configuration
const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const RP_NAME = "Sendzz";
const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:3000";

interface StoredCredential {
  credentialID: Buffer;
  credentialPublicKey: Buffer;
  counter: number;
  transports: ("ble" | "hybrid" | "internal" | "nfc" | "usb")[];
}

/**
 * Generate WebAuthn registration options for a new passkey
 */
export async function generatePasskeyRegistrationOptions(
  userEmail: string,
  userCredentials: StoredCredential[] = [],
) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(userEmail, "utf-8"),
    userName: userEmail,
    // Don't allow the user to register the same authenticator twice
    excludeCredentials: userCredentials.map((cred) => ({
      id: cred.credentialID.toString("base64url"),
      type: "public-key" as const,
    })),
    // Authenticator selection criteria
    authenticatorSelection: {
      userVerification: "preferred",
      residentKey: "preferred", // Allow resident keys (passkeys)
    },
    // Use the recommended timeout
    timeout: 60000,
  });
}

/**
 * Verify WebAuthn registration response
 */
export async function verifyPasskeyRegistration(
  credential: RegistrationResponseJSON,
  expectedChallenge: string,
  expectedOrigin: string = ORIGIN,
  expectedRPID: string = RP_ID,
) {
  return verifyRegistrationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
  });
}

/**
 * Generate WebAuthn authentication options for sign-in/verification
 */
export async function generatePasskeyAuthenticationOptions() {
  return generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    // Don't specify allowCredentials to let browser show all available passkeys
    // This helps the browser prioritize the right authenticator (Touch ID vs security key)
    timeout: 60000,
  });
}

/**
 * Verify WebAuthn authentication response
 */
export async function verifyPasskeyAuthentication(
  credential: AuthenticationResponseJSON,
  expectedChallenge: string,
  authenticator: {
    credentialID: Buffer;
    credentialPublicKey: Buffer;
    counter: number;
    transports: ("ble" | "hybrid" | "internal" | "nfc" | "usb")[];
  },
  expectedOrigin: string = ORIGIN,
  expectedRPID: string = RP_ID,
) {
  return verifyAuthenticationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    credential: {
      id: authenticator.credentialID.toString("base64url"),
      publicKey: authenticator.credentialPublicKey,
      transports: authenticator.transports,
    },
    advanced: {
      // Disable all strict verification for better compatibility
      requireUserVerification: false,
      allowOnlyConfiguredAuthenticators: false,
      // Disable counter-based replay protection
      verifyCounter: false,
    },
  } as any);
}
