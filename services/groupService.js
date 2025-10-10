/**
 * Group Service
 * Handles group creation with intelligent parsing and fuzzy contact matching
 */

const { generateTextResponse: geminiText } = require('./geminiService');
const conversationManager = require('./conversationManager');

/**
 * Parse group creation prompt using Gemini
 * Extracts group name, participant names, and optional group picture description from natural language
 * 
 * @param {string} prompt - User's group creation request
 * @returns {Promise<Object>} - { groupName: string, participants: Array<string>, groupPicture?: string }
 * 
 * Examples:
 * - "צור קבוצה בשם 'כדורגל בשכונה' עם קוקו, מכנה ומסיק"
 * - "create group called 'Project Team' with John, Sarah and Mike"
 * - "צור קבוצה עם קרלוס בשם 'כדורגל בשכונה' עם תמונה של ברבור"
 */
async function parseGroupCreationPrompt(prompt) {
  try {
    console.log('🔍 Parsing group creation prompt with Gemini...');
    
    const parsingPrompt = `Analyze this group creation request and extract the group name, participant names, and optional group picture description.

User request: "${prompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "groupName": "the group name",
  "participants": ["name1", "name2", "name3"],
  "groupPicture": "description of picture or null"
}

Rules:
1. Extract the group name from phrases like "בשם", "קוראים", "שם", "called", "named", or from quotes
2. Extract participant names from lists after "עם", "with", "והם", "including", etc.
3. Parse comma-separated names or names with "ו" (and) / "and"
4. Return names as they appear (don't translate or modify)
5. If group name is in quotes, extract it without quotes
6. If no clear group name, use a reasonable default based on context
7. Extract picture description from phrases like "עם תמונה של", "with picture of", "with image of", etc.
8. If no picture mentioned, set groupPicture to null
9. Picture description should be detailed and in English for best image generation results

Examples:

Input: "צור קבוצה בשם 'כדורגל בשכונה' עם קוקו, מכנה ומסיק"
Output: {"groupName":"כדורגל בשכונה","participants":["קוקו","מכנה","מסיק"],"groupPicture":null}

Input: "create group called Project Team with John, Sarah and Mike"
Output: {"groupName":"Project Team","participants":["John","Sarah","Mike"],"groupPicture":null}

Input: "צור קבוצה עם קרלוס בשם 'כדורגל בשכונה' עם תמונה של ברבור"
Output: {"groupName":"כדורגל בשכונה","participants":["קרלוס"],"groupPicture":"a beautiful swan"}

Input: "צור קבוצה עם אבי ורועי בשם 'פרויקט X' עם תמונה של רובוט עתידני"
Output: {"groupName":"פרויקט X","participants":["אבי","רועי"],"groupPicture":"a futuristic robot"}

Input: "create group Work Team with Mike, Sarah with picture of a mountain sunset"
Output: {"groupName":"Work Team","participants":["Mike","Sarah"],"groupPicture":"a mountain sunset"}`;

    const result = await geminiText(parsingPrompt, [], { model: 'gemini-2.5-flash' });
    
    if (!result || !result.text) {
      throw new Error('No response from Gemini');
    }
    
    let rawText = result.text.trim();
    
    // Remove markdown code fences if present
    rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    const parsed = JSON.parse(rawText);
    
    // Validate structure
    if (!parsed.groupName || !Array.isArray(parsed.participants) || parsed.participants.length === 0) {
      throw new Error('Invalid parsed structure');
    }
    
    console.log(`✅ Parsed group creation request:`);
    console.log(`   Group name: "${parsed.groupName}"`);
    console.log(`   Participants: ${parsed.participants.join(', ')}`);
    
    return parsed;
    
  } catch (error) {
    console.error('❌ Error parsing group creation prompt:', error);
    throw new Error(`Failed to parse group creation request: ${error.message}`);
  }
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching of contact names
 * 
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Edit distance (lower is more similar)
 */
function levenshteinDistance(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  const matrix = [];
  
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[s2.length][s1.length];
}

/**
 * Calculate similarity score between two strings (0-1)
 * 1 = identical, 0 = completely different
 * 
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score (0-1)
 */
function similarityScore(str1, str2) {
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1.0;
  
  const distance = levenshteinDistance(str1, str2);
  return 1.0 - distance / maxLength;
}

/**
 * Find best matching contact for a given name using fuzzy search
 * Searches in contact_name, name, and chatId fields
 * 
 * @param {string} searchName - Name to search for
 * @param {Array<Object>} contacts - All contacts from database
 * @param {number} threshold - Minimum similarity threshold (0-1, default 0.6)
 * @returns {Object|null} - Best matching contact or null if no good match
 */
function findBestContactMatch(searchName, contacts, threshold = 0.6) {
  let bestMatch = null;
  let bestScore = 0;
  
  for (const contact of contacts) {
    // Only match private chats (@c.us), not groups (@g.us)
    if (!contact.contact_id || !contact.contact_id.endsWith('@c.us')) {
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
 * @param {Array<string>} participantNames - Array of names to resolve
 * @returns {Promise<Object>} - { resolved: Array<{name, contactId, contactName}>, notFound: Array<string> }
 */
async function resolveParticipants(participantNames) {
  try {
    console.log(`🔍 Resolving ${participantNames.length} participants...`);
    
    // Get all contacts from database
    const contacts = await conversationManager.getAllContacts();
    
    if (!contacts || contacts.length === 0) {
      throw new Error('No contacts found in database. Please sync contacts first using "עדכן אנשי קשר"');
    }
    
    console.log(`📇 Searching through ${contacts.length} contacts in database`);
    
    const resolved = [];
    const notFound = [];
    
    for (const participantName of participantNames) {
      const match = findBestContactMatch(participantName, contacts);
      
      if (match) {
        resolved.push({
          searchName: participantName,
          contactId: match.contact.contact_id,
          contactName: match.contact.contact_name || match.contact.name,
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
    
  } catch (error) {
    console.error('❌ Error resolving participants:', error);
    throw error;
  }
}

/**
 * Find a single contact by name using fuzzy matching
 * Used for management commands that need to resolve a contact name
 * 
 * @param {string} searchName - Name to search for
 * @param {number} threshold - Minimum similarity threshold (0-1, default 0.6)
 * @returns {Promise<Object|null>} - { contactId, contactName, matchScore } or null if not found
 */
async function findContactByName(searchName, threshold = 0.6) {
  try {
    console.log(`🔍 Searching for contact: "${searchName}"`);
    
    // Get all contacts from database
    const contacts = await conversationManager.getAllContacts();
    
    if (!contacts || contacts.length === 0) {
      console.log('⚠️ No contacts found in database');
      return null;
    }
    
    console.log(`📇 Searching through ${contacts.length} contacts in database`);
    
    const match = findBestContactMatch(searchName, contacts, threshold);
    
    if (match) {
      console.log(`✅ Found contact: "${searchName}" → "${match.contact.contact_name || match.contact.name}" (score: ${match.score.toFixed(2)})`);
      return {
        contactId: match.contact.contact_id,
        contactName: match.contact.contact_name || match.contact.name,
        matchScore: match.score,
        // Keep all original contact data for flexibility
        originalName: match.contact.name,
        originalContactName: match.contact.contact_name,
        type: match.contact.type
      };
    }
    
    console.log(`❌ No match found for "${searchName}"`);
    return null;
    
  } catch (error) {
    console.error('❌ Error finding contact by name:', error);
    return null;
  }
}

module.exports = {
  parseGroupCreationPrompt,
  resolveParticipants,
  findContactByName,
  similarityScore,
  levenshteinDistance
};

