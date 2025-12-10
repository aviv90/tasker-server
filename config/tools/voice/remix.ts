// Tool Config Definition
export const remix_voice = {
    name: 'edit_voice_style',
    description: 'Edit the style, emotion, or tone of a quoted voice note. Use this when user says "Edit", "Change", "Modify" on a voice note. The tool will: 1. Clone the voice 2. Transcribe 3. Generate new audio with requested style.',
    usage: [
        'Quote a voice note and say: "Edit this to sound happy"',
        'Quote a voice note and say: "Change to a whispering ghost voice"',
        'Quote a voice note: "Make him sound angry"'
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
    category: 'editing',
    requiresHistory: false,
    isDependent: true
};
