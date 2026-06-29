import JSZip from "jszip";

// 6.5" content area on letter page with 1080 twip left/right margins.
const TABLE_WIDTH_DXA = 9360;

// 914400 EMU per inch ÷ 1440 twips per inch. Image extents (wp:extent / a:ext)
// are in EMU; page size and margins (pgSz / pgMar) are in twips.
const EMU_PER_TWIP = 635;

const BORDER_XML =
  "<w:tblBorders>" +
  '<w:top w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:left w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:bottom w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:right w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:insideH w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:insideV w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  "</w:tblBorders>";

export async function postProcessDocx(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return buf;

  let xml = await docFile.async("string");
  xml = collapseSoftBreaks(xml);
  xml = fitImagesToContentBox(xml);

  if (xml.includes("<w:tbl>")) {
    xml = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (block) =>
      normalizeTable(block),
    );
  }

  zip.file("word/document.xml", xml);
  return await zip.generateAsync({ type: "nodebuffer" });
}

// The md-to-docx library keeps a hard-wrapped source line's newline as a literal
// "\n" inside the run text (e.g. "...establishes\ndocs/architecture..."). Google
// Docs drops that bare newline on import, gluing the last word of one line to the
// first word of the next ("establishesdocs"). A CommonMark soft break means a
// single space, so collapse each intra-text newline to one space.
//
// Runs that are *only* whitespace are intentional line breaks — code-block line
// separators and explicit hard breaks (trailing two spaces / backslash) are both
// emitted as their own <w:t>\n</w:t> run — so those are left untouched.
function collapseSoftBreaks(xml: string): string {
  return xml.replace(
    /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g,
    (_full, open: string, inner: string, close: string) => {
      if (!inner.includes("\n") || inner.trim() === "") {
        return open + inner + close;
      }
      const collapsed = inner.replace(/[ \t]*\r?\n[ \t]*/g, " ");
      return open + collapsed + close;
    },
  );
}

// md-to-docx hard-caps embedded image width at 400px (~4.17"), so mermaid
// diagrams render far narrower than the page and may also run off the bottom
// edge when tall. Rescale every inline drawing to best-fit the live content
// box — enlarging the small ones up to the margins, shrinking any that would
// overflow — while preserving aspect ratio so nothing spills horizontally or
// vertically.
function fitImagesToContentBox(xml: string): string {
  if (!xml.includes("<w:drawing")) return xml;

  const box = readContentBoxEmu(xml);
  if (!box) return xml;

  return xml.replace(/<w:drawing\b[^>]*>[\s\S]*?<\/w:drawing>/g, (block) =>
    scaleDrawing(block, box),
  );
}

// Derives the usable content area (page size minus margins) from the section
// properties, in EMU. Returns null if either element is missing so callers
// leave the document untouched rather than guess.
function readContentBoxEmu(
  xml: string,
): { width: number; height: number } | null {
  const pgSz = xml.match(/<w:pgSz\b[^>]*\/>/);
  const pgMar = xml.match(/<w:pgMar\b[^>]*\/>/);
  if (!pgSz || !pgMar) return null;

  const attr = (tag: string, name: string): number | null => {
    const m = tag.match(new RegExp(`\\bw:${name}="(\\d+)"`));
    return m ? Number(m[1]) : null;
  };

  const w = attr(pgSz[0], "w");
  const h = attr(pgSz[0], "h");
  const top = attr(pgMar[0], "top");
  const bottom = attr(pgMar[0], "bottom");
  const left = attr(pgMar[0], "left");
  const right = attr(pgMar[0], "right");
  if (
    w == null ||
    h == null ||
    top == null ||
    bottom == null ||
    left == null ||
    right == null
  ) {
    return null;
  }

  const widthTwips = w - left - right;
  const heightTwips = h - top - bottom;
  if (widthTwips <= 0 || heightTwips <= 0) return null;

  return {
    width: widthTwips * EMU_PER_TWIP,
    height: heightTwips * EMU_PER_TWIP,
  };
}

// Rescales a single drawing's frame (wp:extent) and picture transform (a:ext)
// by the same factor. Both carry the original cx/cy emitted by the renderer.
function scaleDrawing(
  block: string,
  box: { width: number; height: number },
): string {
  const extent = block.match(/<wp:extent\b[^>]*\/>/);
  if (!extent) return block;
  const cx = Number(extent[0].match(/\bcx="(\d+)"/)?.[1]);
  const cy = Number(extent[0].match(/\bcy="(\d+)"/)?.[1]);
  if (!cx || !cy) return block;

  const scale = Math.min(box.width / cx, box.height / cy);
  if (!Number.isFinite(scale) || scale <= 0) return block;

  const newCx = Math.max(1, Math.round(cx * scale));
  const newCy = Math.max(1, Math.round(cy * scale));
  if (newCx === cx && newCy === cy) return block;

  const setSize = (tag: string): string =>
    tag
      .replace(/\bcx="\d+"/, `cx="${newCx}"`)
      .replace(/\bcy="\d+"/, `cy="${newCy}"`);

  return block
    .replace(/<wp:extent\b[^>]*\/>/, setSize)
    .replace(/<a:ext\b[^>]*\/>/, setSize);
}

function normalizeTable(tableXml: string): string {
  const colCount = countColumns(tableXml);
  if (colCount === 0) return tableXml;
  const colWidth = Math.floor(TABLE_WIDTH_DXA / colCount);

  let out = tableXml;

  const newGrid =
    `<w:tblGrid>${`<w:gridCol w:w="${colWidth}"/>`.repeat(colCount)}</w:tblGrid>`;
  if (/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/.test(out)) {
    out = out.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, newGrid);
  } else if (/<w:tblGrid\/>/.test(out)) {
    out = out.replace(/<w:tblGrid\/>/, newGrid);
  } else {
    out = out.replace(/(<w:tr[\s\S]*)/, `${newGrid}$1`);
  }

  out = out.replace(/<w:tblLayout[^/]*\/>/g, '<w:tblLayout w:type="fixed"/>');
  out = out.replace(
    /<w:tblW[^/]*\/>/g,
    `<w:tblW w:w="${TABLE_WIDTH_DXA}" w:type="dxa"/>`,
  );

  if (!out.includes("<w:tblBorders>")) {
    out = out.replace(
      /<w:tblPr>([\s\S]*?)<\/w:tblPr>/,
      (_, inner: string) => `<w:tblPr>${inner}${BORDER_XML}</w:tblPr>`,
    );
  }

  return out;
}

function countColumns(tableXml: string): number {
  const gridMatch = tableXml.match(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/);
  if (gridMatch && gridMatch[1]) {
    const count = (gridMatch[1].match(/<w:gridCol/g) ?? []).length;
    if (count > 0) return count;
  }
  const firstRowMatch = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/);
  if (!firstRowMatch) return 0;
  return (firstRowMatch[0].match(/<w:tc>/g) ?? []).length;
}
