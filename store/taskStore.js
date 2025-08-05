const store = {};

function set(taskId, data) {
    store[taskId] = data;
}

function get(taskId) {
    return store[taskId];
}

module.exports = { set, get };
