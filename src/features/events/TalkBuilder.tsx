import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { LoadingBlock, Page, Panel, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TALK_TEMPLATES, talkTemplate } from "@/content/talk-templates";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import { keys, useEvent, useTalk } from "@/lib/ipc/queries";
import type { TalkView } from "@/lib/ipc/schemas";

const OWN = "own";
const MAX_SECTIONS = 20;
const MAX_KEYWORDS = 3;

type Draft = { key: string; id: string | null; title: string; keywords: string[]; notes: string; target: string };

/** "1:30" or "90" seconds; null when it isn't a time between 5 seconds and an hour. */
export function parseTarget(text: string): number | null {
  const t = text.trim();
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  const seconds = m ? Number(m[1]) * 60 + Number(m[2]) : /^\d{1,4}$/.test(t) ? Number(t) : NaN;
  return Number.isFinite(seconds) && seconds >= 5 && seconds <= 3600 ? seconds : null;
}

let draftKey = 0;
const draft = (s: { id?: string | null; title: string; keywords?: readonly string[]; notes?: string; targetSeconds: number }): Draft => ({
  key: `d${++draftKey}`, id: s.id ?? null, title: s.title, keywords: [...(s.keywords ?? [])], notes: s.notes ?? "", target: formatClock(s.targetSeconds * 1000),
});
const fromTemplate = (id: string) => (talkTemplate(id)?.sections ?? []).map((s) => draft(s));
/** True when the sections are still the template's own, so swapping loses nothing. */
const unchanged = (sections: Draft[], templateId: string | null) => {
  const defaults = talkTemplate(templateId)?.sections ?? [];
  return (
    sections.length === defaults.length &&
    sections.every((s, i) => s.title === defaults[i].title && parseTarget(s.target) === defaults[i].targetSeconds && s.keywords.length === 0 && !s.notes.trim())
  );
};

function KeywordEditor({ value, onChange, label }: { value: string[]; onChange: (k: string[]) => void; label: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const word = text.trim().split(/\s+/).join(" ").slice(0, 30);
    if (word && value.length < MAX_KEYWORDS && !value.includes(word)) onChange([...value, word]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((k) => (
        <span key={k} className="inline-flex h-9 items-center gap-1 rounded-full border pr-1 pl-3 text-meta">
          {k}
          <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" aria-label={`Remove keyword ${k}`} onClick={() => onChange(value.filter((x) => x !== k))}>
            <X aria-hidden />
          </Button>
        </span>
      ))}
      {value.length < MAX_KEYWORDS && (
        <Input
          aria-label={label}
          placeholder="Add a keyword"
          maxLength={30}
          className="h-9 w-40"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      )}
    </div>
  );
}

/**
 * The talk builder (roadmap 14.3): sections with a title, up to three keywords,
 * notes and a target time; templates to start from; move sections with the
 * arrow buttons, by mouse or keyboard. Cue cards and rehearsals read the saved
 * talk.
 */
function Builder({ talk, template, eventId }: { talk: TalkView | null; template: string; eventId: string | null }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const event = useEvent(eventId ?? undefined).data?.event;
  const id = useId();
  const [title, setTitle] = useState(talk?.talk.title ?? event?.title ?? "");
  const [templateId, setTemplateId] = useState<string | null>(talk ? talk.talk.template : template);
  const [sections, setSections] = useState<Draft[]>(() => (talk ? talk.sections.map((s) => draft(s)) : fromTemplate(template)));
  const [replacing, setReplacing] = useState<string | null>(null);
  const [dirty, setDirty] = useState(!talk);
  const list = useRef<HTMLOListElement>(null);
  // After a move, focus returns to the moved section's button, so pressing it again keeps moving it.
  const refocus = useRef<{ key: string; button: "up" | "down" } | null>(null);
  useEffect(() => {
    const pending = refocus.current;
    if (!pending) return;
    refocus.current = null;
    const button = (b: "up" | "down") => list.current?.querySelector<HTMLButtonElement>(`[data-move="${b}-${pending.key}"]`);
    const target = button(pending.button);
    (target && !target.disabled ? target : button(pending.button === "up" ? "down" : "up"))?.focus();
  }, [sections]);
  const change = (next: Draft[]) => {
    setSections(next);
    setDirty(true);
  };
  const update = (key: string, patch: Partial<Draft>) => change(sections.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (from: number, to: number, button: "up" | "down") => {
    if (to < 0 || to >= sections.length) return;
    const next = [...sections];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    refocus.current = { key: item.key, button };
    change(next);
  };
  const applyTemplate = (tid: string) => {
    setTemplateId(tid);
    change(fromTemplate(tid));
    setReplacing(null);
  };
  const totals = sections.map((s) => parseTarget(s.target));
  const total = totals.reduce<number>((n, t) => n + (t ?? 0), 0);
  const valid = title.trim().length >= 2 && sections.length > 0 && sections.every((s, i) => s.title.trim() && totals[i] !== null);

  const save = useMutation({
    mutationFn: async () => {
      const saved = await ipc.saveTalk({
        id: talk?.talk.id ?? null,
        title: title.trim(),
        template: templateId,
        sections: sections.map((s, i) => ({ id: s.id, title: s.title.trim(), keywords: s.keywords, notes: s.notes.trim(), targetSeconds: totals[i]! })),
      });
      if (!talk && eventId) await ipc.linkEventTalk(eventId, saved.talk.id);
      return saved;
    },
    onSuccess: async (saved) => {
      qc.setQueryData(keys.talk(saved.talk.id), saved);
      await qc.invalidateQueries({ queryKey: keys.talks });
      if (eventId) await qc.invalidateQueries({ queryKey: keys.realEvents });
      setSections(saved.sections.map((s) => draft(s)));
      setDirty(false);
      if (!talk) navigate(`/events/talks/${saved.talk.id}${eventId ? `?event=${eventId}` : ""}`, { replace: true });
    },
  });
  const saveThenGo = async (path: string) => {
    if (dirty) {
      const saved = await save.mutateAsync();
      navigate(`/events/talks/${saved.talk.id}${path}`);
    } else if (talk) navigate(`/events/talks/${talk.talk.id}${path}`);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="text-meta text-muted-foreground">
          {event ? <>Outline for <Link className="text-primary underline underline-offset-2" to={`/events/${event.id}`}>{event.title}</Link></> : "Talk builder"}
        </p>
        <h1 className="text-title font-semibold tracking-tight text-balance">{title.trim() || "New talk"}</h1>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="space-y-1">
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input id={`${id}-title`} maxLength={120} placeholder="e.g. Team demo" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-template`}>Template</Label>
            <Select
              value={templateId ?? OWN}
              onValueChange={(v) => {
                if (v === OWN) return setTemplateId(null);
                // Your own changes are kept unless you confirm; a template's untouched sections are swapped at once.
                if (unchanged(sections, templateId)) applyTemplate(v);
                else setReplacing(v);
              }}
            >
              <SelectTrigger id={`${id}-template`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TALK_TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                <SelectItem value={OWN}>Your own</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {replacing && (
          <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-meta">
            Replace your {sections.length} sections with the {talkTemplate(replacing)?.title} template?
            <Button size="sm" variant="outline" onClick={() => applyTemplate(replacing)}>Replace</Button>
            <Button size="sm" variant="ghost" onClick={() => setReplacing(null)}>Keep mine</Button>
          </p>
        )}
        <p className="text-meta text-muted-foreground tabular-nums" aria-live="polite">
          Sections {formatClock(total * 1000)} in total{event?.minutes ? ` · the event is ${event.minutes} min` : ""}
        </p>
      </header>

      <ol ref={list} className="space-y-3" aria-label="Sections">
        {sections.map((s, i) => (
          <li key={s.key}>
            <Panel className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-medium tabular-nums">{i + 1}</span>
                <div className="min-w-48 flex-1 space-y-1">
                  <Label htmlFor={`${id}-s${s.key}`}>Section {i + 1}</Label>
                  <Input id={`${id}-s${s.key}`} maxLength={80} value={s.title} onChange={(e) => update(s.key, { title: e.target.value })} />
                </div>
                <div className="w-28 space-y-1">
                  <Label htmlFor={`${id}-t${s.key}`}>Target</Label>
                  <Input
                    id={`${id}-t${s.key}`}
                    inputMode="numeric"
                    className="tabular-nums"
                    aria-invalid={totals[i] === null}
                    aria-describedby={totals[i] === null ? `${id}-te${s.key}` : undefined}
                    value={s.target}
                    onChange={(e) => update(s.key, { target: e.target.value })}
                  />
                </div>
                <div className="flex gap-1">
                  <Button type="button" variant="outline" size="icon" data-move={`up-${s.key}`} aria-label={`Move section ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1, "up")}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button type="button" variant="outline" size="icon" data-move={`down-${s.key}`} aria-label={`Move section ${i + 1} down`} disabled={i === sections.length - 1} onClick={() => move(i, i + 1, "down")}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove section ${i + 1}`} disabled={sections.length === 1} onClick={() => change(sections.filter((x) => x.key !== s.key))}>
                    <X aria-hidden />
                  </Button>
                </div>
              </div>
              {totals[i] === null && <p id={`${id}-te${s.key}`} className="text-meta text-destructive">Use minutes and seconds, like 1:30, between 0:05 and 60:00.</p>}
              <KeywordEditor value={s.keywords} onChange={(keywords) => update(s.key, { keywords })} label={`Keyword for section ${i + 1}`} />
              <div className="space-y-1">
                <Label htmlFor={`${id}-n${s.key}`} className="text-meta text-muted-foreground">Notes (not on the cue card)</Label>
                <Textarea id={`${id}-n${s.key}`} rows={2} maxLength={2000} value={s.notes} onChange={(e) => update(s.key, { notes: e.target.value })} />
              </div>
            </Panel>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={sections.length >= MAX_SECTIONS} onClick={() => change([...sections, draft({ title: "", targetSeconds: 60 })])}>
          <Plus aria-hidden /> Add section
        </Button>
        <span className="flex-1" />
        <Button variant="outline" disabled={!valid || save.isPending} onClick={() => void saveThenGo("/cards")}>Cue cards</Button>
        <Button variant="outline" disabled={!valid || save.isPending} onClick={() => void saveThenGo(`/rehearse${eventId ? `?event=${eventId}` : ""}`)}>Rehearse</Button>
        {talk && talk.rehearsals > 0 && <Button variant="outline" asChild><Link to={`/events/talks/${talk.talk.id}/reports`}>Reports</Link></Button>}
        <Button disabled={!valid || save.isPending || !dirty} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}</Button>
      </div>
      {save.error && <p role="alert" className="text-meta text-destructive">{save.error.message}</p>}
    </div>
  );
}

/** /events/talks/:talkId, or /events/talks/new (?template= and ?event= start it). */
export function TalkBuilderPage() {
  const { talkId } = useParams();
  const [search] = useSearchParams();
  const isNew = talkId === "new";
  const talk = useTalk(isNew ? undefined : talkId);
  const template = talkTemplate(search.get("template"))?.id ?? "classic";
  const eventId = search.get("event");
  return (
    <Page className="max-w-4xl">
      {isNew ? (
        <Builder talk={null} template={template} eventId={eventId} />
      ) : (
        <QueryView query={talk} loading={<LoadingBlock rows={4} label="Loading the talk" />}>
          {(t) => <Builder key={t.talk.id} talk={t} template={template} eventId={eventId} />}
        </QueryView>
      )}
    </Page>
  );
}
