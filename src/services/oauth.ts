/**
 * Google OAuth helper functions for zkLogin.
 */

export const getGoogleOAuthUrl = (clientId: string, redirectUri: string, nonce: string): string => {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: nonce,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

export const extractIdTokenFromUrl = (): string | null => {
  const hash = window.location.hash;
  if (!hash) return null;

  const params = new URLSearchParams(hash.substring(1)); // Remove the leading '#'
  return params.get('id_token');
};
