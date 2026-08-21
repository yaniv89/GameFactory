import { Button, Dialog, Input, Select, Textarea, type ViewState } from "@forge/ds";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import type { ArtGenCategory, GenerationRequestResult, GenerationVariation, SelectVariationResult } from "../api/artGenerationApi";
import "./DescribeItDialog.css";

// Mirrors CreateGenerationRequestEndpoint.cs's own validation exactly
// (non-empty, <=500 chars, category in ArtGenCategory) — client-side
// checks are a UX head start, never the source of truth; the server
// re-validates every field regardless (CLAUDE.md Section 1.1 guardrail 4
// in spirit: never trust the client for anything the server must still
// enforce).
const composeSchema = z.object({
  userPrompt: z.string().trim().min(1, "Describe what you want before generating.").max(500, "Must be 500 characters or fewer."),
  category: z.enum(["tile", "prop"], { message: "Choose what kind of art this is." }),
});
type ComposeValues = z.infer<typeof composeSchema>;

// A hand-written equivalent of `@hookform/resolvers/zod`'s adapter, the
// same ~15-line bridge `packages/editor/src/inspector/jsonSchema.ts`'s
// own `zodResolver` already is for a different, JsonSchema-shaped Zod
// type — not extracted into one shared generic helper, since the two
// call sites have never needed to agree on the same form-value type and
// forcing that now would just be indirection for its own sake.
const composeResolver: Resolver<ComposeValues> = (values) => {
  const result = composeSchema.safeParse(values);
  if (result.success) return { values: result.data, errors: {} };
  const errors: Record<string, { type: string; message: string }> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in errors)) errors[key] = { type: issue.code, message: issue.message };
  }
  return { values: {}, errors };
};

const CATEGORY_OPTIONS = [
  { value: "tile", label: "Tile — a seamless, repeatable ground texture" },
  { value: "prop", label: "Prop — a standalone object with a transparent background" },
];

const TERMINAL_ERROR_STATUSES: ReadonlySet<GenerationRequestResult["status"]> = new Set(["failed", "declined"]);

export interface DescribeItDialogProps {
  open: boolean;
  onClose: () => void;

  submitting: boolean;
  submitError: string | undefined;
  retryAfterSeconds: number | undefined;
  onSubmit: (userPrompt: string, category: ArtGenCategory) => void;

  request: GenerationRequestResult | undefined;

  pollState: ViewState;
  pollError: string | undefined;

  confirming: boolean;
  confirmError: string | undefined;
  onConfirm: () => void;

  onStartOver: () => void;

  selecting: boolean;
  selectError: string | undefined;
  onSelect: (variationId: string, assetName: string) => Promise<SelectVariationResult | undefined>;
  /** Fetches an authenticated object URL for one Ready variation's real content — a plain `<img src>` can't carry the Bearer token this needs. Returns `undefined` on failure; a broken thumbnail is not a reason to lose the rest of the grid. */
  loadVariationThumbnail: (variationId: string) => Promise<string | undefined>;
}

/**
 * docs/adr/0016 (N5): the "describe it" entry point into AI-assisted art
 * generation — additive to, never a replacement for, the sourced-photo
 * art pipeline this session already built (this project's own standing
 * constraint). Four phases share one dialog rather than four separate
 * ones, because they're stages of a single request, not independent
 * views: compose -> confirm the server-expanded prompt (before any
 * image-generation cost is spent, docs/adr/0016 Decision 2) -> wait for
 * `Forge.Functions.ArtGen` (N3/N4) -> pick a variation, which promotes it
 * into a real, named `Asset` (`SelectGenerationVariationEndpoint.cs`).
 */
export function DescribeItDialog({
  open,
  onClose,
  submitting,
  submitError,
  retryAfterSeconds,
  onSubmit,
  request,
  pollState,
  pollError,
  confirming,
  confirmError,
  onConfirm,
  onStartOver,
  selecting,
  selectError,
  onSelect,
  loadVariationThumbnail,
}: DescribeItDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ComposeValues>({ resolver: composeResolver, defaultValues: { userPrompt: "", category: "tile" } });

  // A clean slate on every open, same reasoning as every other dialog in
  // this package (AssetsLibraryDialog.tsx's own reset-on-open effect):
  // reopening should not silently resume a half-filled or half-finished
  // previous attempt.
  useEffect(() => {
    if (open) reset({ userPrompt: "", category: "tile" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const phase = !request
    ? "compose"
    : request.status === "awaiting_confirmation"
      ? "confirm"
      : TERMINAL_ERROR_STATUSES.has(request.status)
        ? "terminal-error"
        : request.status === "ready"
          ? "ready"
          : "progress";

  return (
    <Dialog
      open={open}
      title="Describe It"
      onClose={onClose}
      actions={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="fg-describe-it">
        {phase === "compose" && (
          <form
            className="fg-describe-it__compose"
            onSubmit={handleSubmit((values) => onSubmit(values.userPrompt.trim(), values.category as ArtGenCategory))}
          >
            <Textarea
              label="Describe it"
              placeholder="A mossy stone tile with faint cracks running through it"
              hint="One or two sentences. This becomes an addition to your project's art — it never replaces or edits anything already there."
              {...(errors.userPrompt?.message !== undefined ? { error: errors.userPrompt.message } : {})}
              {...register("userPrompt")}
            />
            <Select
              label="Kind"
              options={CATEGORY_OPTIONS}
              {...(errors.category?.message !== undefined ? { error: errors.category.message } : {})}
              {...register("category")}
            />
            {submitError && (
              <p className="fg-describe-it__error" role="alert">
                {submitError}
                {retryAfterSeconds !== undefined && ` Try again in ${retryAfterSeconds} seconds.`}
              </p>
            )}
            <Button type="submit" variant="primary" loading={submitting}>
              Generate
            </Button>
          </form>
        )}

        {phase === "confirm" && request && (
          <div className="fg-describe-it__confirm">
            <p className="fg-describe-it__label">This is what will actually be generated:</p>
            <p className="fg-describe-it__expanded-prompt">{request.expandedPrompt}</p>
            {confirmError && (
              <p className="fg-describe-it__error" role="alert">
                {confirmError}
              </p>
            )}
            <div className="fg-describe-it__actions">
              <Button variant="secondary" onClick={onStartOver}>
                Start over
              </Button>
              <Button variant="primary" loading={confirming} onClick={onConfirm}>
                Generate images
              </Button>
            </div>
          </div>
        )}

        {phase === "progress" && (
          <ProgressPhase pollState={pollState} pollError={pollError} status={request?.status} />
        )}

        {phase === "terminal-error" && request && (
          <div className="fg-describe-it__terminal-error" role="alert">
            <p className="fg-describe-it__state-title">
              {request.status === "declined" ? "This description was declined" : "Generation failed"}
            </p>
            <p>{request.errorMessage ?? "No further detail is available."}</p>
            <Button variant="secondary" onClick={onStartOver}>
              Try again
            </Button>
          </div>
        )}

        {phase === "ready" && request && (
          <VariationPicker
            variations={request.variations}
            selecting={selecting}
            selectError={selectError}
            onSelect={onSelect}
            loadVariationThumbnail={loadVariationThumbnail}
            onStartOver={onStartOver}
          />
        )}
      </div>
    </Dialog>
  );
}

function ProgressPhase({
  pollState,
  pollError,
  status,
}: {
  pollState: ViewState;
  pollError: string | undefined;
  status: GenerationRequestResult["status"] | undefined;
}) {
  if (pollState === "offline") {
    return (
      <div className="fg-describe-it__progress" role="status">
        <p className="fg-describe-it__state-title">Offline — can't check on this generation</p>
        <p>Reconnect and this will pick back up automatically.</p>
      </div>
    );
  }
  if (pollState === "error") {
    return (
      <div className="fg-describe-it__progress" role="alert">
        <p className="fg-describe-it__state-title">Couldn't check on this generation</p>
        <p>{pollError ?? "The request timed out."} Checking again automatically.</p>
      </div>
    );
  }
  if (pollState === "permission-denied") {
    return (
      <div className="fg-describe-it__progress">
        <p className="fg-describe-it__state-title">This generation is no longer available</p>
        <p>It may have belonged to a project that was since deleted, or you no longer have access to it.</p>
      </div>
    );
  }
  return (
    <div className="fg-describe-it__progress" role="status">
      <span className="fg-describe-it__spinner" aria-hidden="true" />
      <p>{status === "generating" ? "Generating your art…" : "Queued — this will start shortly…"}</p>
    </div>
  );
}

function VariationPicker({
  variations,
  selecting,
  selectError,
  onSelect,
  loadVariationThumbnail,
  onStartOver,
}: {
  variations: readonly GenerationVariation[];
  selecting: boolean;
  selectError: string | undefined;
  onSelect: (variationId: string, assetName: string) => Promise<SelectVariationResult | undefined>;
  loadVariationThumbnail: (variationId: string) => Promise<string | undefined>;
  onStartOver: () => void;
}) {
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const [assetName, setAssetName] = useState("");
  const [saved, setSaved] = useState<SelectVariationResult | undefined>(undefined);

  if (saved) {
    return (
      <div className="fg-describe-it__saved" role="status">
        <p className="fg-describe-it__state-title">Saved as an asset</p>
        <p>
          <strong>{saved.originalName}</strong> is now in this workspace's asset library, usable in Art Pack resolution the same as
          any uploaded asset.
        </p>
        <Button variant="secondary" onClick={onStartOver}>
          Generate another
        </Button>
      </div>
    );
  }

  const handleSave = async () => {
    if (!pickedId || !assetName.trim()) return;
    const result = await onSelect(pickedId, assetName.trim());
    if (result) setSaved(result);
  };

  return (
    <div className="fg-describe-it__picker">
      <p className="fg-describe-it__label">Pick a variation to keep as an asset:</p>
      <ul className="fg-describe-it__variations">
        {variations.map((variation) => (
          <VariationThumbnail
            key={variation.id}
            variation={variation}
            picked={pickedId === variation.id}
            onPick={() => setPickedId(variation.id)}
            loadVariationThumbnail={loadVariationThumbnail}
          />
        ))}
      </ul>
      {pickedId && (
        <div className="fg-describe-it__save">
          <Input
            label="Asset name"
            hint="Matches how the active pack names its own files to override it, the same as a hand-uploaded asset."
            value={assetName}
            onChange={(e) => setAssetName(e.target.value)}
            placeholder="tilesets/moss-stone.png"
          />
          {selectError && (
            <p className="fg-describe-it__error" role="alert">
              {selectError}
            </p>
          )}
          <Button variant="primary" loading={selecting} disabled={!assetName.trim()} onClick={() => void handleSave()}>
            Save as asset
          </Button>
        </div>
      )}
    </div>
  );
}

function VariationThumbnail({
  variation,
  picked,
  onPick,
  loadVariationThumbnail,
}: {
  variation: GenerationVariation;
  picked: boolean;
  onPick: () => void;
  loadVariationThumbnail: (variationId: string) => Promise<string | undefined>;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    void loadVariationThumbnail(variation.id).then((url) => {
      if (cancelled) return;
      objectUrl = url;
      setThumbnailUrl(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variation.id]);

  return (
    <li>
      <button
        type="button"
        className={`fg-describe-it__variation${picked ? " fg-describe-it__variation--picked" : ""}`}
        onClick={onPick}
        aria-pressed={picked}
        aria-label={`Use variation ${variation.width}×${variation.height}${variation.selected ? " (previously selected)" : ""}`}
      >
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : <span className="fg-describe-it__variation-placeholder" aria-hidden="true" />}
      </button>
    </li>
  );
}
