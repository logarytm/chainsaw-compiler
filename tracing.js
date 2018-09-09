exports.setup = (enabledTraces) => {
    global.tracing = {};
    global.tracing.enabledTraces = enabledTraces;
    global.tracing.traceHandlers = [(family, ...args) => {
        console.log(`trace(${family}):`, ...args);
    }];

    global.tracing.setTraceHandler = handler => {
        global.tracing.traceHandlers.unshift(handler);
    };

    global.tracing.restoreTraceHandler = () => {
        if (global.tracing.traceHandlers.length > 1) {
            global.tracing.traceHandlers.shift();
        }
    };

    global.trace = (family, ...args) => {
        if (enabledTraces.includes('all') || enabledTraces.includes(family)) {
            global.tracing.traceHandlers[0](family, ...args);
        }
    };
};
