/**
 * Group Service
 * Handles group creation with intelligent parsing and fuzzy contact matching
 */

import { generateTextResponse as geminiText } from './geminiService';
import conversationManager from './conversationManager';
import prompts from '../config/prompts';
import logger from '../utils/logger';
import { get, set } from '../utils/cache';
import { CacheKeys, CacheTTL } from '../utils/cache';
import { getEntityType } from '../config/messages';

/**
 * Parsed group creation result
 */
interface ParsedGroupCreation {
  groupName: string;
  participants: string[];
  groupPicture?: string;
}

/**
 * Gemini text response structure
 */
interface GeminiTextResult {
  text: string;
  [key: string]: unknown;
}

/**
 * Contact structure from database
 */
interface Contact {
  contact_id: string;
  contact_name?: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Contact match result
 */
interface ContactMatch {
  contact: Contact;
  score: number;
}

/**
 * Resolved participant structure
 */
interface ResolvedParticipant {
  searchName: string;
  contactId: string;
  contactName: string;
  matchScore: number;
}

/**
 * Participant resolution result
 */
interface ParticipantResolutionResult {
  resolved: ResolvedParticipant[];
  notFound: string[];
}

/**
 * Contact search result
 */
interface ContactSearchResult {
  contactId: string;
  contactName: string;
  matchScore: number;
  isGroup: boolean;
  originalName?: string;
  originalContactName?: string;
  type?: string;
}

/**
 * Parse group creation prompt using Gemini
 * Extracts group name, participant names, and optional group picture description from natural language
 * 
 * @param prompt - User's group creation request
 * @returns Parsed group creation data
 * 
 * Examples:
 * - "צור קבוצה בשם 'כדורגל בשכונה' עם קוקו, מכנה ומסיק"
 * - "create group called 'Project Team' with John, Sarah and Mike"
 * - "צור קבוצה עם קרלוס בשם 'כדורגל בשכונה' עם תמונה של ברבור"
 */
export async function parseGroupCreationPrompt(prompt: string): Promise<ParsedGroupCreation> {
  try {
    console.log('🔍 Parsing group creation prompt with Gemini...');
    
    // Use centralized prompt from config/prompts.ts (SSOT - Phase 5.1)
    const parsingPrompt = prompts.groupCreationParsingPrompt(prompt);

    const result = await geminiText(parsingPrompt, [], { model: 'gemini-2.5-flash' }) as GeminiTextResult | null;
    
    if (!result || !result.text) {
      throw new Error('No response from Gemini');
    }
    
    let rawText = result.text.trim();
    
    // Remove markdown code fences if present
    rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    const parsed = JSON.parse(rawText) as ParsedGroupCreation;
    
    // Validate structure
    if (!parsed.groupName || !Array.isArray(parsed.participants) || parsed.participants.length === 0) {
      throw new Error('Invalid parsed structure');
    }
    
    console.log(`✅ Parsed group creation request:`);
    console.log(`   Group name: "${parsed.groupName}"`);
    console.log(`   Participants: ${parsed.participants.join(', ')}`);
    
    return parsed;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error parsing group creation prompt:', error);
    throw new Error(`Failed to parse group creation request: ${errorMessage}`);
  }
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching of contact names
 * 
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance (lower is more similar)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= s1.length; j++) {
    if (matrix[0]) {
      matrix[0][j] = j;
    }
  }
  
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          (matrix[i - 1]?.[j - 1] ?? Infinity) + 1, // substitution
          (matrix[i]?.[j - 1] ?? Infinity) + 1,     // insertion
          (matrix[i - 1]?.[j] ?? Infinity) + 1      // deletion
        );
      }
    }
  }
  
  return matrix[s2.length]?.[s1.length] ?? Infinity;
}

/**
 * Calculate similarity score between two strings (0-1)
 * 1 = identical, 0 = completely different
 * 
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity score (0-1)
 */
export function similarityScore(str1: string, str2: string): number {
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1.0;
  
  const distance = levenshteinDistance(str1, str2);
  return 1.0 - distance / maxLength;
}

/**
 * Find best matching contact for a given name using fuzzy search
 * Searches in contact_name, name, and chatId fields
 * Includes both private contacts (@c.us) and groups (@g.us)
 * 
 * @param searchName - Name to search for
 * @param contacts - All contacts from database
 * @param threshold - Minimum similarity threshold (0-1, default 0.6)
 * @returns Best matching contact or null if no good match
 */
function findBestContactMatch(searchName: string, contacts: Contact[], threshold: number = 0.6): ContactMatch | null {
  let bestMatch: Contact | null = null;
  let bestScore = 0;
  
  for (const contact of contacts) {
    // Match both private chats (@c.us) AND groups (@g.us)
    if (!contact.contact_id) {
      continue;
    }
    
    // Check contact_name field (priority 1)
    if (contact.contact_name) {
      const score = similarityScore(searchName, contact.contact_name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = contact;
      }
    }
    
    // Check name field (priority 2)
    if (contact.name) {
      const score = similarityScore(searchName, contact.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = contact;
      }
    }
    
    // Check if search name is contained in contact name (substring match)
    if (contact.contact_name && contact.contact_name.toLowerCase().includes(searchName.toLowerCase())) {
      const score = 0.8; // High score for substring match
      if (score > bestScore) {
        bestScore = score;
        bestMatch = contact;
      }
    }
    
    if (contact.name && contact.name.toLowerCase().includes(searchName.toLowerCase())) {
      const score = 0.8;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = contact;
      }
    }
  }
  
  // Return match only if it meets threshold
  if (bestMatch && bestScore >= threshold) {
    console.log(`   ✓ Found match for "${searchName}": ${bestMatch.contact_name || bestMatch.name} (score: ${bestScore.toFixed(2)})`);
    return { contact: bestMatch, score: bestScore };
  }
  
  console.log(`   ✗ No match found for "${searchName}" (best score: ${bestScore.toFixed(2)})`);
  return null;
}

/**
 * Resolve participant names to WhatsApp IDs using fuzzy matching
 * 
 * @param participantNames - Array of names to resolve
 * @returns Resolved participants and not found names
 */
export async function resolveParticipants(participantNames: string[]): Promise<ParticipantResolutionResult> {
  try {
    console.log(`🔍 Resolving ${participantNames.length} participants...`);
    
    // Get all contacts from database
    const contacts = await conversationManager.getAllContacts() as Contact[];
    
    if (!contacts || contacts.length === 0) {
      throw new Error('No contacts found in database. Please sync contacts first using "עדכן אנשי קשר"');
    }
    
    console.log(`📇 Searching through ${contacts.length} contacts in database`);
    
    const resolved: ResolvedParticipant[] = [];
    const notFound: string[] = [];
    
    for (const participantName of participantNames) {
      const match = findBestContactMatch(participantName, contacts);
      
      if (match) {
        resolved.push({
          searchName: participantName,
          contactId: match.contact.contact_id,
          contactName: match.contact.contact_name || match.contact.name || '',
          matchScore: match.score
        });
      } else {
        notFound.push(participantName);
      }
    }
    
    console.log(`✅ Resolved ${resolved.length}/${participantNames.length} participants`);
    if (notFound.length > 0) {
      console.log(`⚠️ Could not find: ${notFound.join(', ')}`);
    }
    
    return { resolved, notFound };
    
  } catch (error: unknown) {
    console.error('❌ Error resolving participants:', error);
    throw error;
  }
}

/**
 * Find a single contact or group by name using fuzzy matching
 * Used for management commands that need to resolve a contact/group name
 * 
 * @param searchName - Name to search for
 * @param threshold - Minimum similarity threshold (0-1, default 0.6)
 * @returns Contact search result or null if not found
 */
export async function findContactByName(searchName: string, threshold: number = 0.6): Promise<ContactSearchResult | null> {
  try {
    logger.debug(`🔍 Searching for contact/group: "${searchName}"`);
    
    // Try cache first (cache key includes search name and threshold)
    const cacheKey = CacheKeys.contact(`${searchName}:${threshold}`);
    const cached = get<ContactSearchResult | null>(cacheKey);
    if (cached !== null) {
      logger.debug(`✅ Contact found in cache`, { searchName });
      return cached;
    }
    
    // Get all contacts from database (includes both private contacts and groups)
    // This itself is cached, so it's fast
    const contacts = await conversationManager.getAllContacts() as Contact[];
    
    if (!contacts || contacts.length === 0) {
      logger.warn('⚠️ No contacts/groups found in database');
      return null;
    }
    
    logger.debug(`📇 Searching through ${contacts.length} contacts and groups in database`);
    
    const match = findBestContactMatch(searchName, contacts, threshold);
    
    if (match) {
      const isGroup = match.contact.contact_id.endsWith('@g.us');
      const entityType = getEntityType(isGroup);
      
      const result: ContactSearchResult = {
        contactId: match.contact.contact_id,
        contactName: match.contact.contact_name || match.contact.name || '',
        matchScore: match.score,
        isGroup: isGroup,
        // Keep all original contact data for flexibility
        originalName: match.contact.name,
        originalContactName: match.contact.contact_name,
        type: match.contact.type
      };
      
      // Cache successful lookup for 5 minutes
      set(cacheKey, result, CacheTTL.MEDIUM);
      
      logger.debug(`✅ Found ${entityType}`, {
        searchName,
        foundName: result.contactName,
        score: match.score.toFixed(2),
        isGroup
      });
      
      return result;
    }
    
    logger.debug(`❌ No match found for "${searchName}"`);
    // Cache null results for shorter time (1 minute) to avoid repeated failed lookups
    set(cacheKey, null, CacheTTL.SHORT);
    return null;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('❌ Error finding contact by name', {
      searchName,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
    void errorMessage; // Suppress unused variable warning (used in error object)
    return null;
  }
}

