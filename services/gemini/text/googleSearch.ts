import https from 'https';
import http from 'http';
import { URL } from 'url';
import logger from '../../../utils/logger';

/**
 * Grounding chunk
 */
interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}


/**
 * URL data
 */
interface UrlData {
  redirectUrl: string;
  title: string | null;
}

/**
 * Resolved URL
 */
interface ResolvedUrl {
  uri: string;
  title: string | null;
}

/**
 * Google Search integration and URL processing
 */
class GoogleSearchProcessor {
  /**
   * Process grounding metadata from Google Search
   * Resolves redirect URLs and removes hallucinated URLs
   */
  async processGroundingMetadata(text: string, groundingMetadata: unknown): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = groundingMetadata as any;
    if (!metadata?.groundingChunks?.length) {
      return text;
    }

    logger.debug('🔗 Processing grounding metadata...');

    // Extract redirect URLs from groundingMetadata
    const redirectUrls: UrlData[] = metadata.groundingChunks
      .filter((chunk: GroundingChunk) => chunk.web?.uri)
      .map((chunk: GroundingChunk) => ({
        redirectUrl: chunk.web!.uri!,
        title: chunk.web!.title || null
      }));

    if (redirectUrls.length === 0) {
      return text;
    }

    logger.debug(`🔄 Found ${redirectUrls.length} redirect URLs, resolving to real URLs...`);

    // Resolve redirects to get actual URLs
    const realUrls = await Promise.all(
      redirectUrls.map(async (urlData): Promise<ResolvedUrl | null> => {
        return new Promise((resolve) => {
          try {
            let currentUrl = urlData.redirectUrl;
            let redirectCount = 0;
            const maxRedirects = 10; // Increased to handle more redirects
            let useGet = false; // Try HEAD first, then GET if needed

            const followRedirect = (url: string, method: 'HEAD' | 'GET' = 'HEAD'): void => {
              // Skip vertexaisearch URLs - they're redirect URLs, not final destinations
              if (url.includes('vertexaisearch') || url.includes('google.com/url')) {
                // Try to extract the actual URL from the redirect URL
                try {
                  const urlObj = new URL(url);
                  const qParam = urlObj.searchParams.get('q') || urlObj.searchParams.get('url');
                  if (qParam && (qParam.startsWith('http://') || qParam.startsWith('https://'))) {
                    currentUrl = decodeURIComponent(qParam);
                    logger.debug(`🔗 Extracted URL from redirect: ${currentUrl.substring(0, 80)}...`);
                    followRedirect(currentUrl, 'HEAD');
                    return;
                  }
                } catch (_e) {
                  // If extraction fails, continue with normal redirect following
                }
              }

              if (redirectCount >= maxRedirects) {
                // If we still have a vertexaisearch URL after max redirects, reject it
                if (currentUrl.includes('vertexaisearch') || currentUrl.includes('google.com/url')) {
                  logger.warn(`⚠️ Failed to resolve vertexaisearch redirect after ${maxRedirects} attempts for ${urlData.title}`);
                  resolve(null); // Return null to indicate failure
                  return;
                }
                logger.debug(`✅ Resolved (max redirects): ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
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
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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
                    logger.warn(`⚠️ Final URL is still a redirect URL for ${urlData.title}`);
                    resolve(null); // Reject vertexaisearch URLs
                    return;
                  }
                  logger.debug(`✅ Resolved: ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
                  resolve({
                    uri: currentUrl,
                    title: urlData.title
                  });
                }
              });

              req.on('error', (error: Error) => {
                // If HEAD failed and we haven't tried GET yet, try GET
                if (method === 'HEAD' && !useGet) {
                  useGet = true;
                  followRedirect(url, 'GET');
                  return;
                }
                logger.warn(`⚠️ Failed to resolve redirect for ${urlData.title}:`, { error: error.message });
                // Don't use vertexaisearch URLs as fallback
                if (urlData.redirectUrl.includes('vertexaisearch') || urlData.redirectUrl.includes('google.com/url')) {
                  logger.warn(`⚠️ Rejecting vertexaisearch URL: ${urlData.redirectUrl.substring(0, 80)}...`);
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
                logger.warn(`⚠️ Timeout resolving redirect for ${urlData.title}`);
                // Don't use vertexaisearch URLs as fallback
                if (urlData.redirectUrl.includes('vertexaisearch') || urlData.redirectUrl.includes('google.com/url')) {
                  logger.warn(`⚠️ Rejecting vertexaisearch URL due to timeout: ${urlData.redirectUrl.substring(0, 80)}...`);
                  resolve(null);
                  return;
                }
                resolve(null);
              });

              req.end();
            };

            followRedirect(currentUrl);
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(`⚠️ Error resolving redirect for ${urlData.title}:`, { error: errorMessage });
            // Don't use vertexaisearch URLs as fallback
            if (urlData.redirectUrl.includes('vertexaisearch') || urlData.redirectUrl.includes('google.com/url')) {
              logger.warn(`⚠️ Rejecting vertexaisearch URL due to error: ${urlData.redirectUrl.substring(0, 80)}...`);
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
      logger.debug(`🔍 Found ${foundUrls.length} URLs in text, removing hallucinated ones...`);
      text = text.replace(urlRegex, '');
      text = text.replace(/\s+/g, ' ').trim();
    }

    // Filter out null results (failed redirect resolutions) and vertexaisearch URLs
    const validUrls = realUrls
      .filter((urlData): urlData is ResolvedUrl => {
        if (!urlData || !urlData.uri) return false;
        if (typeof urlData.uri !== 'string') return false;
        return !urlData.uri.includes('vertexaisearch') && !urlData.uri.includes('google.com/url');
      })
      .map((urlData) => urlData.uri);

    if (validUrls.length > 0) {
      const sourcesText = validUrls.join('\n');
      text = `${text}\n${sourcesText}`;
      logger.info(`✅ Appended ${validUrls.length} resolved URLs (filtered out ${realUrls.length - validUrls.length} invalid/redirect URLs)`);
    } else {
      logger.warn(`⚠️ No valid URLs to append after filtering (all ${realUrls.length} URLs were invalid or redirect URLs)`);
    }

    return text;
  }

  /**
   * Fix URLs with parentheses and markdown syntax
   */
  fixUrlFormatting(text: string): string {
    // 1. Convert Markdown links [text](url) to plain text with URL
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1: $2');

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
  validateYouTubeUrls(text: string): void {
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
          logger.warn(`⚠️ Suspicious YouTube URL detected (ID length: ${videoId.length}): ${url} - This URL might be hallucinated by Gemini!`);
        }
        // Check for obvious hallucination patterns (e.g., "abc123", "example", "xxx")
        if (/^(abc|test|example|xxx|demo|sample)/i.test(videoId)) {
          logger.warn(`⚠️ Likely hallucinated YouTube URL detected: ${url} - Video ID "${videoId}" looks fake!`);
        }
      }
    });
  }

  /**
   * Process text with Google Search results
   */
  async processTextWithGoogleSearch(text: string, groundingMetadata: unknown, useGoogleSearch: boolean | string): Promise<string> {
    const isGoogleSearchEnabled = useGoogleSearch === true || useGoogleSearch === 'true';

    // Process grounding metadata (resolve redirects)
    if (isGoogleSearchEnabled && groundingMetadata) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata = groundingMetadata as any;
      if (metadata?.groundingChunks?.length > 0) {
        text = await this.processGroundingMetadata(text, groundingMetadata);
      }
    }

    // Fix URL formatting
    text = this.fixUrlFormatting(text);

    // Validate YouTube URLs
    if (isGoogleSearchEnabled) {
      this.validateYouTubeUrls(text);
    }

    return text;
  }
}

export default new GoogleSearchProcessor();

