const freebuff = {
  flowType: "cli_browser",
  // Freebuff uses CLI browser flow - similar to CLI providers
  // Login flow handled by /api/oauth/freebuff/start and /api/oauth/freebuff/callback routes
  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken || tokens.access_token,
    refreshToken: null, // Freebuff doesn't expose refresh endpoint
    expiresIn: tokens.expiresIn || tokens.expires_in || 3600,
    email: tokens.email,
    providerSpecificData: {
      authMethod: "cli_browser",
    },
  }),
};

export default freebuff;
