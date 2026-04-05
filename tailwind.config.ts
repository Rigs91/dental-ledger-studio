import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0f172a",
          800: "#1e293b",
          700: "#334155",
          600: "#475569",
          100: "#f1f5f9"
        },
        mint: {
          500: "#2dd4bf",
          600: "#0d9488"
        },
        sun: {
          500: "#f59e0b"
        },
        blush: {
          500: "#f472b6"
        }
      },
      boxShadow: {
        card: "0 18px 40px -24px rgba(15, 23, 42, 0.35)",
        lift: "0 14px 30px -22px rgba(15, 23, 42, 0.45)"
      }
    }
  },
  plugins: []
};

export default config;
