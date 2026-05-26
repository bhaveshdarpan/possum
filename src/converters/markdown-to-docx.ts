import { convertMarkdownToBuffer, type Options } from "@mohtasham/md-to-docx";

// Font sizes are half-points (22 = 11pt). Spacing values are twips (240 = 12pt).
const docxOptions: Options = {
  style: {
    fontFamily: "Calibri",
    paragraphSize: 22,
    paragraphAlignment: "LEFT",
    lineSpacing: 1.15,
    paragraphSpacing: 160,
    headingSpacing: 240,
    titleSize: 44,
    heading1Size: 44,
    heading2Size: 32,
    heading3Size: 26,
    heading4Size: 22,
    heading5Size: 22,
    heading6Size: 22,
    listItemSize: 22,
    blockquoteSize: 22,
    codeBlockSize: 20,
    inlineCodeSize: 20,
    inlineCodeColor: "24292f",
    inlineCodeBackground: "f6f8fa",
    tableLayout: "autofit",
  },
  codeHighlighting: {
    enabled: true,
    showLanguageLabel: true,
  },
};

export async function markdownToDocx(markdown: string): Promise<Buffer> {
  return await convertMarkdownToBuffer(markdown, docxOptions);
}
