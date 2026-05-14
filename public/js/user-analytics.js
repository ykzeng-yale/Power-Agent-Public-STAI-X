/**
 * USER ANALYTICS & DEVICE FINGERPRINTING
 * Comprehensive tracking system for Power Agent
 *
 * Features:
 * - Device fingerprinting for unique user identification
 * - Interaction tracking (clicks, scrolls, inputs)
 * - Analysis request tracking with parameters
 * - Session analytics and metrics
 * - File interaction tracking
 */

class UserAnalytics {
    constructor(supabaseClient) {
        this.supabase = supabaseClient;
        this.deviceFingerprint = null;
        this.sessionId = null;
        this.sessionStartTime = Date.now();
        this.interactionCount = 0;
        this.analyticsEnabled = true;

        // Initialize tracking
        this.initialize();
    }

    /**
     * Generate device fingerprint from browser characteristics
     * Creates a unique identifier without using cookies
     */
    async generateDeviceFingerprint() {
        const components = {
            // Screen characteristics
            screenResolution: `${window.screen.width}x${window.screen.height}`,
            screenColorDepth: window.screen.colorDepth,
            screenPixelRatio: window.devicePixelRatio || 1,

            // Browser characteristics
            userAgent: navigator.userAgent,
            language: navigator.language || navigator.userLanguage,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timezoneOffset: new Date().getTimezoneOffset(),

            // Platform
            platform: navigator.platform,
            hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
            deviceMemory: navigator.deviceMemory || 'unknown',

            // Browser capabilities
            cookiesEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack || 'unknown',

            // Canvas fingerprinting (more unique)
            canvasFingerprint: await this.getCanvasFingerprint(),

            // WebGL fingerprinting
            webglFingerprint: this.getWebGLFingerprint(),

            // Audio context fingerprinting
            audioFingerprint: await this.getAudioFingerprint(),

            // Font detection
            fonts: this.detectFonts(),

            // Plugins (if available)
            plugins: this.getPluginsList()
        };

        // Create hash from all components
        const fingerprintString = JSON.stringify(components);
        const fingerprint = await this.hashString(fingerprintString);

        return fingerprint;
    }

    /**
     * Canvas fingerprinting - draws specific patterns and reads pixel data
     */
    async getCanvasFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Draw specific pattern
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('Power Agent Analytics 🔬', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('Device Fingerprint', 4, 17);

            // Get image data
            const dataUrl = canvas.toDataURL();
            return await this.hashString(dataUrl);
        } catch (e) {
            return 'canvas-unavailable';
        }
    }

    /**
     * WebGL fingerprinting
     */
    getWebGLFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

            if (!gl) return 'webgl-unavailable';

            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo) return 'webgl-limited';

            const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

            return `${vendor}|${renderer}`;
        } catch (e) {
            return 'webgl-error';
        }
    }

    /**
     * Audio context fingerprinting
     */
    async getAudioFingerprint() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return 'audio-unavailable';

            const context = new AudioContext();
            const oscillator = context.createOscillator();
            const analyser = context.createAnalyser();
            const gainNode = context.createGain();
            const scriptProcessor = context.createScriptProcessor(4096, 1, 1);

            oscillator.type = 'triangle';
            oscillator.connect(analyser);
            analyser.connect(scriptProcessor);
            scriptProcessor.connect(gainNode);
            gainNode.connect(context.destination);

            oscillator.start(0);

            return new Promise((resolve) => {
                scriptProcessor.onaudioprocess = function(event) {
                    const output = event.outputBuffer.getChannelData(0);
                    let sum = 0;
                    for (let i = 0; i < output.length; i++) {
                        sum += Math.abs(output[i]);
                    }
                    oscillator.stop();
                    context.close();
                    resolve(sum.toString());
                };
            });
        } catch (e) {
            return 'audio-error';
        }
    }

    /**
     * Detect installed fonts
     */
    detectFonts() {
        const baseFonts = ['monospace', 'sans-serif', 'serif'];
        const testFonts = [
            'Arial', 'Verdana', 'Times New Roman', 'Courier New',
            'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Comic Sans MS',
            'Trebuchet MS', 'Impact', 'Lucida Console'
        ];

        const detectedFonts = [];

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        for (const testFont of testFonts) {
            let detected = false;
            for (const baseFont of baseFonts) {
                ctx.font = `72px ${baseFont}`;
                const baseWidth = ctx.measureText('mmmmmmmmmmlli').width;

                ctx.font = `72px ${testFont}, ${baseFont}`;
                const testWidth = ctx.measureText('mmmmmmmmmmlli').width;

                if (baseWidth !== testWidth) {
                    detected = true;
                    break;
                }
            }
            if (detected) detectedFonts.push(testFont);
        }

        return detectedFonts.join(',');
    }

    /**
     * Get plugins list
     */
    getPluginsList() {
        const plugins = [];
        for (let i = 0; i < navigator.plugins.length; i++) {
            plugins.push(navigator.plugins[i].name);
        }
        return plugins.join(',');
    }

    /**
     * Hash a string using SHA-256
     */
    async hashString(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    /**
     * Parse user agent to extract device info
     */
    parseUserAgent() {
        const ua = navigator.userAgent;

        // Detect browser
        let browser = 'Unknown';
        let browserVersion = '';

        if (ua.indexOf('Chrome') > -1 && ua.indexOf('Edg') === -1) {
            browser = 'Chrome';
            browserVersion = ua.match(/Chrome\/(\d+\.\d+)/)?.[1] || '';
        } else if (ua.indexOf('Safari') > -1 && ua.indexOf('Chrome') === -1) {
            browser = 'Safari';
            browserVersion = ua.match(/Version\/(\d+\.\d+)/)?.[1] || '';
        } else if (ua.indexOf('Firefox') > -1) {
            browser = 'Firefox';
            browserVersion = ua.match(/Firefox\/(\d+\.\d+)/)?.[1] || '';
        } else if (ua.indexOf('Edg') > -1) {
            browser = 'Edge';
            browserVersion = ua.match(/Edg\/(\d+\.\d+)/)?.[1] || '';
        }

        // Detect OS
        let os = 'Unknown';
        let osVersion = '';

        if (ua.indexOf('Windows NT') > -1) {
            os = 'Windows';
            osVersion = ua.match(/Windows NT (\d+\.\d+)/)?.[1] || '';
        } else if (ua.indexOf('Mac OS X') > -1) {
            os = 'macOS';
            osVersion = ua.match(/Mac OS X (\d+[._]\d+)/)?.[1]?.replace('_', '.') || '';
        } else if (ua.indexOf('Linux') > -1) {
            os = 'Linux';
        } else if (ua.indexOf('Android') > -1) {
            os = 'Android';
            osVersion = ua.match(/Android (\d+\.\d+)/)?.[1] || '';
        } else if (ua.indexOf('iOS') > -1 || ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) {
            os = 'iOS';
            osVersion = ua.match(/OS (\d+_\d+)/)?.[1]?.replace('_', '.') || '';
        }

        // Detect device type
        let deviceType = 'desktop';
        if (/Mobile|Android|iPhone/i.test(ua)) {
            deviceType = 'mobile';
        } else if (/iPad|Tablet/i.test(ua)) {
            deviceType = 'tablet';
        }

        return { browser, browserVersion, os, osVersion, deviceType };
    }

    /**
     * Initialize tracking system
     */
    async initialize() {
        try {
            // Generate device fingerprint
            this.deviceFingerprint = await this.generateDeviceFingerprint();
            console.log('🔍 Device fingerprint generated:', this.deviceFingerprint.substring(0, 16) + '...');

            // Parse user agent
            const deviceInfo = this.parseUserAgent();

            // Register or update device in database
            await this.registerDevice(deviceInfo);

            // Initialize session analytics
            await this.initializeSessionAnalytics();

            // Set up event listeners for automatic tracking
            this.setupEventListeners();

            console.log('✅ User analytics initialized');
            console.log('   Device type:', deviceInfo.deviceType);
            console.log('   Browser:', `${deviceInfo.browser} ${deviceInfo.browserVersion}`);
            console.log('   OS:', `${deviceInfo.os} ${deviceInfo.osVersion}`);

        } catch (error) {
            console.error('❌ Analytics initialization error:', error);
            this.analyticsEnabled = false;
        }
    }

    /**
     * Register device in database
     */
    async registerDevice(deviceInfo) {
        try {
            const deviceData = {
                device_fingerprint: this.deviceFingerprint,
                browser: deviceInfo.browser,
                browser_version: deviceInfo.browserVersion,
                os: deviceInfo.os,
                os_version: deviceInfo.osVersion,
                device_type: deviceInfo.deviceType,
                screen_resolution: `${window.screen.width}x${window.screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                language: navigator.language || navigator.userLanguage,
                last_seen: new Date().toISOString(),
                metadata: {
                    user_agent: navigator.userAgent,
                    screen_color_depth: window.screen.colorDepth,
                    pixel_ratio: window.devicePixelRatio || 1
                }
            };

            // Try to update existing device, or insert new one
            const { data, error } = await this.supabase
                .from('user_devices')
                .upsert(deviceData, {
                    onConflict: 'device_fingerprint',
                    returning: 'minimal'
                });

            if (error) throw error;

            // Increment visit count
            try {
                await this.supabase.rpc('increment_device_visit', {
                    p_fingerprint: this.deviceFingerprint
                });
            } catch (rpcError) {
                console.warn('Failed to increment visit count via RPC:', rpcError);
                // Note: Fallback not possible without .raw() - ensure PostgreSQL function exists
            }

        } catch (error) {
            console.warn('Device registration error:', error);
        }
    }

    /**
     * Initialize session analytics
     */
    async initializeSessionAnalytics() {
        try {
            const sessionData = {
                session_id: this.sessionId,
                device_fingerprint: this.deviceFingerprint,
                entry_page: window.location.pathname,
                referrer: document.referrer || 'direct',
                load_time_ms: Math.round(performance.now()),
                started_at: new Date().toISOString(),
                metadata: {
                    viewport: `${window.innerWidth}x${window.innerHeight}`,
                    connection: navigator.connection?.effectiveType || 'unknown'
                }
            };

            // Use upsert to handle both new and existing sessions
            const { error } = await this.supabase
                .from('session_analytics')
                .upsert(sessionData, { onConflict: 'session_id' });

            if (error) throw error;

        } catch (error) {
            console.warn('Session analytics initialization error:', error);
        }
    }

    /**
     * Track user interaction
     */
    async trackInteraction(eventType, category, label = '', value = '', metadata = {}) {
        if (!this.analyticsEnabled) return;

        this.interactionCount++;

        try {
            const interactionData = {
                session_id: this.sessionId,
                device_fingerprint: this.deviceFingerprint || 'unknown',
                event_type: eventType || 'unknown',
                event_category: category,
                event_label: label,
                event_value: value,
                page_url: window.location.href,
                referrer: document.referrer || 'direct',
                metadata: metadata
            };

            // Fire and forget - don't wait for response
            this.supabase
                .from('user_interactions')
                .insert(interactionData)
                .then(() => {
                    // Update session analytics interaction count
                    return this.supabase
                        .from('session_analytics')
                        .update({ interactions_count: this.interactionCount })
                        .eq('session_id', this.sessionId);
                })
                .catch(err => console.warn('Interaction tracking error:', err));

        } catch (error) {
            // Silently fail - don't disrupt user experience
        }
    }

    /**
     * Track analysis request
     */
    async trackAnalysisRequest(queryText, templateUsed = null, agentMode = 'single') {
        if (!this.analyticsEnabled) return;

        try {
            const requestData = {
                session_id: this.sessionId,
                device_fingerprint: this.deviceFingerprint || 'unknown',
                query_text: queryText,
                template_used: templateUsed,
                agent_mode: agentMode,
                status: 'pending',
                metadata: {
                    query_length: queryText.length,
                    timestamp: new Date().toISOString()
                }
            };

            const { data, error } = await this.supabase
                .from('analysis_requests')
                .insert(requestData)
                .select()
                .single();

            if (error) throw error;

            // Update session analytics
            await this.supabase.rpc('increment_analysis_count', {
                p_session_id: this.sessionId
            });

            return data.id; // Return request ID for tracking completion

        } catch (error) {
            console.warn('Analysis request tracking error:', error);
            return null;
        }
    }

    /**
     * Update analysis request when completed
     */
    async completeAnalysisRequest(requestId, status = 'completed', metadata = {}) {
        if (!this.analyticsEnabled || !requestId) return;

        try {
            const updateData = {
                status: status,
                completed_at: new Date().toISOString(),
                metadata: metadata
            };

            if (metadata.execution_time_seconds) {
                updateData.execution_time_seconds = metadata.execution_time_seconds;
            }
            if (metadata.iterations_count) {
                updateData.iterations_count = metadata.iterations_count;
            }
            if (metadata.files_generated) {
                updateData.files_generated = metadata.files_generated;
                updateData.file_types = metadata.file_types || [];
            }
            if (metadata.error_occurred) {
                updateData.error_occurred = true;
                updateData.error_message = metadata.error_message;
            }

            await this.supabase
                .from('analysis_requests')
                .update(updateData)
                .eq('id', requestId);

            // Update session analytics
            if (status === 'completed') {
                await this.supabase.rpc('increment_success_metrics', {
                    p_session_id: this.sessionId,
                    p_files_generated: metadata.files_generated || 0
                });
            } else if (status === 'failed') {
                await this.supabase.rpc('increment_failure_metrics', {
                    p_session_id: this.sessionId
                });
            }

        } catch (error) {
            console.warn('Analysis completion tracking error:', error);
        }
    }

    /**
     * Track file interaction (upload, download, view)
     */
    async trackFileInteraction(fileName, fileType, interactionType, fileSize = null, fileUrl = null, analysisRequestId = null) {
        if (!this.analyticsEnabled) return;

        try {
            const fileData = {
                session_id: this.sessionId,
                device_fingerprint: this.deviceFingerprint,
                file_name: fileName,
                file_type: fileType,
                file_size_bytes: fileSize,
                file_url: fileUrl,
                interaction_type: interactionType,
                analysis_request_id: analysisRequestId
            };

            await this.supabase
                .from('file_interactions')
                .insert(fileData);

            // Update session analytics
            if (interactionType === 'download') {
                await this.supabase.rpc('increment_file_downloads', {
                    p_session_id: this.sessionId
                });
            }

        } catch (error) {
            console.warn('File interaction tracking error:', error);
        }
    }

    /**
     * Track template usage
     */
    async trackTemplateUsage(templateName) {
        if (!this.analyticsEnabled) return;

        await this.trackInteraction('template_use', 'templates', templateName);

        // Update session analytics
        try {
            await this.supabase.rpc('increment_template_usage', {
                p_session_id: this.sessionId
            });
        } catch (error) {
            console.warn('Template tracking error:', error);
        }
    }

    /**
     * Set up automatic event listeners for common interactions
     */
    setupEventListeners() {
        // Track page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.trackInteraction('visibility', 'session', 'page_hidden');
            } else {
                this.trackInteraction('visibility', 'session', 'page_visible');
            }
        });

        // Track before unload (session end)
        window.addEventListener('beforeunload', () => {
            this.endSession();
        });

        // Track page views on URL change (for SPAs)
        let lastUrl = window.location.href;
        new MutationObserver(() => {
            const url = window.location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                this.trackInteraction('pageview', 'navigation', url);
            }
        }).observe(document, { subtree: true, childList: true });
    }

    /**
     * End session and update analytics
     */
    async endSession() {
        if (!this.analyticsEnabled) return;

        try {
            const sessionDuration = Math.round((Date.now() - this.sessionStartTime) / 1000);

            await this.supabase
                .from('session_analytics')
                .update({
                    session_duration_seconds: sessionDuration,
                    ended_at: new Date().toISOString(),
                    exit_page: window.location.pathname
                })
                .eq('session_id', this.sessionId);

        } catch (error) {
            // Silently fail
        }
    }
}

// Export for use in other modules
window.UserAnalytics = UserAnalytics;
