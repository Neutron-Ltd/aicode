/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./webview/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        mirror: {
          surface: "var(--vscode-sideBar-background)",
          fg: "var(--vscode-sideBar-foreground)",
          muted: "var(--vscode-descriptionForeground)",
          border:
            "var(--vscode-sideBar-border, var(--vscode-contrastBorder, rgba(128,128,128,0.35)))",
          accent: "var(--vscode-textLink-foreground)",
          input: "var(--vscode-input-background)",
          "input-fg": "var(--vscode-input-foreground)",
          focus: "var(--vscode-focusBorder)",
          "bubble-user": "var(--vscode-input-background)",
          "bubble-user-fg": "var(--vscode-input-foreground)",
          "bubble-ai": "var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.12))",
          "bubble-ai-fg": "var(--vscode-sideBar-foreground)",
          "code-bg":
            "var(--vscode-textCodeBlock-background, var(--vscode-editor-background))",
          "code-fg":
            "var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground))",
        },
      },
      fontFamily: {
        sans: ["var(--vscode-font-family)", "system-ui", "sans-serif"],
      },
      fontSize: {
        ui: "var(--vscode-font-size)",
      },
      boxShadow: {
        mirror: "0 1px 2px rgba(0, 0, 0, 0.06)",
      },
      typography: {
        mirror: {
          css: {
            maxWidth: "none",
            color: "var(--vscode-sideBar-foreground)",
            lineHeight: "1.55",
            a: {
              color: "var(--vscode-textLink-foreground)",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            },
            strong: { color: "var(--vscode-sideBar-foreground)" },
            "ul > li::marker": { color: "var(--vscode-descriptionForeground)" },
            "ol > li::marker": { color: "var(--vscode-descriptionForeground)" },
            blockquote: {
              color: "var(--vscode-descriptionForeground)",
              borderLeftColor:
                "var(--vscode-sideBar-border, var(--vscode-contrastBorder))",
            },
            code: {
              color: "var(--vscode-textPreformat-foreground)",
              backgroundColor:
                "var(--vscode-textCodeBlock-background, var(--vscode-editor-background))",
            },
            "code::before": { content: "none" },
            "code::after": { content: "none" },
            h1: { color: "var(--vscode-sideBar-foreground)" },
            h2: { color: "var(--vscode-sideBar-foreground)" },
            h3: { color: "var(--vscode-sideBar-foreground)" },
            h4: { color: "var(--vscode-sideBar-foreground)" },
          },
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
