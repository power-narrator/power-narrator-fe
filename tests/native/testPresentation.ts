import { strToU8, zipSync } from "fflate";

/** Just enough of a presentation for the inspector's tests; not a general writer. */
export type TestShape =
  | { kind: "shape"; id: number; name: string; text?: string; offset?: [number, number] }
  | { kind: "audio" | "video"; id: number; name: string; media: Uint8Array };

export type TestSlide = {
  notes?: string;
  shapes?: TestShape[];
};

export type TestPresentationOptions = {
  /** Writes archive entry names with this separator, as some Windows tools do. */
  separator?: "/" | "\\";
};

const NS = [
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
  'xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"',
].join(" ");

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const relationships = (rels: Array<{ id: string; type: string; target: string }>) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map(({ id, type, target }) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;

const paragraphs = (text: string) =>
  text
    .split("\n")
    .map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`)
    .join("");

function shapeXml(shape: TestShape, mediaRelId: string): string {
  if (shape.kind === "shape") {
    const [x, y] = shape.offset ?? [0, 0];
    return `<p:sp><p:nvSpPr><p:cNvPr id="${shape.id}" name="${escapeXml(shape.name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody>${paragraphs(shape.text ?? "")}</p:txBody></p:sp>`;
  }
  const file = shape.kind === "audio" ? "audioFile" : "videoFile";
  return `<p:pic><p:nvPicPr><p:cNvPr id="${shape.id}" name="${escapeXml(shape.name)}"/><p:cNvPicPr/><p:nvPr><a:${file} r:link="${mediaRelId}"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media r:embed="${mediaRelId}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill/><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm></p:spPr></p:pic>`;
}

export function buildTestPresentation(
  slides: TestSlide[],
  { separator = "/" }: TestPresentationOptions = {},
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const put = (name: string, content: string | Uint8Array) => {
    entries[name.replaceAll("/", separator)] =
      typeof content === "string" ? strToU8(content) : content;
  };
  let mediaCount = 0;

  put(
    "_rels/.rels",
    relationships([{ id: "rId1", type: `${REL}/officeDocument`, target: "ppt/presentation.xml" }]),
  );
  put(
    "ppt/presentation.xml",
    `<p:presentation ${NS}><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdSlide${i + 1}"/>`)
      .join("")}</p:sldIdLst></p:presentation>`,
  );
  put(
    "ppt/_rels/presentation.xml.rels",
    relationships(
      slides.map((_, i) => ({
        id: `rIdSlide${i + 1}`,
        type: `${REL}/slide`,
        target: `slides/slide${i + 1}.xml`,
      })),
    ),
  );

  slides.forEach(({ notes, shapes = [] }, i) => {
    const slideNumber = i + 1;
    const rels: Array<{ id: string; type: string; target: string }> = [];
    const shapeXmls = shapes.map((shape, s) => {
      if (shape.kind === "shape") {
        return shapeXml(shape, "");
      }
      mediaCount += 1;
      const target = `../media/media${mediaCount}.${shape.kind === "audio" ? "mp3" : "mp4"}`;
      put(`ppt/media/media${mediaCount}.${shape.kind === "audio" ? "mp3" : "mp4"}`, shape.media);
      const id = `rIdMedia${s + 1}`;
      rels.push({ id, type: `${REL}/${shape.kind}`, target });
      return shapeXml(shape, id);
    });

    if (notes !== undefined) {
      rels.push({
        id: "rIdNotes",
        type: `${REL}/notesSlide`,
        target: `../notesSlides/notesSlide${slideNumber}.xml`,
      });
      put(
        `ppt/notesSlides/notesSlide${slideNumber}.xml`,
        `<p:notes ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody>${paragraphs(notes)}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
      );
    }

    put(
      `ppt/slides/slide${slideNumber}.xml`,
      `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapeXmls.join("")}</p:spTree></p:cSld></p:sld>`,
    );
    put(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, relationships(rels));
  });

  return zipSync(entries);
}
