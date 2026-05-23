/* C2PA / Content Credentials check.
   Real implementation would call the c2pa-node or c2patool to
   verify cryptographic manifests. This stub returns the three
   states defined in the spec (section 6.2):
     - verified-generative
     - verified-capture
     - unsigned | invalid

   Hook to a real verifier by replacing the body of verify().
*/
'use strict';

const KNOWN_GENERATIVE_SIGNERS = new Set([
  'Adobe Firefly',
  'OpenAI DALL-E',
  'OpenAI',
  'Midjourney',
  'Stability AI',
  'Leonardo.Ai',
  'Google ImageFX',
]);

const KNOWN_CAPTURE_SIGNERS = new Set([
  'Sony Alpha',
  'Leica M11',
  'Nikon Z9',
  'Canon EOS R5',
  'iPhone Camera',  // hypothetical
  'Truepic',
]);

/**
 * Inspect an image reference for C2PA credentials.
 * imageRef: { url, manifest?: {signer, claims[]} }   (manifest pre-fetched)
 * Returns: { status, origin, signer }
 */
async function verify(imageRef) {
  const m = imageRef?.manifest;
  if (!m || !m.signer) {
    return { status: 'unsigned', origin: null, signer: null };
  }
  // In the real impl this would call c2pa.verifyAsync(bytes) and
  // check the trust list. We treat the signer name as the source of truth.
  if (KNOWN_GENERATIVE_SIGNERS.has(m.signer)) {
    return {
      status: 'verified',
      origin: 'generative',
      signer: m.signer,
      c2pa: { generative_ai_origin: true },
    };
  }
  if (KNOWN_CAPTURE_SIGNERS.has(m.signer)) {
    return {
      status: 'verified',
      origin: 'capture',
      signer: m.signer,
      c2pa: { camera_capture_chain: true },
    };
  }
  return { status: 'unknown-signer', origin: null, signer: m.signer };
}

module.exports = { verify, KNOWN_GENERATIVE_SIGNERS, KNOWN_CAPTURE_SIGNERS };
