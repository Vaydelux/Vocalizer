"use client";

/**
 * Home — library overview with real import pipeline, real metadata table,
 * real session stats, and honest format-support chips from the browser.
 */

import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleX, ListMusic, Ellipsis, Scissors, Combine, Music2, KeySquare, MicVocal, Trash2, Search, RefreshCcw } from "lucide-react";
import { PageHeader } from "@/components/studio/page-header";
import { Dropzone } from "@/components/studio/dropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTracks } from "@/lib/studio/store-tracks";
import { useJobs } from "@/lib/studio/store-jobs";
import { useUi } from "@/lib/studio/store-ui";
import { probePlaybackSupport, type PlaybackSupport } from "@/lib/studio/decode";
import { formatBytes, formatTime } from "@/lib/studio/format";
import type { AudioTrack } from "@/lib/studio/types";

function StatusBadge({ track }: { track: AudioTrack }) {
  if (track.status === "ready") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="h-3 w-3" aria-hidden /> Ready
      </Badge>
    );
  }
  if (track.status === "error") {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive" title={track.error?.message}>
        <CircleX className="h-3 w-3" aria-hidden /> {track.error?.code ?? "ERROR"}
      </Badge>
    );
  }
  return <Badge variant="outline" className="animate-pulse text-muted-foreground">Probing…</Badge>;
}

export function HomeView() {
  const tracks = useTracks((s) => s.tracks);
  const removeTrack = useTracks((s) => s.removeTrack);
  const retryTrack = useTracks((s) => s.retryTrack);
  const [query, setQuery] = useState("");
  const jobs = useJobs((s) => s.jobs);
  const openTrackWith = useUi((s) => s.openTrackWith);
  const [support, setSupport] = useState<PlaybackSupport[]>([]);
  useEffect(() => {
    let cancelled = false;
    // canPlayType probes are browser-only; deferred to avoid SSR and cascading renders.
    (async () => {
      await Promise.resolve();
      if (!cancelled) setSupport(probePlaybackSupport());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = useMemo(() => tracks.filter((t) => t.status === "ready"), [tracks]);
  const failed = useMemo(() => tracks.filter((t) => t.status === "error"), [tracks]);
  const activeJobs = useMemo(
    () => jobs.filter((j) => ["queued", "preparing", "running", "cancelling"].includes(j.state)).length,
    [jobs]
  );
  const completed = useMemo(() => jobs.filter((j) => j.state === "completed").length, [jobs]);
  const visibleTracks = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return [...tracks].reverse().filter((track) =>
      !term || track.name.toLocaleLowerCase().includes(term) ||
      track.status.toLocaleLowerCase().includes(term) ||
      (track.meta ? String(track.meta.sampleRate).includes(term) : false)
    );
  }, [tracks, query]);

  const stats = [
    { label: "Ready tracks", value: ready.length },
    { label: "Failed imports", value: failed.length },
    { label: "Active jobs", value: activeJobs },
    { label: "Completed outputs", value: completed },
  ];

  return (
    <div>
      <PageHeader
        title="Home"
        description="Import audio, inspect real decoded metadata, and open tracks in the workspace tools. Files never leave this device."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <Dropzone />
      </div>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Library ({tracks.length})</h2>
            <p className="text-xs text-muted-foreground">Files imported into this session. Search by name, status or sample rate.</p>
          </div>
          {tracks.length > 0 && (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input aria-label="Search imported tracks" placeholder="Search library…" className="pl-9"
                value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          )}
        </div>
        {tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
            <ListMusic className="mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No audio imported yet. Drop files above to begin.</p>
          </div>
        ) : visibleTracks.length === 0 ? (
          <div role="status" className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No tracks match “{query}”. Try a different search.
          </div>
        ) : (
          <div className="studio-scroll max-h-96 overflow-y-auto rounded-xl border border-border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-[34%]">File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Sample rate</TableHead>
                  <TableHead className="hidden md:table-cell">Channels</TableHead>
                  <TableHead className="hidden md:table-cell">Eff. bitrate</TableHead>
                  <TableHead className="hidden sm:table-cell">Size</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTracks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-[280px]">
                      <p className="truncate font-medium" title={t.name}>{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.mime || "unknown type"}</p>
                    </TableCell>
                    <TableCell><StatusBadge track={t} /></TableCell>
                    <TableCell className="tabular-nums">{t.meta ? formatTime(t.meta.duration) : "—"}</TableCell>
                    <TableCell className="tabular-nums">{t.meta?.sampleRate ? `${t.meta.sampleRate} Hz` : "—"}</TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">{t.meta?.channels ?? "—"}</TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {t.meta?.effectiveBitrateKbps ? `${t.meta.effectiveBitrateKbps} kbps` : "—"}
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">{formatBytes(t.size)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${t.name}`}>
                            <Ellipsis className="h-4 w-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuLabel>Open in</DropdownMenuLabel>
                          <DropdownMenuItem disabled={t.status !== "ready"} onClick={() => openTrackWith(t.id, "cutter")}>
                            <Scissors className="h-4 w-4" aria-hidden /> Cutter
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={t.status !== "ready"} onClick={() => openTrackWith(t.id, "joiner")}>
                            <Combine className="h-4 w-4" aria-hidden /> Joiner
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={t.status !== "ready"} onClick={() => openTrackWith(t.id, "pitcher")}>
                            <Music2 className="h-4 w-4" aria-hidden /> Pitcher
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={t.status !== "ready"} onClick={() => openTrackWith(t.id, "key-bpm")}>
                            <KeySquare className="h-4 w-4" aria-hidden /> Key &amp; BPM Finder
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={t.status !== "ready"} onClick={() => openTrackWith(t.id, "karaoke")}>
                            <MicVocal className="h-4 w-4" aria-hidden /> Karaoke
                          </DropdownMenuItem>
                          {t.status === "error" && (
                            <DropdownMenuItem onClick={() => retryTrack(t.id)}>
                              <RefreshCcw className="h-4 w-4" aria-hidden /> Retry import
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => removeTrack(t.id)}>
                            <Trash2 className="h-4 w-4" aria-hidden /> Remove from library
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Decoder support (probed live from this browser)</h2>
        <div className="flex flex-wrap gap-2">
          {support.map((f) => (
            <Badge
              key={f.ext}
              variant="outline"
              className={
                f.support === "probably"
                  ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                  : f.support === "maybe"
                    ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                    : "border-border text-muted-foreground"
              }
              title={`canPlayType("${f.mimeCandidates[0]}") → "${f.support}"`}
            >
              {f.label} · {f.support}
            </Badge>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Playback probes are indicative; import validation decodes the actual file, so genuinely
          decodable content is accepted regardless of these chips.
        </p>
      </section>
    </div>
  );
}
