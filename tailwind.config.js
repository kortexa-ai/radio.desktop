/** @type {import('tailwindcss').Config} */
export default {
    content: ["./src/mainview/**/*.{html,js,ts,jsx,tsx}"],
    theme: {
        extend: {
            colors: {
                surface: {
                    900: "#0d0d1a",
                    800: "#141428",
                    700: "#1a1a36",
                    600: "#222244",
                },
                accent: {
                    purple: "#8b5cf6",
                    cyan: "#06b6d4",
                    magenta: "#d946ef",
                },
            },
        },
    },
    plugins: [],
};
