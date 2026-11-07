// Word and PDF renderings of the annual fabric report (UI-HANDOFF §10 Exports):
// A4, body 12 pt serif, headings 14 pt, a footer on every page, the year's
// logbook entries as an appendix, and a signature block.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatLongDate, type FabricReportText } from "../../shared/fabric-report";
import { formatPounds } from "../../shared/money";

const FONT = "Georgia";
const pt = (n: number) => n * 2; // docx sizes are half-points

function appendixRows(text: FabricReportText) {
  return text.appendix.map((e) => [formatLongDate(e.entryDate), e.work, e.who ?? "", formatPounds(e.costPence), e.permissionRef ?? ""]);
}
const APPENDIX_HEAD = ["Date", "Work", "Who", "Cost", "Faculty or List B"];

// ---------- Word ----------
export async function renderDocx(text: FabricReportText): Promise<Uint8Array> {
  const body = (t: string, opts: { bold?: boolean; size?: number; italics?: boolean } = {}) =>
    new Paragraph({ spacing: { after: 160, line: 300 }, children: [new TextRun({ text: t, font: FONT, size: pt(opts.size ?? 12), bold: opts.bold, italics: opts.italics })] });
  const heading = (t: string) =>
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, font: FONT, size: pt(14), bold: true, color: "1C1D1F" })] });

  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 120 }, children: [new TextRun({ text: text.title, font: FONT, size: pt(20), bold: true })] }),
    body(text.subtitle, { size: 12 }),
    body(text.presented, { size: 12, italics: true }),
  ];
  for (const s of text.sections) {
    children.push(heading(`${s.n}. ${s.heading}`));
    for (const p of s.paragraphs) children.push(body(p));
  }

  // Signature block
  children.push(new Paragraph({ spacing: { before: 480 }, children: [] }));
  for (const label of ["Churchwarden", "Churchwarden"]) {
    children.push(body("Signed ............................................................    Date ....................."));
    children.push(body(label, { italics: true }));
  }

  // Appendix: the year's logbook entries
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(heading("Appendix: logbook entries for the year"));
  if (text.appendix.length === 0) children.push(body("No logbook entries were made during the year."));
  else {
    const cell = (t: string, bold = false) =>
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, font: FONT, size: pt(10), bold })] })], margins: { top: 60, bottom: 60, left: 80, right: 80 } });
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "DDD9D0" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDD9D0" },
          left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "EEECE6" },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        },
        rows: [new TableRow({ tableHeader: true, children: APPENDIX_HEAD.map((h) => cell(h, true)) }), ...appendixRows(text).map((r) => new TableRow({ children: r.map((c) => cell(c)) }))],
      }),
    );
  }

  const doc = new Document({
    creator: "Fabric",
    title: text.title,
    styles: { default: { document: { run: { font: FONT, size: pt(12) } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: text.footer, font: FONT, size: pt(9), color: "5A5F66" })] })] }),
        },
        children,
      },
    ],
  });
  const buf = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buf);
}

// ---------- PDF ----------
// The standard PDF fonts only cover Western European characters; anything else
// is replaced rather than failing the export.
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function safe(s: string) {
  return [...s]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (ch === "\t") return " ";
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) return ch;
      return "?";
    })
    .join("");
}

function wrap(textIn: string, font: PDFFont, size: number, width: number): string[] {
  const words = safe(textIn).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      // A single word wider than the line is broken by characters.
      let word = w;
      while (font.widthOfTextAtSize(word, size) > width) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderPdf(text: FabricReportText): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(text.title);
  pdf.setCreator("Fabric");
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const W = 595.28;
  const H = 841.89;
  const M = 56.7; // 2 cm
  const width = W - 2 * M;
  const ink = rgb(0.11, 0.11, 0.12);
  const muted = rgb(0.35, 0.37, 0.4);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const ensure = (h: number) => {
    if (y - h < M + 24) newPage();
  };
  const para = (t: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; after?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 12;
    const lead = size * 1.35;
    for (const l of wrap(t, font, size, width)) {
      ensure(lead);
      page.drawText(l, { x: M, y: y - size, size, font, color: opts.color ?? ink });
      y -= lead;
    }
    y -= opts.after ?? 6;
  };

  para(text.title, { font: bold, size: 18, after: 4 });
  para(text.subtitle, { size: 12, color: muted, after: 2 });
  para(text.presented, { font: italic, size: 12, color: muted, after: 14 });
  for (const s of text.sections) {
    ensure(40);
    para(`${s.n}. ${s.heading}`, { font: bold, size: 14, after: 2 });
    for (const p of s.paragraphs) para(p, { after: 8 });
  }
  y -= 24;
  for (const label of ["Churchwarden", "Churchwarden"]) {
    ensure(48);
    para("Signed .....................................................   Date ....................", { after: 0 });
    para(label, { font: italic, color: muted, after: 14 });
  }

  // Appendix on a new page
  newPage();
  para("Appendix: logbook entries for the year", { font: bold, size: 14, after: 8 });
  if (text.appendix.length === 0) para("No logbook entries were made during the year.");
  else {
    const cols = [78, 190, 105, 55, width - 78 - 190 - 105 - 55];
    const row = (cells: string[], font: PDFFont) => {
      const wrapped = cells.map((c, i) => wrap(c, font, 10, cols[i]! - 6));
      const h = Math.max(...wrapped.map((w) => w.length)) * 13 + 6;
      ensure(h);
      let x = M;
      wrapped.forEach((lines, i) => {
        lines.forEach((l, j) => page.drawText(l, { x, y: y - 10 - j * 13, size: 10, font, color: ink }));
        x += cols[i]!;
      });
      y -= h;
      page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + width, y: y + 2 }, thickness: 0.5, color: rgb(0.87, 0.85, 0.82) });
    };
    row(APPENDIX_HEAD, bold);
    for (const r of appendixRows(text)) row(r, regular);
  }

  // Footer and page numbers on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const f = safe(`${text.footer} · Page ${i + 1} of ${pages.length}`);
    const fw = regular.widthOfTextAtSize(f, 9);
    p.drawText(f, { x: (W - fw) / 2, y: M / 2, size: 9, font: regular, color: muted });
  });
  return pdf.save();
}
