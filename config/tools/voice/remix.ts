// Tool Config Definition
export const remix_voice = {
    name: 'remix_voice',
    description: 'Transform the style, emotion, or tone of a quoted voice note (e.g. make it happy, sad, ghost-like). This is NOT for mixing multiple files. REQUIRES quoting a voice note. The tool will: 1. Clone the voice from the audio 2. Transcribe the content 3. Generate a new version with the requested style.',
    usage: [
        'Quote a voice note and say: "Remix this to sound happy"',
        'Quote a voice note and say: "Make this sound like a whispering ghost"',
        'With quoted audio: "Change the tone to be more professional"'
    ],
    parameters: {
        type: 'object',
        properties: {
            style_description: {
                type: 'string',
                description: 'Description of the desired voice style/emotion (e.g. "excited", "whispering", "British accent")'
            }
        },
        required: ['style_description']
    },
    category: 'creation', // or audio?
    requiresHistory: false, // The prompt is self-contained usually
    isDependent: true // Dependent on quoted message
};
