import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { generateNonce, generateRandomness, computeZkLoginAddress, getExtendedEphemeralPublicKey } from '@mysten/sui/zklogin';

export interface ZkLoginSession {
  ephemeralPrivateKey: string;
  randomness: string;
  maxEpoch: number;
}

export const getOrGenerateSalt = (): string => {
  let salt = localStorage.getItem('zklogin_user_salt');
  if (!salt) {
    const array = new Uint32Array(8);
    window.crypto.getRandomValues(array);
    let saltVal = 0n;
    for (let i = 0; i < 8; i++) {
      saltVal = (saltVal << 32n) | BigInt(array[i]);
    }
    salt = saltVal.toString();
    localStorage.setItem('zklogin_user_salt', salt);
  }
  return salt;
};

export const setupZkLoginSession = (currentEpoch: number): { nonce: string; session: ZkLoginSession } => {
  const keypair = new Ed25519Keypair();
  const ephemeralPrivateKey = keypair.getSecretKey();
  const publicKey = keypair.getPublicKey();
  
  const randomness = generateRandomness();
  const maxEpoch = currentEpoch + 10; // Valid for 10 epochs
  
  const nonce = generateNonce(publicKey, maxEpoch, randomness);
  
  const session: ZkLoginSession = {
    ephemeralPrivateKey,
    randomness,
    maxEpoch,
  };
  
  sessionStorage.setItem('zklogin_ephemeral_private_key', ephemeralPrivateKey);
  sessionStorage.setItem('zklogin_randomness', randomness);
  sessionStorage.setItem('zklogin_max_epoch', maxEpoch.toString());
  
  return { nonce, session };
};

export const getStoredSession = (): ZkLoginSession | null => {
  const ephemeralPrivateKey = sessionStorage.getItem('zklogin_ephemeral_private_key');
  const randomness = sessionStorage.getItem('zklogin_randomness');
  const maxEpochStr = sessionStorage.getItem('zklogin_max_epoch');
  
  if (!ephemeralPrivateKey || !randomness || !maxEpochStr) return null;
  
  return {
    ephemeralPrivateKey,
    randomness,
    maxEpoch: parseInt(maxEpochStr, 10),
  };
};

export const decodeJwt = (jwt: string): any => {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(payloadJson);
};

export const deriveZkAddress = (jwt: string, userSalt: string): string => {
  const decoded = decodeJwt(jwt);
  const iss = decoded.iss;
  const sub = decoded.sub;
  
  return computeZkLoginAddress({
    claimName: 'sub',
    claimValue: sub,
    userSalt: BigInt(userSalt).toString(),
    iss,
  });
};

export const getZkProof = async (
  jwt: string,
  session: ZkLoginSession,
  userSalt: string
): Promise<any> => {
  const keypair = Ed25519Keypair.fromSecretKey(session.ephemeralPrivateKey);
  const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(keypair.getPublicKey());
  
  const response = await fetch('https://prover-dev.zklogin.net/v1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jwt,
      extendedEphemeralPublicKey,
      maxEpoch: session.maxEpoch,
      jwtRandomness: session.randomness,
      salt: userSalt,
      keyClaimName: 'sub',
    }),
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch ZK Proof: ${errText}`);
  }
  
  return await response.json();
};
