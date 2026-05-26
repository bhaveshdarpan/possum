import JSZip from "jszip";

// 6.5" content area on letter page with 1080 twip left/right margins.
const TABLE_WIDTH_DXA = 9360;

const BORDER_XML =
  "<w:tblBorders>" +
  '<w:top w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:left w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:bottom w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:right w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:insideH w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  '<w:insideV w:val="single" w:sz="6" w:color="D0D7DE"/>' +
  "</w:tblBorders>";

export async function fixTables(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return buf;

  const xml = await docFile.async("string");
  if (!xml.includes("<w:tbl>")) return buf;

  const updated = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (block) =>
    normalizeTable(block),
  );

  zip.file("word/document.xml", updated);
  return await zip.generateAsync({ type: "nodebuffer" });
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
