const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Google Search integration and URL processing
 */
class GoogleSearchProcessor {
  /**
   * Process grounding metadata from Google Search
   * Resolves redirect URLs and removes hallucinated URLs
   */
  async processGroundingMetadata(text, groundingMetadata) {
    if (!groundingMetadata?.groundingChunks?.length) {
      return text;
    }

    console.log('🔗 Processing grounding metadata...');

    // Extract redirect URLs from groundingMetadata
    const redirectUrls = groundingMetadata.groundingChunks
      .filter(chunk => chunk.web?.uri)
      .map(chunk => ({
        redirectUrl: chunk.web.uri,
        title: chunk.web.title || null
      }));

    if (redirectUrls.length === 0) {
      return text;
    }

    console.log(`🔄 Found ${redirectUrls.length} redirect URLs, resolving to real URLs...`);

    // Resolve redirects to get actual URLs
    const realUrls = await Promise.all(
      redirectUrls.map(async (urlData) => {
        return new Promise((resolve) => {
          try {
            const parsedUrl = new URL(urlData.redirectUrl);
            const httpModule = parsedUrl.protocol === 'https:' ? https : http;

            let currentUrl = urlData.redirectUrl;
            let redirectCount = 0;
            const maxRedirects = 10; // Increased to handle more redirects
            let useGet = false; // Try HEAD first, then GET if needed

            const followRedirect = (url, method = 'HEAD') => {
              // Skip vertexaisearch URLs - they're redirect URLs, not final destinations
              if (url.includes('vertexaisearch') || url.includes('google.com/url')) {
                // Try to extract the actual URL from the redirect URL
                try {
                  const urlObj = new URL(url);
                  const qParam = urlObj.searchParams.get('q') || urlObj.searchParams.get('url');
                  if (qParam && (qParam.startsWith('http://') || qParam.startsWith('https://'))) {
                    currentUrl = decodeURIComponent(qParam);
                    console.log(`🔗 Extracted URL from redirect: ${currentUrl.substring(0, 80)}...`);
                    followRedirect(currentUrl, 'HEAD');
                    return;
                  }
                } catch (e) {
                  // If extraction fails, continue with normal redirect following
                }
              }

              if (redirectCount >= maxRedirects) {
                // If we still have a vertexaisearch URL after max redirects, reject it
                if (currentUrl.includes('vertexaisearch') || currentUrl.includes('google.com/url')) {
                  console.warn(`⚠️ Failed to resolve vertexaisearch redirect after ${maxRedirects} attempts for ${urlData.title}`);
                  resolve(null); // Return null to indicate failure
                  return;
                }
                console.log(`✅ Resolved (max redirects): ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
                resolve({
                  uri: currentUrl,
                  title: urlData.title
                });
                return;
              }

              const parsed = new URL(url);
              const module = parsed.protocol === 'https:' ? https : http;

              const options = {
                method: method,
                timeout: 8000, // Increased timeout
                maxRedirects: 0
              };

              const req = module.request(url, options, (res) => {
                // Check if redirect
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                  redirectCount++;
                  // Handle relative redirects
                  const newUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                  currentUrl = newUrl;
                  followRedirect(newUrl, 'HEAD');
                } else {
                  // Final destination - make sure it's not a vertexaisearch URL
                  if (currentUrl.includes('vertexaisearch') || currentUrl.includes('google.com/url')) {
                    // If HEAD didn't work and we haven't tried GET yet, try GET
                    if (method === 'HEAD' && !useGet) {
                      useGet = true;
                      followRedirect(url, 'GET');
                      return;
                    }
                    console.warn(`⚠️ Final URL is still a redirect URL for ${urlData.title}`);
                    resolve(null); // Reject vertexaisearch URLs
                    return;
                  }
                  console.log(`✅ Resolved: ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
                  resolve({
                    uri: currentUrl,
                    title: urlData.title
                  });
                }
              });

              req.on('error', (error) => {
                // If HEAD failed and we haven't tried GET yet, try GET
                if (method === 'HEAD' && !useGet) {
                  useGet = true;
                  followRedirect(url, 'GET');
                  return;
                }
                console.warn(`⚠️ Failed to resolve redirect for ${urlData.title}: ${error.message}`);
                // Don't use vertexaisearch URLs as fallback
                if (urlData.redirectUrl.includes('vertexaisearch') || urlData.redirectUrl.includes('google.com/url')) {
                  console.warn(`⚠️ Rejecting vertexaisearch URL: ${urlData.redirectUrl.substring(0, 80)}...`);
                  resolve(null);
                  return;
                }
                resolve(null);
              });

              req.on('timeout', () => {
                req.destroy();
                // If HEAD timed out and we haven't tried GET yet, try GET
                if (method === 'HEAD' && !useGet) {
                  useGet = true;
                  followRedirect(url, 'GET');
                  return;
                }
                console.warn(`⚠️ Timeout resolving redirect for ${urlData.title}`);
                // Don't use vertexaisearch URLs as fallback
                if (urlData.redirectUrl.includes('vertexaisearch') || urlData.redirectUrl.includes('google.com/url')) {
                  console.warn(`⚠️ Rejecting vertexaisearch URL due to timeout: ${urlData.redirectUrl.substring(0, 80)}...`);
                  resolve(null);
                  return;
                }
                resolve(null);
              });

              req.end();
            };

            followRedirect(currentUrl);
          } catch (error) {
            console.warn(`⚠️ Error resolving redirect for ${urlData.title}: ${error.message}`);
            // Don't use vertexaisearch URLs as fallback
            if (urlData.redirectUrl.includes('vertexaisearch') || urlData.redirectUrl.includes('google.com/url')) {
              console.warn(`⚠️ Rejecting vertexaisearch URL due to error: ${urlData.redirectUrl.substring(0, 80)}...`);
              resolve(null);
              return;
            }
            resolve(null);
          }
        });
      })
    );

    // Remove any hallucinated URLs from Gemini's text
    const urlRegex = /(https?:\/\/[^\s)<]+)/g;
    const foundUrls = text.match(urlRegex) || [];

    if (foundUrls.length > 0) {
      console.log(`🔍 Found ${foundUrls.length} URLs in text, removing hallucinated ones...`);
      text = text.replace(urlRegex, '');
      text = text.replace(/\s+/g, ' ').trim();
    }

    // Filter out null results (failed redirect resolutions) and vertexaisearch URLs
    const validUrls = realUrls
      .filter(urlData => urlData && urlData.uri && 
        !urlData.uri.includes('vertexaisearch') && 
        !urlData.uri.includes('google.com/url'))
      .map((urlData) => urlData.uri);

    if (validUrls.length > 0) {
      const sourcesText = validUrls.join('\n');
      text = `${text}\n${sourcesText}`;
      console.log(`✅ Appended ${validUrls.length} resolved URLs (filtered out ${realUrls.length - validUrls.length} invalid/redirect URLs)`);
    } else {
      console.warn(`⚠️ No valid URLs to append after filtering (all ${realUrls.length} URLs were invalid or redirect URLs)`);
    }

    return text;
  }

  /**
   * Fix URLs with parentheses and markdown syntax
   */
  fixUrlFormatting(text) {
    // 1. Convert Markdown links [text](url) to plain text with URL
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1: $2');

    // 2. Remove square brackets around URLs: [https://...] -> https://...
    text = text.replace(/\[(https?:\/\/[^\]]+)\]/g, '$1');

    // 3. Remove square brackets around text that contains URLs: [text https://...] -> text https://...
    // This handles cases like [some text https://example.com] -> some text https://example.com
    text = text.replace(/\[([^\]]*?)(https?:\/\/[^\]]+)([^\]]*?)\]/g, '$1$2$3');

    // 4. Add space between URL and closing parenthesis to prevent WhatsApp from including ) in URL
    text = text.replace(/(\bhttps?:\/\/[^\s)]+)\)/g, '$1 )');

    // 5. Add space between opening parenthesis and URL
    text = text.replace(/\((\bhttps?:\/\/[^\s)]+)/g, '( $1');

    return text;
  }

  /**
   * Detect and log suspicious YouTube URLs (likely hallucinated)
   */
  validateYouTubeUrls(text) {
    const youtubeUrls = text.match(/https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([^\s&)]+)/g);
    
    if (!youtubeUrls) {
      return;
    }

    youtubeUrls.forEach(url => {
      const videoIdMatch = url.match(/(?:watch\?v=|youtu\.be\/)([^\s&)]+)/);
      if (videoIdMatch && videoIdMatch[1]) {
        const videoId = videoIdMatch[1];
        // YouTube video IDs should be 11 characters
        if (videoId.length < 10 || videoId.length > 12) {
          console.warn(`⚠️ Suspicious YouTube URL detected (ID length: ${videoId.length}): ${url}`);
          console.warn(`   This URL might be hallucinated by Gemini!`);
        }
        // Check for obvious hallucination patterns (e.g., "abc123", "example", "xxx")
        if (/^(abc|test|example|xxx|demo|sample)/i.test(videoId)) {
          console.warn(`⚠️ Likely hallucinated YouTube URL detected: ${url}`);
          console.warn(`   Video ID "${videoId}" looks fake!`);
        }
      }
    });
  }

  /**
   * Process text with Google Search results
   */
  async processTextWithGoogleSearch(text, groundingMetadata, useGoogleSearch) {
    // Process grounding metadata (resolve redirects)
    if (useGoogleSearch && groundingMetadata?.groundingChunks?.length > 0) {
      text = await this.processGroundingMetadata(text, groundingMetadata);
    }

    // Fix URL formatting
    text = this.fixUrlFormatting(text);

    // Validate YouTube URLs
    if (useGoogleSearch) {
      this.validateYouTubeUrls(text);
    }

    return text;
  }
}

module.exports = new GoogleSearchProcessor();

