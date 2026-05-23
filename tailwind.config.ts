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
      },
      keyframes: {
        "toast-in": {
          from: { opacity: "0", transform: "translateX(-50%) translateY(6px)" },
          to: { opacity: "1", transform: "translateX(-50%) translateY(0)" },
        },
        "pulse-red": {
          "0%": { boxShadow: "0 0 0 0 rgba(220,38,38,0.35)" },
          "70%": { boxShadow: "0 0 0 6px rgba(220,38,38,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(220,38,38,0)" },
        },
      },
      animation: {
        "toast-in": "toast-in 200ms cubic-bezier(0.2, 0, 0, 1)",
        "pulse-red": "pulse-red 0.4s ease",
      }
    }
  },
  plugins: []
} satisfies Config;
