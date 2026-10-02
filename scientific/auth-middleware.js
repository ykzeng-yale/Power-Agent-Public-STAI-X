// Auth & Credit System Middleware
import { randomUUID } from 'crypto';
import { supabase } from './supabase-client.js';

// ========================================
// AUTHENTICATION MIDDLEWARE
// ========================================

/**
 * Express middleware that authenticates users via JWT or anonymous fingerprint.
 * Never blocks - always calls next().
 *
 * Priority:
 * 1. Authorization: Bearer <token> header -> verified user
 * 2. anon_fp cookie -> anonymous user
 * 3. Generate new anonymous fingerprint
 */
export function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    supabase.auth.getUser(token)
      .then(({ data, error }) => {
        if (!error && data?.user) {
          req.user = {
            id: data.user.id,
            email: data.user.email,
            is_anonymous: data.user.is_anonymous || false
          };
          req.authToken = token;
        } else {
          // Invalid token - fall through to anonymous
          assignAnonymousFingerprint(req, res);
        }
        next();
      })
      .catch((err) => {
        console.error('[auth-middleware] JWT verification error:', err.message);
        assignAnonymousFingerprint(req, res);
        next();
      });

    return;
  }

  // No Authorization header - check for anonymous fingerprint cookie
  assignAnonymousFingerprint(req, res);
  next();
}

/**
 * Assign anonymous fingerprint from cookie or generate a new one.
 */
function assignAnonymousFingerprint(req, res) {
  const existingFp = req.cookies?.anon_fp;

  if (existingFp) {
    req.anonFingerprint = existingFp;
  } else {
    const newFp = randomUUID();
    req.anonFingerprint = newFp;
    res.cookie('anon_fp', newFp, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
    });
  }
}

// ========================================
// CREDIT CHECK MIDDLEWARE
// ========================================

/**
 * Factory returning middleware that checks whether the requester has enough credits.
 *
 * @param {number} cost - Number of credits required for this action
 * @returns {Function} Express middleware
 */
export function requireCredits(cost) {
  return async (req, res, next) => {
    try {
      // Authenticated user path
      if (req.user) {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('credits_remaining, tier, total_analyses_run')
          .eq('id', req.user.id)
          .single();

        if (error) {
          console.error('[auth-middleware] Error fetching profile:', error.message);
          return res.status(500).json({ error: 'internal_error', message: 'Failed to verify credits.' });
        }

        // Admin and institutional tiers always pass
        if (profile.tier === 'admin' || profile.tier === 'institutional') {
          req.creditExempt = true;
          return next();
        }

        if (profile.credits_remaining >= cost) {
          return next();
        }

        return res.status(402).json({
          error: 'insufficient_credits',
          credits_remaining: profile.credits_remaining,
          cost_per_analysis: cost,
          message: 'You have used all your credits. Please upgrade your plan or purchase additional credits.',
          pricing: {
            actual_cost: '$5',
            academic_price: '$2',
            contact: 'yukang.zeng@yale.edu'
          }
        });
      }

      // Anonymous user path
      if (req.anonFingerprint) {
        const { data: usage, error } = await supabase
          .from('anonymous_usage')
          .select('analyses_used, max_allowed')
          .eq('fingerprint', req.anonFingerprint)
          .single();

        if (error && error.code !== 'PGRST116') {
          // PGRST116 = row not found, which is fine for first-time anonymous users
          console.error('[auth-middleware] Error fetching anonymous usage:', error.message);
          return res.status(500).json({ error: 'internal_error', message: 'Failed to verify usage.' });
        }

        const analysesUsed = usage?.analyses_used || 0;
        const maxAllowed = usage?.max_allowed || 1;

        if (analysesUsed < maxAllowed) {
          return next();
        }

        return res.status(403).json({
          error: 'anonymous_limit_reached',
          message: 'Sign up for free to get 20 credits (4 analyses)!'
        });
      }

      // No user and no fingerprint - should not happen after authenticateUser
      return res.status(401).json({ error: 'unauthenticated', message: 'Authentication required.' });

    } catch (err) {
      console.error('[auth-middleware] requireCredits error:', err.message);
      return res.status(500).json({ error: 'internal_error', message: 'Credit verification failed.' });
    }
  };
}

// ========================================
// CREDIT OPERATIONS
// ========================================

/**
 * Atomically deduct credits from a user's profile and record the transaction.
 *
 * @param {string} userId - User UUID
 * @param {number} cost - Credits to deduct
 * @param {string} sessionId - Associated session UUID
 * @returns {{ success: boolean, credits_remaining: number }}
 */
export async function deductCredits(userId, cost, sessionId) {
  try {
    // Atomic deduction - only succeeds if user has enough credits
    const { data, error } = await supabase.rpc('deduct_credits', {
      p_user_id: userId,
      p_cost: cost
    });

    // No unguarded update/execute_sql fallback: reservation must be atomic.

    if (error) {
      console.error('[auth-middleware] deductCredits RPC error:', error.message);
      return { success: false, credits_remaining: -1 };
    }

    if (data === null || data === undefined) {
      // RPC returned null - insufficient credits
      return { success: false, credits_remaining: -1 };
    }

    const creditsRemaining = typeof data === 'number' ? data : data.credits_remaining;

    // Record transaction
    await insertCreditTransaction(userId, cost, sessionId, creditsRemaining);

    return { success: true, credits_remaining: creditsRemaining };

  } catch (err) {
    console.error('[auth-middleware] deductCredits unexpected error:', err.message);
    return { success: false, credits_remaining: -1 };
  }
}

/**
 * Insert a credit transaction record.
 */
async function insertCreditTransaction(userId, cost, sessionId, creditsAfter) {
  try {
    await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        amount: -cost,
        transaction_type: 'analysis',
        session_id: sessionId || null,
        credits_after: creditsAfter,
        created_at: new Date().toISOString()
      });
  } catch (err) {
    // Log but don't fail the main operation
    console.error('[auth-middleware] Failed to record credit transaction:', err.message);
  }
}

// ========================================
// ANONYMOUS USAGE TRACKING
// ========================================

/**
 * Record or increment anonymous usage for a fingerprint.
 *
 * @param {string} fingerprint - Anonymous user fingerprint UUID
 * @param {string} ipAddress - Client IP address
 * @returns {{ analyses_used: number, max_allowed: number }}
 */
export async function recordAnonymousUsage(fingerprint, ipAddress, client = supabase) {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await client.from('anonymous_usage')
        .select('analyses_used,max_allowed').eq('fingerprint', fingerprint).maybeSingle();
      if (current.error) return { success: false };
      if (!current.data) {
        const inserted = await client.from('anonymous_usage').insert({
          fingerprint, ip_address: ipAddress || null, analyses_used: 1,
          max_allowed: 1, last_seen_at: new Date().toISOString()
        }).select('analyses_used,max_allowed').single();
        if (!inserted.error && inserted.data) return { success: true, ...inserted.data };
        // A unique fingerprint constraint arbitrates simultaneous first calls.
        if (inserted.error?.code !== '23505') return { success: false };
        continue;
      }
      const { analyses_used, max_allowed } = current.data;
      if (analyses_used >= max_allowed) return { success: false, analyses_used, max_allowed };
      const updated = await client.from('anonymous_usage').update({
        analyses_used: analyses_used + 1, ip_address: ipAddress || null,
        last_seen_at: new Date().toISOString()
      }).eq('fingerprint', fingerprint).eq('analyses_used', analyses_used)
        .select('analyses_used,max_allowed').maybeSingle();
      if (!updated.error && updated.data) return { success: true, ...updated.data };
    }
    return { success: false };
  } catch { return { success: false }; }
}

// ========================================
// CREDIT QUERIES
// ========================================

/**
 * Get credit and tier info for an authenticated user.
 *
 * @param {string} userId - User UUID
 * @returns {{ credits_remaining: number, tier: string, total_analyses_run: number }}
 */
export async function getUserCredits(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('credits_remaining, tier, total_analyses_run')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('[auth-middleware] getUserCredits error:', error.message);
      return { credits_remaining: 0, tier: 'free', total_analyses_run: 0 };
    }

    return {
      credits_remaining: data.credits_remaining,
      tier: data.tier,
      total_analyses_run: data.total_analyses_run
    };

  } catch (err) {
    console.error('[auth-middleware] getUserCredits unexpected error:', err.message);
    return { credits_remaining: 0, tier: 'free', total_analyses_run: 0 };
  }
}
