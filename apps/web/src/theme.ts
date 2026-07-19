import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Neutral ink scale — near-black primary actions, restrained product feel.
const ink: MantineColorsTuple = [
  "#f5f5f5",
  "#e5e5e5",
  "#d4d4d4",
  "#a3a3a3",
  "#737373",
  "#525252",
  "#404040",
  "#262626",
  "#171717",
  "#0a0a0a",
];

export const theme = createTheme({
  primaryColor: "ink",
  primaryShade: { light: 8, dark: 9 },
  colors: { ink },
  fontFamily:
    '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  fontFamilyMonospace:
    '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
  defaultRadius: "md",
  black: "#171717",
  radius: { md: "10px", lg: "14px" },
  cursorType: "pointer",
});
