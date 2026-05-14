import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f8fafc",
          100: "#eef2f7",
          200: "#dce3ea",
          400: "#8a97a8",
          500: "#657487",
          700: "#344255",
          800: "#1f2937",
          900: "#111827",
          950: "#0b1120"
        },
        brand: {
          50: "#eefdf7",
          100: "#d7f8eb",
          500: "#0f9f78",
          600: "#087c62",
          700: "#075f4d"
        },
        note: {
          50: "#fff7ed",
          100: "#ffedd5",
          500: "#f97316",
          700: "#c2410c"
        }
      },
      boxShadow: {
        panel: "0 18px 48px rgba(17, 24, 39, 0.12), 0 2px 8px rgba(17, 24, 39, 0.08)",
        soft: "0 8px 24px rgba(17, 24, 39, 0.08)"
      }
    }
  },
  plugins: []
} satisfies Config;
