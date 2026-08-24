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

/**
 * Which domain a passkey is being created for.
 *
 * The browser refuses outright if the RP ID is not the page's own domain, so a single
 * configured value cannot serve both production and a developer on localhost: registration
 * fails with `SecurityError` before the request ever reaches us, on every option offered.
 *
 * Only local development addresses are allowed to override the configured value. This is what
 * keeps the pinning meaningful — a passkey is bound to its domain precisely so that a lookalike
 * site cannot use it, and honouring an arbitrary caller's origin would hand that away.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveRp(requestOrigin?: string | null): {
  rpID: string;
  origin: string;
} {
  if (requestOrigin) {
    try {
      const url = new URL(requestOrigin);
      if (LOCAL_HOSTS.has(url.hostname)) {
        return { rpID: url.hostname, origin: url.origin };
      }
    } catch {
      /* unparseable origin — fall through to the configured value */
    }
  }
  return { rpID: RP_ID, origin: ORIGIN };
}

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
  requestOrigin?: string | null,
) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: resolveRp(requestOrigin).rpID,
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
export async function generatePasskeyAuthenticationOptions(
  requestOrigin?: string | null,
) {
  return generateAuthenticationOptions({
    rpID: resolveRp(requestOrigin).rpID,
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
  } as unknown as Parameters<typeof verifyAuthenticationResponse>[0]);
}
