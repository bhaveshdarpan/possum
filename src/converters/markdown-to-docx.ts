import { convertMarkdownToBuffer, type Options } from "@mohtasham/md-to-docx";

// Font sizes are half-points (22 = 11pt). Spacing values are twips (240 = 12pt).
// Poppins is a Google Font; Google Docs supports it natively after Drive import.
const docxOptions: Options = {
  style: {
    fontFamily: "Poppins",
    paragraphSize: 22,
    paragraphAlignment: "LEFT",
    lineSpacing: 1.5,
    paragraphSpacing: 200,
    headingSpacing: 360,
    titleSize: 56,
    heading1Size: 56,
    heading2Size: 40,
    heading3Size: 30,
    heading4Size: 26,
    heading5Size: 22,
    heading6Size: 22,
    listItemSize: 22,
    blockquoteSize: 22,
    codeBlockSize: 20,
    inlineCodeSize: 20,
    inlineCodeColor: "1f2328",
    inlineCodeBackground: "f6f8fa",
    tableLayout: "autofit",
  },
  codeHighlighting: {
    enabled: true,
    showLanguageLabel: true,
    theme: {
      background: "f6f8fa",
      border: "d0d7de",
      default: "1f2328",
      languageLabel: "6e7781",
      comment: "6e7781",
      keyword: "cf222e",
      string: "0a3069",
      number: "0550ae",
      title: "8250df",
      built_in: "953800",
      literal: "0550ae",
      attr: "8250df",
      tag: "116329",
    },
  },
};

export async function markdownToDocx(markdown: string): Promise<Buffer> {
  return await convertMarkdownToBuffer(markdown, docxOptions);
}
