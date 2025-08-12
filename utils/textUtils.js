/**
 * Text utilities for music and audio generation
 */

function detectLanguage(text) {
    // Simple Hebrew detection
    const hebrewRegex = /[\u0590-\u05FF]/;
    return hebrewRegex.test(text) ? 'hebrew' : 'english';
}

function translateHebrewToEnglish(hebrewText) {
    // Simple Hebrew to English music terms mapping
    const translations = {
        'שמח': 'happy',
        'עצוב': 'sad', 
        'רומנטי': 'romantic',
        'מהיר': 'fast',
        'איטי': 'slow',
        'רגוע': 'calm',
        'אנרגטי': 'energetic',
        'אהבה': 'love',
        'ידידות': 'friendship',
        'משפחה': 'family',
        'יום הולדת': 'birthday',
        'חתונה': 'wedding',
        'חופש': 'vacation',
        'זכרונות': 'memories'
    };

    let translated = hebrewText;
    Object.entries(translations).forEach(([hebrew, english]) => {
        translated = translated.replace(new RegExp(hebrew, 'g'), english);
    });

    return translated;
}

function enhancePromptForMusic(prompt) {
    const language = detectLanguage(prompt);
    
    if (language === 'hebrew') {
        const translated = translateHebrewToEnglish(prompt);
        return `${translated} (original: ${prompt})`;
    }
    
    return prompt;
}

function generateRandomMusicStyle() {
    const styles = [
        'acoustic folk',
        'pop ballad', 
        'indie rock',
        'contemporary',
        'soft rock',
        'acoustic pop',
        'melodic indie',
        'singer-songwriter'
    ];
    
    return styles[Math.floor(Math.random() * styles.length)];
}

module.exports = {
    detectLanguage,
    translateHebrewToEnglish,
    enhancePromptForMusic,
    generateRandomMusicStyle
};