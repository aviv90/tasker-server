// Disable Babel for Jest - we use ts-jest instead
module.exports = function (api) {
    // Only disable Babel when running in Jest
    if (api.env('test')) {
        return {
            // Return empty config to disable Babel
            presets: [],
            plugins: []
        };
    }

    // For other environments, return empty config (we don't use Babel)
    return {};
};
