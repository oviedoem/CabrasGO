/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cg: {
          bg: "#F8FAFC",
          surface: "#FFFFFF",
          surfaceAlt: "#F1F5F9",
          primary: "#0F172A",
          accent: "#10B981",
          earnings: "#059669",
          danger: "#EF4444",
          warning: "#F59E0B",
          darkBg: "#090D16",
          darkSurface: "#1E293B",
          darkSurfaceAlt: "#131B2E",
          darkPrimary: "#F8FAFC",
          earningsBright: "#34D399",
        },
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
