const config = {
    app: {
        name: "Radio Desktop",
        identifier: "ai.kortexa.radiodesktop",
        version: "1.0.0",
    },
    runtime: {
        exitOnLastWindowClosed: false,
    },
    build: {
        copy: {
            "dist/index.html": "views/mainview/index.html",
            "dist/assets": "views/mainview/assets",
        },
        watchIgnore: ["dist/**"],
        mac: {
            bundleCEF: false,
            codesign: true,
            notarize: true,
        },
        linux: { bundleCEF: false },
        win: { bundleCEF: false },
    },
};

export default config;
