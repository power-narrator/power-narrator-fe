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

const EFFECT_PRESETS: Record<string, string> = {
  "mediacall/1": "play",
  "mediacall/2": "pause",
  "mediacall/3": "stop",
  "entr/10": "fade",
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
  /** From 0 to 100000, when the media has stored playback settings. */
  volume?: number;
  muted?: boolean;
  fadeInMs?: number;
};

export type InspectedEffect = {
  /** A known preset's name, such as `play` or `fade`, otherwise `presetClass/presetID`. */
  type: string;
  /** The name of the shape it animates. */
  target: string;
  /** The name of the shape whose click starts it; absent in the main sequence. */
  trigger?: string;
};

export type InspectedSlide = {
  slideNumber: number;
  notes: string;
  sectionAudio: InspectedShape[];
  otherMedia: InspectedShape[];
  /** Every shape that is not section audio, other media included. */
  otherShapes: InspectedShape[];
  /** In sequence order: the main sequence and each click-triggered sequence, as stored. */
  effects: InspectedEffect[];
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
    const media = nvPr && elements(nvPr, NS.p14, "media")[0];
    const embedded = media?.getAttributeNS(NS.r, "embed");
    const relId = embedded || mediaFile.getAttributeNS(NS.r, "link") || "";
    const part = rels.get(relId)?.target;
    inspected.media = part ? mediaDigest(pkg.bytes(part)) : "";
    const fade = media && elements(media, NS.p14, "fade")[0];
    if (fade?.hasAttribute("in")) {
      inspected.fadeInMs = Number(fade.getAttribute("in"));
    }
  }
  return { shape: inspected, mediaFile: mediaFile?.localName ?? undefined };
}

function inspectEffects(slideXml: Element): InspectedEffect[] {
  const names = new Map(
    elements(slideXml, NS.p, "cNvPr").map((cNvPr) => [
      cNvPr.getAttribute("id") ?? "",
      cNvPr.getAttribute("name") ?? "",
    ]),
  );
  const shapeName = (target: Element | undefined) => {
    const id = target?.getAttribute("spid") ?? "";
    return names.get(id) ?? `#${id}`;
  };

  return elements(slideXml, NS.p, "seq").flatMap((seq) => {
    const seqNode = children(seq).find((child) => child.localName === "cTn");
    const clickCondition =
      seqNode?.getAttribute("nodeType") === "interactiveSeq"
        ? children(seqNode).find((child) => child.localName === "stCondLst")
        : undefined;
    const trigger = clickCondition && shapeName(elements(clickCondition, NS.p, "spTgt")[0]);

    return elements(seq, NS.p, "cTn")
      .filter((node) => node.hasAttribute("presetClass"))
      .map((node) => {
        const preset = `${node.getAttribute("presetClass")}/${node.getAttribute("presetID")}`;
        const effect: InspectedEffect = {
          type: EFFECT_PRESETS[preset] ?? preset,
          target: shapeName(elements(node, NS.p, "spTgt")[0]),
        };
        if (trigger !== undefined) {
          effect.trigger = trigger;
        }
        return effect;
      });
  });
}

/** Volume defaults to 50000 when stored without one, as the schema says. */
function mediaSettings(slideXml: Element): Map<string, Pick<InspectedShape, "volume" | "muted">> {
  return new Map(
    elements(slideXml, NS.p, "cMediaNode").map((node) => [
      elements(node, NS.p, "spTgt")[0]?.getAttribute("spid") ?? "",
      {
        volume: Number(node.getAttribute("vol") || 50000),
        muted: ["1", "true"].includes(node.getAttribute("mute") ?? ""),
      },
    ]),
  );
}

function inspectSlide(pkg: Package, slidePart: string, slideNumber: number): InspectedSlide {
  const rels = pkg.relationships(slidePart);
  const slideXml = pkg.xml(slidePart);
  const settings = mediaSettings(slideXml);
  const spTree = elements(slideXml, NS.p, "spTree")[0];
  const slide: InspectedSlide = {
    slideNumber,
    notes: readNotes(pkg, slidePart),
    sectionAudio: [],
    otherMedia: [],
    otherShapes: [],
    effects: inspectEffects(slideXml),
  };

  for (const element of spTree ? children(spTree) : []) {
    if (["nvGrpSpPr", "grpSpPr", "extLst"].includes(element.localName ?? "")) {
      continue;
    }
    const { shape, mediaFile } = inspectShape(pkg, rels, element);
    if (mediaFile !== undefined) {
      Object.assign(shape, settings.get(shape.id));
    }
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

/** Keys repeated items by occurrence, such as `play ppt_audio_1 #2`. */
function keyed<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const seen = new Map<string, number>();
  return new Map(
    items.map((item) => {
      const base = key(item);
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return [count === 1 ? base : `${base} #${count}`, item];
    }),
  );
}

function longestCommonSubsequence(a: readonly string[], b: readonly string[]): Set<string> {
  const lengths = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  const at = (i: number, j: number) => lengths[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const common = new Set<string>();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      common.add(a[i]!);
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return common;
}

/** An effect is moved when keeping the most effects in their stored order leaves it out. */
function movedEffects(expectedKeys: readonly string[], actualKeys: readonly string[]): string[] {
  const inBoth = (keys: readonly string[], other: readonly string[]) =>
    keys.filter((key) => other.includes(key));
  const inOrder = longestCommonSubsequence(
    inBoth(expectedKeys, actualKeys),
    inBoth(actualKeys, expectedKeys),
  );
  return inBoth(expectedKeys, actualKeys)
    .filter((key) => !inOrder.has(key))
    .map(
      (key) =>
        `effect ${key}: at position ${actualKeys.indexOf(key) + 1}, expected ${expectedKeys.indexOf(key) + 1}`,
    );
}

const startedBy = (trigger: string | undefined) =>
  trigger === undefined ? "in the main sequence" : `triggered by ${trigger}`;

function effectDifferences(
  expected: readonly InspectedEffect[],
  actual: readonly InspectedEffect[],
): string[] {
  const effectKey = ({ type, target }: InspectedEffect) => `${type} ${target}`;
  const expectedEffects = keyed(expected, effectKey);
  const actualEffects = keyed(actual, effectKey);
  return [
    ...[...expectedEffects.keys()]
      .filter((key) => !actualEffects.has(key))
      .map((key) => `effect ${key}: removed`),
    ...[...actualEffects.keys()]
      .filter((key) => !expectedEffects.has(key))
      .map((key) => `effect ${key}: added`),
    ...movedEffects([...expectedEffects.keys()], [...actualEffects.keys()]),
    ...[...expectedEffects].flatMap(([key, { trigger }]) => {
      const actualTrigger = actualEffects.get(key)?.trigger;
      return actualEffects.has(key) && actualTrigger !== trigger
        ? [`effect ${key}: ${startedBy(actualTrigger)}, expected ${startedBy(trigger)}`]
        : [];
    }),
  ];
}

const SHAPE_PROPERTIES = [
  "id",
  "kind",
  "frame",
  "text",
  "media",
  "volume",
  "muted",
  "fadeInMs",
] as const;
/** A provider may recreate section audio, so its id and frame are its own. */
const SECTION_AUDIO_PROPERTIES = ["kind", "media", "volume", "muted", "fadeInMs"] as const;

function shapeDifferences(
  label: string,
  properties: ReadonlyArray<keyof InspectedShape>,
  expected: readonly InspectedShape[],
  actual: readonly InspectedShape[],
): string[] {
  const expectedShapes = keyed(expected, ({ name }) => name);
  const actualShapes = keyed(actual, ({ name }) => name);
  return [
    ...[...expectedShapes].flatMap(([key, shape]) => {
      const actualShape = actualShapes.get(key);
      if (!actualShape) {
        return [`${label} ${key}: removed`];
      }
      return properties
        .filter((property) => actualShape[property] !== shape[property])
        .map(
          (property) =>
            `${label} ${key}: ${property} ${JSON.stringify(actualShape[property])}, expected ${JSON.stringify(shape[property])}`,
        );
    }),
    ...[...actualShapes.keys()]
      .filter((key) => !expectedShapes.has(key))
      .map((key) => `${label} ${key}: added`),
  ];
}

function slideDifferences(expected: InspectedSlide, actual: InspectedSlide): string[] {
  return [
    ...(actual.notes === expected.notes
      ? []
      : [`notes: ${JSON.stringify(actual.notes)}, expected ${JSON.stringify(expected.notes)}`]),
    ...shapeDifferences(
      "section audio",
      SECTION_AUDIO_PROPERTIES,
      expected.sectionAudio,
      actual.sectionAudio,
    ),
    ...shapeDifferences("shape", SHAPE_PROPERTIES, expected.otherShapes, actual.otherShapes),
    ...effectDifferences(expected.effects, actual.effects),
  ];
}

/**
 * Names each slide, shape and property in which `actual` differs from `expected`, and each
 * effect removed, added, moved or retriggered. Animation durations and delays are never compared.
 */
export function presentationDifferences(
  expected: InspectedPresentation,
  actual: InspectedPresentation,
): string[] {
  if (actual.slides.length !== expected.slides.length) {
    return [`slides: ${actual.slides.length}, expected ${expected.slides.length}`];
  }
  return expected.slides.flatMap((slide, i) =>
    slideDifferences(slide, actual.slides[i] ?? slide).map(
      (difference) => `slide ${slide.slideNumber}, ${difference}`,
    ),
  );
}
