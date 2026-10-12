const validSession = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function requireOwnedScientificSession(client, { optional = false, body = false } = {}) {
  return async (req, res, next) => {
    const sessionId = body ? req.body?.sessionId : req.params.sessionId;
    if (optional && (sessionId === undefined || sessionId === null || sessionId === '')) return next();
    // authenticateUser sets both only after the provider verifies the bearer.
    // A public fingerprint/ticket cannot authorize a private session reader.
    if (!req.user?.id || !req.authToken) return res.status(401).json({ success: false, error: 'verified_session_owner_required' });
    if (!validSession(sessionId)) return res.status(400).json({ success: false, error: 'invalid_session_id' });
    try {
      const owned = await client.from('chat_sessions').select('session_id,user_id').eq('session_id', sessionId).eq('user_id', req.user.id).maybeSingle();
      if (owned.error || owned.data?.user_id !== req.user.id || owned.data?.session_id?.toLowerCase() !== sessionId.toLowerCase()) return res.status(404).json({ success: false, error: 'owned_session_unavailable' });
      req.ownedScientificSessionId = owned.data.session_id;
      return next();
    } catch { return res.status(503).json({ success: false, error: 'session_authorization_unavailable' }); }
  };
}

// Register these before the historical handlers. The same mounted registrar is
// exercised in Express tests; no reader runs before its owner check succeeds.
export function registerScientificPrivateGuards(app, { authenticateUser, supabase }) {
  // This historical testing route uses the unrestricted RProcessPool. It is
  // not part of the scientific UI and cannot bypass the restricted executor.
  app.all('/api/test-r-direct', (req, res) => res.status(404).json({ success: false, error: 'route_not_available' }));
  const mandatory = requireOwnedScientificSession(supabase);
  for (const route of ['/api/session/:sessionId/traces', '/api/session/:sessionId/evaluation', '/api/session/:sessionId/info', '/api/agent-traces/:sessionId']) app.get(route, authenticateUser, mandatory);
  app.post('/api/domain-expert', authenticateUser, requireOwnedScientificSession(supabase, { optional: true, body: true }));
}
