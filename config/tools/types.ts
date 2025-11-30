export interface ToolParameter {
    type: string;
    required: boolean;
    description: string;
}

export interface Tool {
    name: string;
    category: string;
    description: string;
    usage: string[];
    parameters: Record<string, ToolParameter>;
    critical?: string;
    historyContext?: {
        ignore: boolean; // If true, ignore conversation history when using this tool
        reason: string; // Explanation of when/why to ignore or use history
    };
}
