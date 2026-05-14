// Supabase Client for Chat History Persistence
import { createClient } from '@supabase/supabase-js';

// Supabase configuration from environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

// Validate required environment variables
if (!supabaseUrl) {
    throw new Error('SUPABASE_URL environment variable is required');
}
if (!supabaseKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

// Create client with autoRefreshToken disabled for server-side use
export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// ========================================
// SESSION MANAGEMENT
// ========================================

/**
 * Create a new chat session
 * @param {string} user_id - Optional user identifier
 * @returns {Object} Created session
 */
export async function createSession(user_id = null) {
    const { data, error } = await supabase
        .from('chat_sessions')
        .insert({
            user_id,
            title: 'New Analysis', // Will be auto-updated by trigger
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('Error creating session:', error);
        throw error;
    }

    console.log(`✅ Created new session: ${data.session_id}`);
    return data;
}

/**
 * Get all sessions for a user
 * @param {string} user_id - Optional user identifier
 * @param {number} limit - Max number of sessions to return
 * @returns {Array} List of sessions
 */
export async function getSessions(user_id = null, limit = 20) {
    let query = supabase
        .from('chat_sessions')
        .select('*')
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
        .limit(limit);

    if (user_id) {
        query = query.eq('user_id', user_id);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching sessions:', error);
        throw error;
    }

    return data || [];
}

/**
 * Get a single session by ID
 * @param {string} session_id - Session UUID
 * @returns {Object} Session data
 */
export async function getSession(session_id) {
    const { data, error } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('session_id', session_id)
        .single();

    if (error) {
        console.error('Error fetching session:', error);
        throw error;
    }

    return data;
}

/**
 * Update session (e.g., title)
 * @param {string} session_id - Session UUID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated session
 */
export async function updateSession(session_id, updates) {
    const { data, error } = await supabase
        .from('chat_sessions')
        .update({
            ...updates,
            updated_at: new Date().toISOString()
        })
        .eq('session_id', session_id)
        .select()
        .single();

    if (error) {
        console.error('Error updating session:', error);
        throw error;
    }

    return data;
}

// ========================================
// MESSAGE MANAGEMENT
// ========================================

/**
 * Save a message to a session
 * @param {string} session_id - Session UUID
 * @param {string} role - 'user' | 'assistant' | 'system'
 * @param {string} content - Message content
 * @param {Object} metadata - Optional metadata (iterations, files, etc.)
 * @returns {Object} Created message
 */
export async function saveMessage(session_id, role, content, metadata = {}) {
    // Try to get next sequence number (optional column)
    let sequence_number = 1;
    try {
        const { data: messages } = await supabase
            .from('messages')
            .select('id')
            .eq('session_id', session_id)
            .order('created_at', { ascending: false })
            .limit(1);

        sequence_number = messages && messages.length > 0
            ? messages.length + 1
            : 1;
    } catch (seqError) {
        // Sequence number is optional, continue without it
        console.log('Note: sequence_number not available, using created_at for ordering');
    }

    const messageData = {
        session_id,
        role,
        content,
        agent_type: metadata.agent_type || null,
        // iterations: metadata.iterations || null, // Commented out - column doesn't exist yet
        // input_file_path: metadata.input_file_path || null, // Commented out - column doesn't exist yet
        // output_files: metadata.output_files || null, // Commented out - column doesn't exist yet
        // analysis_mode: metadata.analysis_mode || null, // Commented out - column doesn't exist yet
        // missing_info: metadata.missing_info || null, // Commented out - column doesn't exist yet
        // recommendations: metadata.recommendations || null // Commented out - column doesn't exist yet
    };

    const { data, error } = await supabase
        .from('messages')
        .insert(messageData)
        .select()
        .single();

    if (error) {
        console.error('Error saving message:', error);
        throw error;
    }

    console.log(`✅ Saved ${role} message to session ${session_id}`);
    return data;
}

/**
 * Get all messages for a session
 * @param {string} session_id - Session UUID
 * @returns {Array} List of messages ordered by creation time
 */
export async function getMessages(session_id) {
    const { data, error} = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching messages:', error);
        throw error;
    }

    return data || [];
}

// ========================================
// FILE MANAGEMENT
// ========================================

/**
 * Track an uploaded file
 * @param {string} session_id - Session UUID
 * @param {Object} fileInfo - File metadata
 * @returns {Object} Created file record
 */
export async function trackUploadedFile(session_id, fileInfo) {
    const { data, error } = await supabase
        .from('session_files')
        .insert({
            session_id,
            file_name: fileInfo.name,
            file_size: fileInfo.size,
            file_type: fileInfo.type,
            mime_type: fileInfo.mimeType,
            storage_url: fileInfo.url,
            storage_path: fileInfo.path,
            is_uploaded: true,
            created_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('Error tracking uploaded file:', error);
        throw error;
    }

    console.log(`✅ Tracked uploaded file: ${fileInfo.name}`);
    return data;
}

/**
 * Track a generated file
 * @param {string} session_id - Session UUID
 * @param {string} message_id - Associated message UUID
 * @param {Object} fileInfo - File metadata
 * @returns {Object} Created file record
 */
export async function trackGeneratedFile(session_id, message_id, fileInfo) {
    const { data, error } = await supabase
        .from('session_files')
        .insert({
            session_id,
            message_id,
            file_name: fileInfo.name,
            file_size: fileInfo.size,
            file_type: fileInfo.file_type || fileInfo.type,
            mime_type: fileInfo.mime_type,
            storage_url: fileInfo.download_url || fileInfo.url,
            storage_path: fileInfo.storage_path || fileInfo.path,
            is_uploaded: false,
            created_at: new Date().toISOString(),
            metadata: fileInfo.metadata || {}
        })
        .select()
        .single();

    if (error) {
        console.error('Error tracking generated file:', error);
        throw error;
    }

    console.log(`✅ Tracked generated file: ${fileInfo.name}`);
    return data;
}

/**
 * Get all files for a session
 * @param {string} session_id - Session UUID
 * @returns {Array} List of files
 */
export async function getSessionFiles(session_id) {
    const { data, error } = await supabase
        .from('session_files')
        .select('*')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching session files:', error);
        throw error;
    }

    return data || [];
}

// ========================================
// SHARED FILE LIBRARY MANAGEMENT
// ========================================

/**
 * Add a file to the shared library
 * @param {Object} fileInfo - File metadata
 * @param {string} user_id - Optional user identifier
 * @returns {Object} Created shared file record
 */
export async function addToSharedLibrary(fileInfo, user_id = null) {
    const { data, error } = await supabase
        .from('shared_files')
        .insert({
            user_id,
            file_name: fileInfo.name,
            file_size: fileInfo.size,
            file_type: fileInfo.type,
            mime_type: fileInfo.mimeType || fileInfo.mime_type,
            storage_url: fileInfo.download_url || fileInfo.url,
            storage_path: fileInfo.storage_path || fileInfo.path,
            description: fileInfo.description || null,
            tags: fileInfo.tags || [],
            uploaded_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
            use_count: 0,
            metadata: fileInfo.metadata || {}
        })
        .select()
        .single();

    if (error) {
        console.error('Error adding to shared library:', error);
        throw error;
    }

    console.log(`✅ Added to shared library: ${fileInfo.name}`);
    return data;
}

/**
 * Get all shared files from library
 * @param {string} user_id - Optional user identifier
 * @returns {Array} List of shared files
 */
export async function getSharedFiles(user_id = null) {
    let query = supabase
        .from('shared_files')
        .select('*')
        .order('last_used_at', { ascending: false });

    if (user_id) {
        query = query.eq('user_id', user_id);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching shared files:', error);
        throw error;
    }

    return data || [];
}

/**
 * Use a shared file in a session (creates session_files link)
 * @param {string} session_id - Session UUID
 * @param {string} shared_file_id - Shared file UUID
 * @returns {Object} Created session_files record
 */
export async function useSharedFileInSession(session_id, shared_file_id) {
    // First, get the shared file details
    const { data: sharedFile, error: fetchError } = await supabase
        .from('shared_files')
        .select('*')
        .eq('file_id', shared_file_id)
        .single();

    if (fetchError) {
        console.error('Error fetching shared file:', fetchError);
        throw fetchError;
    }

    // Create session_files link
    const { data, error } = await supabase
        .from('session_files')
        .insert({
            session_id,
            shared_file_id,
            file_name: sharedFile.file_name,
            file_size: sharedFile.file_size,
            file_type: sharedFile.file_type,
            mime_type: sharedFile.mime_type,
            storage_url: sharedFile.storage_url,
            storage_path: sharedFile.storage_path,
            is_shared: true,
            is_uploaded: true,
            created_at: new Date().toISOString(),
            metadata: sharedFile.metadata || {}
        })
        .select()
        .single();

    if (error) {
        console.error('Error using shared file in session:', error);
        throw error;
    }

    console.log(`✅ Added shared file to session: ${sharedFile.file_name}`);
    return data;
}

/**
 * Remove shared file link from session (does not delete from library)
 * @param {string} session_id - Session UUID
 * @param {string} shared_file_id - Shared file UUID
 */
export async function removeSharedFileFromSession(session_id, shared_file_id) {
    const { error } = await supabase
        .from('session_files')
        .delete()
        .eq('session_id', session_id)
        .eq('shared_file_id', shared_file_id);

    if (error) {
        console.error('Error removing shared file from session:', error);
        throw error;
    }

    console.log(`✅ Removed shared file from session`);
}

/**
 * Delete a file from shared library (cascades to all sessions)
 * @param {string} file_id - Shared file UUID
 */
export async function deleteSharedFile(file_id) {
    const { error } = await supabase
        .from('shared_files')
        .delete()
        .eq('file_id', file_id);

    if (error) {
        console.error('Error deleting shared file:', error);
        throw error;
    }

    console.log(`✅ Deleted shared file from library`);
}

/**
 * Get shared files already used in a specific session
 * @param {string} session_id - Session UUID
 * @returns {Array} List of shared file IDs
 */
export async function getSharedFilesInSession(session_id) {
    const { data, error } = await supabase
        .from('session_files')
        .select('shared_file_id')
        .eq('session_id', session_id)
        .eq('is_shared', true)
        .not('shared_file_id', 'is', null);

    if (error) {
        console.error('Error fetching shared files in session:', error);
        throw error;
    }

    return (data || []).map(f => f.shared_file_id);
}

// ========================================
// ANALYSIS RESULTS (Optional)
// ========================================

/**
 * Save analysis result for later comparison
 * @param {string} session_id - Session UUID
 * @param {string} message_id - Associated message UUID
 * @param {Object} result - Analysis result data
 * @returns {Object} Created result record
 */
export async function saveAnalysisResult(session_id, message_id, result) {
    const { data, error } = await supabase
        .from('analysis_results')
        .insert({
            session_id,
            message_id,
            analysis_type: result.analysis_type,
            r_code: result.r_code,
            result_data: result.result_data,
            // iterations: result.iterations, // Commented out - column doesn't exist yet
            execution_time_ms: result.execution_time_ms,
            created_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('Error saving analysis result:', error);
        throw error;
    }

    console.log(`✅ Saved analysis result for session ${session_id}`);
    return data;
}

// ========================================
// SESSION STATUS MANAGEMENT
// ========================================

/**
 * Update session status and progress data
 * @param {string} session_id - Session UUID
 * @param {string} status - 'idle' | 'running' | 'completed' | 'error'
 * @param {Object} progressData - Progress information
 * @returns {Object} Updated session
 */
export async function updateSessionStatus(session_id, status, progressData = {}) {
    const { data, error } = await supabase
        .from('chat_sessions')
        .update({
            status,
            progress_data: progressData,
            notification_read: status === 'running' ? true : false, // Mark as unread when completed
            last_activity: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('session_id', session_id)
        .select()
        .single();

    if (error) {
        console.error('Error updating session status:', error);
        throw error;
    }

    console.log(`✅ Updated session ${session_id} status: ${status}`);
    return data;
}

/**
 * Get all active sessions with their status
 * @param {string} user_id - Optional user identifier
 * @returns {Array} List of active sessions with status
 */
export async function getActiveSessionsWithStatus(user_id = null) {
    let query = supabase
        .from('chat_sessions')
        .select('*')
        .eq('is_deleted', false)
        .in('status', ['running', 'completed'])
        .order('last_activity', { ascending: false })
        .limit(10);

    if (user_id) {
        query = query.eq('user_id', user_id);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching active sessions:', error);
        throw error;
    }

    return data || [];
}

/**
 * Mark session notification as read
 * @param {string} session_id - Session UUID
 * @returns {Object} Updated session
 */
export async function markNotificationRead(session_id) {
    const { data, error } = await supabase
        .from('chat_sessions')
        .update({
            notification_read: true,
            updated_at: new Date().toISOString()
        })
        .eq('session_id', session_id)
        .select()
        .single();

    if (error) {
        console.error('Error marking notification as read:', error);
        throw error;
    }

    console.log(`✅ Marked notification as read for session: ${session_id}`);
    return data;
}

/**
 * Get sessions with unread notifications
 * @param {string} user_id - Optional user identifier
 * @returns {Array} List of sessions with unread notifications
 */
export async function getUnreadSessions(user_id = null) {
    let query = supabase
        .from('chat_sessions')
        .select('*')
        .eq('is_deleted', false)
        .eq('notification_read', false)
        .in('status', ['completed', 'error'])
        .order('last_activity', { ascending: false });

    if (user_id) {
        query = query.eq('user_id', user_id);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching unread sessions:', error);
        throw error;
    }

    return data || [];
}

// ========================================
// WORKFLOW STEPS (for session restoration)
// ========================================

/**
 * Save a workflow step for session restoration
 * @param {string} session_id - Session UUID
 * @param {number} iteration - Current iteration number
 * @param {string} step_type - Type of step (init, thinking, code, executing, etc.)
 * @param {number} sequence_number - Global sequence number for ordering
 * @param {Object} step_data - Step-specific data (code, output, reasoning, etc.)
 * @param {string} status - Step status (pending, running, completed, error)
 * @returns {Object} Created workflow step
 */
export async function saveWorkflowStep(session_id, iteration, step_type, sequence_number, step_data = {}, status = 'completed') {
    const start_time = Date.now();

    const { data, error } = await supabase
        .from('workflow_steps')
        .insert({
            session_id,
            iteration,
            step_type,
            sequence_number,
            step_data,
            status,
            created_at: new Date().toISOString(),
            completed_at: status === 'completed' ? new Date().toISOString() : null
        })
        .select()
        .single();

    if (error) {
        console.error('Error saving workflow step:', error);
        // Don't throw - workflow step saving should not break the main flow
        return null;
    }

    const duration = Date.now() - start_time;

    // Update duration if step is completed
    if (status === 'completed' && data) {
        await supabase
            .from('workflow_steps')
            .update({ duration_ms: duration })
            .eq('step_id', data.step_id);
    }

    console.log(`✅ Saved workflow step: ${step_type} (iter ${iteration}, seq ${sequence_number})`);
    return data;
}

/**
 * Get all workflow steps for a session (for restoration)
 * @param {string} session_id - Session UUID
 * @returns {Array} List of workflow steps ordered by sequence
 */
export async function getWorkflowSteps(session_id) {
    const { data, error } = await supabase
        .from('workflow_steps')
        .select('*')
        .eq('session_id', session_id)
        .order('sequence_number', { ascending: true });

    if (error) {
        console.error('Error fetching workflow steps:', error);
        throw error;
    }

    return data || [];
}

/**
 * Clear workflow steps for a session (cleanup on restart)
 * @param {string} session_id - Session UUID
 */
export async function clearWorkflowSteps(session_id) {
    const { error } = await supabase
        .from('workflow_steps')
        .delete()
        .eq('session_id', session_id);

    if (error) {
        console.error('Error clearing workflow steps:', error);
        throw error;
    }

    console.log(`✅ Cleared workflow steps for session: ${session_id}`);
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Get complete session with messages and files
 * @param {string} session_id - Session UUID
 * @returns {Object} Complete session data
 */
export async function getCompleteSession(session_id) {
    const [session, messages, files] = await Promise.all([
        getSession(session_id),
        getMessages(session_id),
        getSessionFiles(session_id)
    ]);

    return {
        session,
        messages,
        files
    };
}

/**
 * Delete a session (soft delete)
 * @param {string} session_id - Session UUID
 * @returns {Object} Updated session
 */
export async function deleteSession(session_id) {
    const { data, error } = await supabase
        .from('chat_sessions')
        .update({ is_deleted: true })
        .eq('session_id', session_id)
        .select()
        .single();

    if (error) {
        console.error('Error deleting session:', error);
        throw error;
    }

    console.log(`✅ Deleted session: ${session_id}`);
    return data;
}

export default {
    // Session management
    createSession,
    getSessions,
    getSession,
    updateSession,
    deleteSession,
    getCompleteSession,

    // Session status
    updateSessionStatus,
    getActiveSessionsWithStatus,
    markNotificationRead,
    getUnreadSessions,

    // Message management
    saveMessage,
    getMessages,

    // File management
    trackUploadedFile,
    trackGeneratedFile,
    getSessionFiles,

    // Shared file library
    addToSharedLibrary,
    getSharedFiles,
    useSharedFileInSession,
    removeSharedFileFromSession,
    deleteSharedFile,
    getSharedFilesInSession,

    // Analysis results
    saveAnalysisResult,

    // Workflow steps (for session restoration)
    saveWorkflowStep,
    getWorkflowSteps,
    clearWorkflowSteps
};
