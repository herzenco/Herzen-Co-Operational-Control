export type ContentReviewField = "title" | "body" | "caption";
export type ContentReviewBlockKind = "h1" | "h2" | "p";

export type ContentReviewBlock = {
  id: string;
  field: ContentReviewField;
  kind: ContentReviewBlockKind;
  text: string;
  original: string;
};

export type ContentReviewRevision = {
  id: string;
  blockId: string;
  before: string;
  after: string;
  author: string;
  createdAt: string;
  acceptedAt: string | null;
};

export type ContentReviewComment = {
  id: string;
  blockId: string | null;
  quote: string;
  body: string;
  author: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type ContentReviewBaseline = {
  title: string;
  body: string;
  caption: string;
};

export type StoredContentReview = {
  schemaVersion: 1;
  version: number;
  baseline: ContentReviewBaseline;
  revisions: ContentReviewRevision[];
  comments: ContentReviewComment[];
};

export type WordDiffPart = { type: "same" | "removed" | "inserted"; value: string };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function plainText(value: unknown) {
  const source = stringValue(value);
  if (!/<\/?[a-z][\s\S]*>/i.test(source)) return source.trim();
  return source
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li(?:\s[^>]*)?>/gi, "\n• ")
    .replace(/<\s*\/(?:p|h[1-6]|li|ul|ol|blockquote|section|article)\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function baselineFromItem(item: UnknownRecord): ContentReviewBaseline {
  return {
    title: plainText(item.title),
    body: plainText(item.body),
    caption: plainText(item.caption),
  };
}

function revision(value: unknown): ContentReviewRevision | null {
  const source = record(value);
  if (!source || !stringValue(source.id) || !stringValue(source.blockId)) return null;
  return {
    id: stringValue(source.id),
    blockId: stringValue(source.blockId),
    before: stringValue(source.before),
    after: stringValue(source.after),
    author: stringValue(source.author) || "Reviewer",
    createdAt: stringValue(source.createdAt) || new Date(0).toISOString(),
    acceptedAt: nullableString(source.acceptedAt),
  };
}

function comment(value: unknown): ContentReviewComment | null {
  const source = record(value);
  if (!source || !stringValue(source.id) || !stringValue(source.body)) return null;
  return {
    id: stringValue(source.id),
    blockId: nullableString(source.blockId),
    quote: stringValue(source.quote),
    body: stringValue(source.body),
    author: stringValue(source.author) || "Reviewer",
    createdAt: stringValue(source.createdAt) || new Date(0).toISOString(),
    resolvedAt: nullableString(source.resolvedAt),
  };
}

export function readStoredContentReview(item: UnknownRecord): StoredContentReview {
  const metadata = record(item.metadata);
  const stored = record(metadata?.content_review);
  const storedBaseline = record(stored?.baseline);
  const fallback = baselineFromItem(item);
  const baseline = storedBaseline ? {
    title: stringValue(storedBaseline.title) || fallback.title,
    body: stringValue(storedBaseline.body),
    caption: stringValue(storedBaseline.caption),
  } : fallback;
  const revisions = Array.isArray(stored?.revisions)
    ? stored.revisions.map(revision).filter((entry): entry is ContentReviewRevision => Boolean(entry))
    : [];
  const comments = Array.isArray(stored?.comments)
    ? stored.comments.map(comment).filter((entry): entry is ContentReviewComment => Boolean(entry))
    : [];
  return {
    schemaVersion: 1,
    version: Math.max(1, Number(stored?.version || item.monthly_ops_version || 1)),
    baseline,
    revisions,
    comments,
  };
}

function bodyParagraphs(value: string) {
  const paragraphs = plainText(value).split(/\n\s*\n/).map((entry) => entry.trim()).filter(Boolean);
  return paragraphs.length ? paragraphs : [""];
}

export function buildContentReviewBlocks(item: UnknownRecord, review: StoredContentReview): ContentReviewBlock[] {
  const body = bodyParagraphs(stringValue(item.body));
  const originalBody = bodyParagraphs(review.baseline.body);
  const blocks: ContentReviewBlock[] = [{
    id: "title",
    field: "title",
    kind: "h1",
    text: plainText(item.title),
    original: review.baseline.title,
  }];
  body.forEach((text, index) => {
    blocks.push({
      id: `body-${index}`,
      field: "body",
      kind: /^#{1,3}\s/.test(text) ? "h2" : "p",
      text: text.replace(/^#{1,3}\s+/, ""),
      original: (originalBody[index] || "").replace(/^#{1,3}\s+/, ""),
    });
  });
  if (plainText(item.caption) || review.baseline.caption) {
    blocks.push({
      id: "caption",
      field: "caption",
      kind: "p",
      text: plainText(item.caption),
      original: review.baseline.caption,
    });
  }
  return blocks;
}

export function fieldsFromReviewBlocks(blocks: ContentReviewBlock[]) {
  return {
    title: blocks.find((block) => block.field === "title")?.text || "",
    body: blocks.filter((block) => block.field === "body").map((block) => block.text).join("\n\n"),
    caption: blocks.find((block) => block.field === "caption")?.text || "",
  };
}

export function baselineFromReviewBlocks(blocks: ContentReviewBlock[]): ContentReviewBaseline {
  return fieldsFromReviewBlocks(blocks);
}

export function wordDiff(before: string, after: string): WordDiffPart[] {
  const left = before.split(/(\s+)/).filter(Boolean);
  const right = after.split(/(\s+)/).filter(Boolean);
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      matrix[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
        ? matrix[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1]);
    }
  }
  const parts: WordDiffPart[] = [];
  const push = (type: WordDiffPart["type"], value: string) => {
    const previous = parts.at(-1);
    if (previous?.type === type) previous.value += value;
    else parts.push({ type, value });
  };
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      push("same", left[leftIndex]);
      leftIndex += 1;
      rightIndex += 1;
    } else if (matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1]) {
      push("removed", left[leftIndex]);
      leftIndex += 1;
    } else {
      push("inserted", right[rightIndex]);
      rightIndex += 1;
    }
  }
  while (leftIndex < left.length) push("removed", left[leftIndex++]);
  while (rightIndex < right.length) push("inserted", right[rightIndex++]);
  return parts;
}
