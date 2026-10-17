import { createHash } from "node:crypto";
import fs from "node:fs";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";

/**
 * Reads a saved presentation without changing it, to check what a provider cannot
 * report about itself.
 *
 * Section audio follows the ownership rule every provider keeps: a sound shape named
 * `ppt_audio_` followed by a positive ordinal without leading zeros. Every other shape,
 * including media whose name only resembles that, is not section audio.
 */
const SECTION_AUDIO_NAME = /^ppt_audio_[1-9]\d*$/;

const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p14: "http://schemas.microsoft.com/office/powerpoint/2010/main",
  rels: "http://schemas.openxmlformats.org/package/2006/relationships",
};

const REL_TYPE = {
  officeDocument:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
};

const SOUND_FILES = new Set(["audioFile", "wavAudioFile", "audioCd"]);
const MEDIA_FILES = new Set([...SOUND_FILES, "videoFile", "quickTimeFile"]);

export type InspectedShape = {
  id: string;
  name: string;
  /** The shape's element, such as `sp`, `pic` or `graphicFrame`. */
  kind: string;
  /** `x,y,cx,cy` of its frame, when it has one. */
  frame?: string;
  text?: string;
  /** Digest of the media it plays, when it is media. */
  media?: string;
};

export type InspectedSlide = {
  slideNumber: number;
  notes: string;
  sectionAudio: InspectedShape[];
  otherMedia: InspectedShape[];
  /** Every shape that is not section audio, other media included. */
  otherShapes: InspectedShape[];
};

export type InspectedPresentation = {
  slides: InspectedSlide[];
};

export const mediaDigest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

type Relationship = { type: string; target: string };

class Package {
  private readonly parts = new Map<string, Uint8Array>();

  constructor(bytes: Uint8Array) {
    for (const [name, content] of Object.entries(unzipSync(bytes))) {
      this.parts.set(name.replaceAll("\\", "/").replace(/^\/+/, ""), content);
    }
  }

  bytes(partName: string): Uint8Array {
    const content = this.parts.get(partName);
    if (!content) {
      throw new Error(`The presentation has no part ${partName}.`);
    }
    return content;
  }

  xml(partName: string): Element {
    const document = new DOMParser().parseFromString(strFromU8(this.bytes(partName)), "text/xml");
    if (!document.documentElement) {
      throw new Error(`${partName} is not XML.`);
    }
    return document.documentElement;
  }

  /** Relationships of a part, or of the package for `""`, with targets resolved to part names. */
  relationships(partName: string): Map<string, Relationship> {
    const slash = partName.lastIndexOf("/");
    const dir = partName.slice(0, slash + 1);
    const relsName = `${dir}_rels/${partName.slice(slash + 1)}.rels`;
    const rels = new Map<string, Relationship>();
    if (!this.parts.has(relsName)) {
      return rels;
    }
    for (const rel of elements(this.xml(relsName), NS.rels, "Relationship")) {
      if (rel.getAttribute("TargetMode") === "External") {
        continue;
      }
      rels.set(rel.getAttribute("Id") ?? "", {
        type: rel.getAttribute("Type") ?? "",
        target: resolvePartName(dir, rel.getAttribute("Target") ?? ""),
      });
    }
    return rels;
  }
}

/** Archive names always use `/`, whatever the host's path separator. */
function resolvePartName(dir: string, target: string): string {
  const segments = target.startsWith("/") ? [] : dir.split("/").filter(Boolean);
  for (const segment of target.replaceAll("\\", "/").split("/")) {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== "" && segment !== ".") {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

function elements(parent: Element, ns: string, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(ns, localName));
}

function children(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === node.ELEMENT_NODE,
  );
}

function paragraphText(paragraph: Element): string {
  let text = "";
  for (const run of children(paragraph)) {
    if (run.localName === "br") {
      text += "\n";
    } else if (run.localName === "r" || run.localName === "fld") {
      text += elements(run, NS.a, "t")
        .map((t) => t.textContent ?? "")
        .join("");
    }
  }
  return text;
}

function bodyText(body: Element | undefined): string | undefined {
  return body && elements(body, NS.a, "p").map(paragraphText).join("\n");
}

function readNotes(pkg: Package, slidePart: string): string {
  const notesRel = [...pkg.relationships(slidePart).values()].find(
    ({ type }) => type === REL_TYPE.notesSlide,
  );
  if (!notesRel) {
    return "";
  }
  const notesShape = elements(pkg.xml(notesRel.target), NS.p, "sp").find((shape) =>
    elements(shape, NS.p, "ph").some((ph) => ph.getAttribute("type") === "body"),
  );
  return bodyText(notesShape && elements(notesShape, NS.p, "txBody")[0]) ?? "";
}

function inspectShape(
  pkg: Package,
  rels: Map<string, Relationship>,
  shape: Element,
): { shape: InspectedShape; mediaFile?: string } {
  const cNvPr = elements(shape, NS.p, "cNvPr")[0];
  const xfrm = elements(shape, NS.a, "xfrm")[0];
  const off = xfrm && elements(xfrm, NS.a, "off")[0];
  const ext = xfrm && elements(xfrm, NS.a, "ext")[0];
  const nvPr = elements(shape, NS.p, "nvPr")[0];
  const mediaFile = nvPr && children(nvPr).find((child) => MEDIA_FILES.has(child.localName ?? ""));
  const text = bodyText(children(shape).find((child) => child.localName === "txBody"));

  const inspected: InspectedShape = {
    id: cNvPr?.getAttribute("id") ?? "",
    name: cNvPr?.getAttribute("name") ?? "",
    kind: shape.localName ?? "",
  };
  if (off && ext) {
    inspected.frame = ["x", "y"]
      .map((axis) => off.getAttribute(axis))
      .concat(["cx", "cy"].map((axis) => ext.getAttribute(axis)))
      .join(",");
  }
  if (text !== undefined) {
    inspected.text = text;
  }
  if (mediaFile) {
    const embedded = nvPr && elements(nvPr, NS.p14, "media")[0]?.getAttributeNS(NS.r, "embed");
    const relId = embedded || mediaFile.getAttributeNS(NS.r, "link") || "";
    const part = rels.get(relId)?.target;
    inspected.media = part ? mediaDigest(pkg.bytes(part)) : "";
  }
  return { shape: inspected, mediaFile: mediaFile?.localName ?? undefined };
}

function inspectSlide(pkg: Package, slidePart: string, slideNumber: number): InspectedSlide {
  const rels = pkg.relationships(slidePart);
  const spTree = elements(pkg.xml(slidePart), NS.p, "spTree")[0];
  const slide: InspectedSlide = {
    slideNumber,
    notes: readNotes(pkg, slidePart),
    sectionAudio: [],
    otherMedia: [],
    otherShapes: [],
  };

  for (const element of spTree ? children(spTree) : []) {
    if (["nvGrpSpPr", "grpSpPr", "extLst"].includes(element.localName ?? "")) {
      continue;
    }
    const { shape, mediaFile } = inspectShape(pkg, rels, element);
    if (
      mediaFile !== undefined &&
      SOUND_FILES.has(mediaFile) &&
      SECTION_AUDIO_NAME.test(shape.name)
    ) {
      slide.sectionAudio.push(shape);
      continue;
    }
    if (mediaFile !== undefined) {
      slide.otherMedia.push(shape);
    }
    slide.otherShapes.push(shape);
  }
  return slide;
}

export function inspectPresentation(source: string | Uint8Array): InspectedPresentation {
  const pkg = new Package(typeof source === "string" ? fs.readFileSync(source) : source);
  const presentationRel = [...pkg.relationships("").values()].find(
    ({ type }) => type === REL_TYPE.officeDocument,
  );
  if (!presentationRel) {
    throw new Error("The package has no presentation part.");
  }
  const presentationRels = pkg.relationships(presentationRel.target);
  const slides = elements(pkg.xml(presentationRel.target), NS.p, "sldId").map((sldId, i) => {
    const slidePart = presentationRels.get(sldId.getAttributeNS(NS.r, "id") ?? "")?.target;
    if (!slidePart) {
      throw new Error(`Slide ${i + 1} has no slide part.`);
    }
    return inspectSlide(pkg, slidePart, i + 1);
  });
  return { slides };
}
