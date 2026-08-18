"use client";

import { useEffect, useRef, useState } from "react";
import {
  baselineFromReviewBlocks,
  buildContentReviewBlocks,
  fieldsFromReviewBlocks,
  readStoredContentReview,
  wordDiff,
  type ContentReviewBlock,
  type ContentReviewComment,
  type StoredContentReview,
} from "../utils/content-review-workspace";

type RecordValue = Record<string, unknown>;
type ReviewMode = "editing" | "changes";
type ReviewRail = "comments" | "history";
type ReviewDecision = "approved" | "denied" | null;
type SelectionDraft = { blockId: string; quote: string; left: number; top: number };

type ContentReviewWorkspaceProps = {
  item: RecordValue;
  authorName: string;
  ownerName: string;
  propertyName: string;
  platformName: string;
  typeName: string;
  statusName: string;
  publishLabel: string;
  creativeUrl?: string;
  decision: ReviewDecision;
  decisionSaving?: boolean;
  utilityStatus?: { kind: "success" | "error"; message: string } | null;
  downloadingCreative?: boolean;
  onClose: () => void;
  onOpenEditor: () => void;
  onCopyCaption?: () => Promise<void>;
  onDownloadCreative?: () => Promise<void>;
  onDecision: (decision: ReviewDecision) => Promise<void>;
  onPersist: (fields: { title: string; body: string; caption: string }, review: StoredContentReview) => Promise<void>;
};

function reviewId(prefix: string) {
  return `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function dateTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "R";
}

export function ContentReviewWorkspace({
  item,
  authorName,
  ownerName,
  propertyName,
  platformName,
  typeName,
  statusName,
  publishLabel,
  creativeUrl,
  decision,
  decisionSaving = false,
  utilityStatus,
  downloadingCreative = false,
  onClose,
  onOpenEditor,
  onCopyCaption,
  onDownloadCreative,
  onDecision,
  onPersist,
}: ContentReviewWorkspaceProps) {
  const [review, setReview] = useState<StoredContentReview>(() => readStoredContentReview(item));
  const [blocks, setBlocks] = useState<ContentReviewBlock[]>(() => buildContentReviewBlocks(item, readStoredContentReview(item)));
  const [mode, setMode] = useState<ReviewMode>("editing");
  const [rail, setRail] = useState<ReviewRail>("comments");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionDraft | null>(null);
  const [commentDraft, setCommentDraft] = useState<{ blockId: string; quote: string } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [documentComment, setDocumentComment] = useState("");
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const documentRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const commentRefs = useRef<Record<string, HTMLElement | null>>({});
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);

  const openComments = review.comments.filter((comment) => !comment.resolvedAt).length;
  const pendingRevisions = review.revisions.filter((revision) => !revision.acceptedAt).length;

  useEffect(() => {
    if (commentDraft) composerRef.current?.focus();
  }, [commentDraft]);

  useEffect(() => {
    if (!activeComment) return;
    commentRefs.current[activeComment]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeComment, rail, sheetOpen]);

  useEffect(() => {
    const readSelection = () => {
      if (mode !== "editing") return setSelection(null);
      const host = documentRef.current;
      const browserSelection = document.getSelection();
      if (!host || !browserSelection || browserSelection.isCollapsed || browserSelection.rangeCount === 0) return setSelection(null);
      const range = browserSelection.getRangeAt(0);
      const origin = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer as HTMLElement;
      const block = origin?.closest?.("[data-review-block]") as HTMLElement | null;
      if (!block || !host.contains(block)) return setSelection(null);
      const quote = browserSelection.toString().replace(/\s+/g, " ").trim();
      if (quote.length < 2) return setSelection(null);
      const rectangle = range.getBoundingClientRect();
      setSelection({
        blockId: block.dataset.reviewBlock || "",
        quote,
        left: Math.min(window.innerWidth - 24, Math.max(24, rectangle.left + rectangle.width / 2)),
        top: Math.max(16, rectangle.bottom + 10),
      });
    };
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [mode]);

  function persist(nextBlocks: ContentReviewBlock[], nextReview: StoredContentReview) {
    const fields = fieldsFromReviewBlocks(nextBlocks);
    pendingSaves.current += 1;
    setSaving(true);
    setReviewError("");
    const nextSave = saveQueue.current
      .catch(() => undefined)
      .then(() => onPersist(fields, nextReview));
    saveQueue.current = nextSave;
    void nextSave.catch((error: unknown) => {
      setReviewError(error instanceof Error ? error.message : "The review could not be saved.");
    }).finally(() => {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) setSaving(false);
    });
  }

  function commitBlock(blockId: string, value: string) {
    const normalized = value.replace(/\s+/g, " ").trim();
    const current = blocks.find((block) => block.id === blockId);
    if (!current || normalized === current.text || (current.field === "title" && !normalized)) return;
    const nextBlocks = blocks.map((block) => block.id === blockId ? { ...block, text: normalized } : block);
    const nextReview: StoredContentReview = {
      ...review,
      revisions: [{
        id: reviewId("revision"),
        blockId,
        before: current.text,
        after: normalized,
        author: authorName,
        createdAt: new Date().toISOString(),
        acceptedAt: null,
      }, ...review.revisions],
    };
    setBlocks(nextBlocks);
    setReview(nextReview);
    persist(nextBlocks, nextReview);
  }

  function renderBlockContent(block: ContentReviewBlock) {
    if (mode === "changes" && block.text !== block.original) {
      return wordDiff(block.original, block.text).map((part, index) => (
        <span className={`reviewDiff ${part.type}`} key={`${block.id}-${index}`}>{part.value}</span>
      ));
    }
    const anchors = review.comments
      .filter((comment) => !comment.resolvedAt && comment.blockId === block.id && comment.quote && block.text.includes(comment.quote))
      .map((comment) => ({ comment, start: block.text.indexOf(comment.quote), end: block.text.indexOf(comment.quote) + comment.quote.length }))
      .sort((left, right) => left.start - right.start);
    if (!anchors.length) return block.text;
    const nodes: React.ReactNode[] = [];
    let offset = 0;
    for (const anchor of anchors) {
      if (anchor.start < offset) continue;
      nodes.push(block.text.slice(offset, anchor.start));
      nodes.push(<mark className={activeComment === anchor.comment.id ? "active" : ""} data-comment-id={anchor.comment.id} key={anchor.comment.id}>{block.text.slice(anchor.start, anchor.end)}</mark>);
      offset = anchor.end;
    }
    nodes.push(block.text.slice(offset));
    return nodes;
  }

  function updateComments(comments: ContentReviewComment[]) {
    const nextReview = { ...review, comments };
    setReview(nextReview);
    persist(blocks, nextReview);
  }

  function postAnchoredComment() {
    const body = commentBody.trim();
    if (!commentDraft || !body) return;
    const nextComment: ContentReviewComment = {
      id: reviewId("comment"),
      blockId: commentDraft.blockId,
      quote: commentDraft.quote,
      body,
      author: authorName,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    setCommentDraft(null);
    setCommentBody("");
    setActiveComment(nextComment.id);
    updateComments([nextComment, ...review.comments]);
  }

  function postDocumentComment() {
    const body = documentComment.trim();
    if (!body) return;
    const nextComment: ContentReviewComment = {
      id: reviewId("document-comment"),
      blockId: null,
      quote: "",
      body,
      author: authorName,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    setDocumentComment("");
    setActiveComment(nextComment.id);
    updateComments([nextComment, ...review.comments]);
  }

  function toggleComment(comment: ContentReviewComment) {
    const resolvedAt = comment.resolvedAt ? null : new Date().toISOString();
    updateComments(review.comments.map((entry) => entry.id === comment.id ? { ...entry, resolvedAt } : entry));
  }

  function deleteComment(commentId: string) {
    setActiveComment((current) => current === commentId ? null : current);
    updateComments(review.comments.filter((comment) => comment.id !== commentId));
  }

  function restoreRevision(revisionId: string, blockId: string) {
    const nextBlocks = blocks.map((block) => block.id === blockId ? { ...block, text: block.original } : block);
    const nextReview = { ...review, revisions: review.revisions.filter((revision) => revision.id !== revisionId) };
    setBlocks(nextBlocks);
    setReview(nextReview);
    persist(nextBlocks, nextReview);
  }

  function acceptAll() {
    const acceptedAt = new Date().toISOString();
    const nextBlocks = blocks.map((block) => ({ ...block, original: block.text }));
    const nextReview: StoredContentReview = {
      ...review,
      version: review.version + 1,
      baseline: baselineFromReviewBlocks(nextBlocks),
      revisions: review.revisions.map((revision) => revision.acceptedAt ? revision : { ...revision, acceptedAt }),
    };
    setBlocks(nextBlocks);
    setReview(nextReview);
    setMode("editing");
    persist(nextBlocks, nextReview);
  }

  function rejectAll() {
    const nextBlocks = blocks.map((block) => ({ ...block, text: block.original }));
    const nextReview = { ...review, revisions: review.revisions.filter((revision) => revision.acceptedAt) };
    setBlocks(nextBlocks);
    setReview(nextReview);
    setMode("editing");
    persist(nextBlocks, nextReview);
  }

  async function decide(nextDecision: ReviewDecision) {
    try {
      setReviewError("");
      await onDecision(nextDecision);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The decision could not be recorded.");
    }
  }

  function openRail(nextRail: ReviewRail) {
    setRail(nextRail);
    setSheetOpen(true);
  }

  return (
    <section className="contentReviewWorkspace" aria-label={`Review ${String(item.title || "content draft")}`}>
      <header className="contentReviewHeader">
        <div className="contentReviewHeaderMain">
          <button type="button" className="contentReviewBack" onClick={onClose} aria-label="Close content review">← Content</button>
          <div className="contentReviewIdentity"><span>Content review</span><h1>{String(item.title || "Untitled content")}</h1></div>
          <div className="contentReviewModes" aria-label="Review mode">
            <button className={mode === "editing" ? "active" : ""} type="button" onClick={() => setMode("editing")}>Editing</button>
            <button className={mode === "changes" ? "active" : ""} type="button" onClick={() => { setMode("changes"); setRail("history"); setSelection(null); document.getSelection()?.removeAllRanges(); }}>Changes</button>
          </div>
          {mode === "changes" && pendingRevisions > 0 && <div className="contentReviewBulkActions"><button type="button" onClick={acceptAll}>Accept all</button><button type="button" onClick={rejectAll}>Reject all</button></div>}
          <div className="contentReviewDecision">
            {!decision && <><button type="button" className="approve" disabled={decisionSaving} onClick={() => void decide("approved")}>Approve</button><button type="button" className="deny" disabled={decisionSaving} onClick={() => void decide("denied")}>Deny</button></>}
            {decision && <div className={`reviewDecisionChip ${decision}`}><span>{decision === "approved" ? "Approved" : "Denied"}</span><button type="button" disabled={decisionSaving} onClick={() => void decide(null)}>Undo</button></div>}
          </div>
        </div>
        <div className="contentReviewMeta">
          <span>Draft v{review.version}</span><span className="author">● {ownerName}</span><span>{review.revisions.length} tracked edit{review.revisions.length === 1 ? "" : "s"}</span><span>{openComments} open comment{openComments === 1 ? "" : "s"}</span><span>{mode === "editing" ? "Type to edit — every change is recorded" : "Reviewing tracked changes"}</span>{(saving || decisionSaving) && <span className="saving">Saving…</span>}
        </div>
        {reviewError && <p className="contentReviewError" role="alert">{reviewError}</p>}
      </header>

      <div className="contentReviewBody">
        <main className="contentReviewCanvas">
          <div className="contentReviewContext">
            <span>{propertyName}</span><span>{platformName}</span><span>{typeName}</span><span>{publishLabel}</span><span>{statusName}</span>
            <div className="contentReviewContextActions"><button type="button" onClick={onOpenEditor}>Edit fields</button>{onCopyCaption && <button type="button" onClick={() => void onCopyCaption()}>Copy caption</button>}{onDownloadCreative && <button type="button" disabled={downloadingCreative} onClick={() => void onDownloadCreative()}>{downloadingCreative ? "Preparing download…" : "Download image"}</button>}</div>
            {utilityStatus && <small className={utilityStatus.kind} role="status" aria-live="polite">{utilityStatus.message}</small>}
          </div>
          <article className="contentReviewDocument" ref={documentRef} onClick={(event) => {
            const mark = (event.target as HTMLElement).closest?.("mark[data-comment-id]") as HTMLElement | null;
            if (!mark?.dataset.commentId) return;
            setActiveComment(mark.dataset.commentId);
            openRail("comments");
          }}>
            {creativeUrl && <figure className="contentReviewCreative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={creativeUrl} alt={`Creative for ${String(item.title || "content")}`} />
              <figcaption>Creative attached to this draft</figcaption>
            </figure>}
            {blocks.map((block) => <div key={block.id} className={`contentReviewBlock ${block.kind} ${review.comments.some((comment) => comment.blockId === block.id && !comment.resolvedAt) ? "commented" : ""}`}>
              {block.id === "caption" && <span className="contentReviewSectionLabel">Publishing caption</span>}
              <div
                data-review-block={block.id}
                contentEditable={mode === "editing"}
                suppressContentEditableWarning
                spellCheck
                role="textbox"
                aria-label={`${block.id === "title" ? "Title" : block.id === "caption" ? "Publishing caption" : "Draft paragraph"}. ${mode === "editing" ? "Editable" : "Read only"}.`}
                aria-readonly={mode !== "editing"}
                aria-multiline={block.kind === "p"}
                onBlur={(event) => commitBlock(block.id, event.currentTarget.innerText)}
              >{renderBlockContent(block)}</div>
            </div>)}
            <footer>End of draft — select any text to leave a comment</footer>
          </article>
        </main>

        <aside className={`contentReviewRail ${sheetOpen ? "open" : ""}`} aria-label={`${rail} rail`}>
          <header><button type="button" className={rail === "comments" ? "active" : ""} onClick={() => setRail("comments")}>Comments {openComments}</button><button type="button" className={rail === "history" ? "active" : ""} onClick={() => setRail("history")}>History {review.revisions.length}</button><button type="button" className="contentReviewSheetClose" onClick={() => setSheetOpen(false)}>Close</button></header>
          <div className="contentReviewRailBody">
            {rail === "comments" && <>
              {commentDraft && <section className="contentReviewComposer selected"><span>New anchored comment</span><blockquote>“{commentDraft.quote}”</blockquote><textarea ref={composerRef} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} rows={3} placeholder="Leave a note for the writer…" /><div><button type="button" className="primary" disabled={!commentBody.trim()} onClick={postAnchoredComment}>Comment</button><button type="button" onClick={() => { setCommentDraft(null); setCommentBody(""); }}>Cancel</button></div></section>}
              <section className="contentReviewComposer"><span>Comment on whole document</span><textarea value={documentComment} onChange={(event) => setDocumentComment(event.target.value)} rows={2} placeholder="Overall feedback — no selection needed…" /><button type="button" className="primary" disabled={!documentComment.trim()} onClick={postDocumentComment}>Post comment</button></section>
              {review.comments.map((comment) => <article className={`contentReviewThread ${activeComment === comment.id ? "active" : ""} ${comment.resolvedAt ? "resolved" : ""}`} key={comment.id} ref={(node) => { commentRefs.current[comment.id] = node; }} onClick={() => setActiveComment(comment.id)}>
                <header><i>{initials(comment.author)}</i><b>{comment.author}</b><time>{dateTimeLabel(comment.createdAt)}</time></header>
                {comment.quote ? <blockquote>“{comment.quote}”{comment.resolvedAt ? " — resolved" : ""}</blockquote> : <span className="wholeDocument">Whole document</span>}
                <p>{comment.body}</p>
                <footer><button type="button" onClick={(event) => { event.stopPropagation(); toggleComment(comment); }}>{comment.resolvedAt ? "Reopen" : "Resolve"}</button><button type="button" onClick={(event) => { event.stopPropagation(); deleteComment(comment.id); }}>Delete</button></footer>
              </article>)}
              {!review.comments.length && !commentDraft && <p className="contentReviewEmpty">No comments yet.<br />Select text in the draft to start a thread.</p>}
            </>}
            {rail === "history" && <>
              {review.revisions.map((revision) => <article className="contentReviewRevision" key={revision.id}><header><span className={revision.acceptedAt ? "accepted" : "tracked"}>{revision.acceptedAt ? "Accepted" : "Tracked edit"}</span><span>{revision.author}</span><time>{dateTimeLabel(revision.createdAt)}</time></header><del>{revision.before}</del><ins>{revision.after}</ins>{!revision.acceptedAt && <button type="button" onClick={() => restoreRevision(revision.id, revision.blockId)}>Restore original</button>}</article>)}
              {!review.revisions.length && <p className="contentReviewEmpty">No edits recorded.<br />Type anywhere in the draft — every change is logged.</p>}
            </>}
          </div>
        </aside>
      </div>

      <nav className="contentReviewMobileBar" aria-label="Review panels"><button type="button" onClick={() => openRail("comments")}>Comments {openComments}</button><button type="button" onClick={() => openRail("history")}>History {review.revisions.length}</button></nav>
      {selection && mode === "editing" && <div className="contentReviewSelection" style={{ left: selection.left, top: selection.top }}><span>“{selection.quote}”</span><button type="button" onMouseDown={(event) => { event.preventDefault(); setCommentDraft({ blockId: selection.blockId, quote: selection.quote }); setSelection(null); openRail("comments"); }}>Comment</button></div>}
    </section>
  );
}
