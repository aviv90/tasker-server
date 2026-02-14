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
            const maxRedirects = 8;
            let useGet = false; // Try HEAD first, then GET if needed

            const followRedirect = (url: string, method: 'HEAD' | 'GET' = 'HEAD'): void => {
              // Skip vertexaisearch URLs - they're redirect URLs, not final destinations
              if (url.includes('vertexaisearch') || url.includes('google.com/url')) {
                // Try to extract the actual URL from the redirect URL parameters
                try {
                  const urlObj = new URL(url);
                  const qParam = urlObj.searchParams.get('q') || urlObj.searchParams.get('url');
                  if (qParam && (qParam.startsWith('http://') || qParam.startsWith('https://'))) {
                    currentUrl = decodeURIComponent(qParam);
                    logger.debug(`🔗 Extracted URL from redirect param: ${currentUrl.substring(0, 80)}...`);
                    followRedirect(currentUrl, 'HEAD');
                    return;
                  }
                } catch (_e) {
                  // If extraction fails, continue with normal redirect following
                }
              }

              if (redirectCount >= maxRedirects) {
                // If we hit max redirects, return the last known URL (even if it's a redirect/search URL)
                // Better to have a link than nothing
                logger.warn(`⚠️ Max redirects (${maxRedirects}) reached for ${urlData.title}`);
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
                timeout: 15000, // Increased to 15 seconds for slow sites
                headers: {
                  'User-Agent': 'Mozilla/5.0 (compatible; TaskerBot/1.0; +http://tasker.aviv)', // User-Agent to avoid blocking
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
              };

              const req = module.request(url, options, (res) => {
                // Check if redirect
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                  redirectCount++;
                  // Handle relative redirects
                  try {
                    const newUrl = res.headers.location.startsWith('http')
                      ? res.headers.location
                      : new URL(res.headers.location, url).href;
                    currentUrl = newUrl;
                    followRedirect(newUrl, 'HEAD');
                  } catch (e: any) {
                    logger.warn(`⚠️ Invalid redirect location: ${res.headers.location}`, { error: e.message });
                    resolve({ uri: currentUrl, title: urlData.title });
                  }
                } else if (res.statusCode === 405 && method === 'HEAD') {
                  // Method Not Allowed - try GET
                  if (!useGet) {
                    useGet = true;
                    followRedirect(url, 'GET');
                  } else {
                    resolve({ uri: currentUrl, title: urlData.title });
                  }
                } else {
                  // Final destination or error status
                  // For vertexaisearch, if we get 200 OK on the redirect URL itself without redirecting,
                  // it might be a captive portal or a page we can't bypass.
                  // We'll return it anyway as fallback.
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
                logger.warn(`⚠️ Error resolving redirect via ${method} for ${urlData.title}: ${error.message}`);
                // FALLBACK: Use the last known URL
                resolve({
                  uri: currentUrl, // Use currentUrl which might be an intermediate resolved URL
                  title: urlData.title
                });
              });

              req.on('timeout', () => {
                req.destroy();
                // If HEAD timed out and we haven't tried GET yet, try GET
                if (method === 'HEAD' && !useGet) {
                  useGet = true;
                  followRedirect(url, 'GET');
                  return;
                }
                logger.warn(`⚠️ Timeout resolving redirect for ${urlData.title} (${currentUrl})`);
                // FALLBACK: Use the last known URL instead of rejecting
                resolve({
                  uri: currentUrl,
                  title: urlData.title
                });
              });

              req.end();
            };

            followRedirect(currentUrl);
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Unexpected error in redirect resolution for ${urlData.title}:`, { error: errorMessage });
            // Always fallback to original URL
            resolve({
              uri: urlData.redirectUrl,
              title: urlData.title
            });
          }
        });
      })
    );

    // Filter out null results (should be rare with new fallback logic)
    const validUrls = realUrls
      .filter((urlData): urlData is ResolvedUrl => {
        return urlData !== null && !!urlData.uri && typeof urlData.uri === 'string';
      })
      .map((urlData) => urlData.uri);

    if (validUrls.length > 0) {
      // Deduplicate URLs
      const uniqueUrls = [...new Set(validUrls)];
      const sourcesText = uniqueUrls.join('\n');
      text = `${text}\n${sourcesText}`;
      logger.info(`✅ Appended ${uniqueUrls.length} resolved/fallback URLs`);
    } else {
      logger.warn(`⚠️ No valid URLs to append after processing`);
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
