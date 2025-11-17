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

            const options = {
              method: 'HEAD',
              timeout: 5000,
              maxRedirects: 0
            };

            let currentUrl = urlData.redirectUrl;
            let redirectCount = 0;
            const maxRedirects = 5;

            const followRedirect = (url) => {
              if (redirectCount >= maxRedirects) {
                console.log(`✅ Resolved (max redirects): ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
                resolve({
                  uri: currentUrl,
                  title: urlData.title
                });
                return;
              }

              const parsed = new URL(url);
              const module = parsed.protocol === 'https:' ? https : http;

              const req = module.request(url, options, (res) => {
                // Check if redirect
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                  redirectCount++;
                  // Handle relative redirects
                  const newUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                  currentUrl = newUrl;
                  followRedirect(newUrl);
                } else {
                  // Final destination
                  console.log(`✅ Resolved: ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
                  resolve({
                    uri: currentUrl,
                    title: urlData.title
                  });
                }
              });

              req.on('error', (error) => {
                console.warn(`⚠️ Failed to resolve redirect for ${urlData.title}: ${error.message}`);
                console.log(`🔗 Using original redirect URL as fallback: ${urlData.redirectUrl.substring(0, 80)}...`);
                resolve({
                  uri: urlData.redirectUrl,
                  title: urlData.title
                });
              });

              req.on('timeout', () => {
                req.destroy();
                console.warn(`⚠️ Timeout resolving redirect for ${urlData.title}`);
                console.log(`🔗 Using original redirect URL as fallback: ${urlData.redirectUrl.substring(0, 80)}...`);
                resolve({
                  uri: urlData.redirectUrl,
                  title: urlData.title
                });
              });

              req.end();
            };

            followRedirect(currentUrl);
          } catch (error) {
            console.warn(`⚠️ Error resolving redirect for ${urlData.title}: ${error.message}`);
            console.log(`🔗 Using original redirect URL as fallback: ${urlData.redirectUrl.substring(0, 80)}...`);
            resolve({
              uri: urlData.redirectUrl,
              title: urlData.title
            });
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

    // Append resolved URLs directly (without "מקורות:" header to avoid duplication)
    const sourcesText = realUrls
      .map((urlData) => urlData.uri)
      .join('\n');

    text = `${text}\n${sourcesText}`;
    console.log(`✅ Appended ${realUrls.length} resolved URLs`);

    return text;
  }

  /**
   * Fix URLs with parentheses and markdown syntax
   */
  fixUrlFormatting(text) {
    // 1. Convert Markdown links [text](url) to plain text with URL
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1: $2');

    // 2. Add space between URL and closing parenthesis to prevent WhatsApp from including ) in URL
    text = text.replace(/(\bhttps?:\/\/[^\s)]+)\)/g, '$1 )');

    // 3. Add space between opening parenthesis and URL
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

