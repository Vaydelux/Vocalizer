"use client";

/**
 * Enterprise Project Bar
 *
 * Header bar providing project identity, unsaved status badges, quick save/open,
 * session autosave persistence, and Command Palette quick access.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { FolderOpen, Save, PlusCircle, Search, Edit2, Check, AlertCircle, ShieldCheck, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  useProject,
  saveProjectFile,
  loadProjectFromFile,
  newProject,
  saveAutosaveSession,
  restoreAutosaveSession,
  relinkProjectTracks,
  relinkProjectNativeStems,
} from "@/lib/studio/project";
import { useMixer } from "@/lib/studio/store-mixer";
import { useAnalysis } from "@/lib/studio/store-analysis";
import { useTracks } from "@/lib/studio/store-tracks";
import { isNative } from "@/lib/studio/native";
import { parsePublishedStemFilename } from "../../../electron/shared/published-stem";
import { CommandPalette } from "./command-palette";
import { ComplianceModal } from "./compliance-modal";

export function ProjectBar() {
  const projectTitle = useProject((s) => s.projectTitle);
  const isDirty = useProject((s) => s.isDirty);
  const setProjectTitle = useProject((s) => s.setProjectTitle);
  const tracks = useTracks((s) => s.tracks);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(projectTitle);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [complianceOpen, setComplianceOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const [isRelinking, setIsRelinking] = useState(false);
  const missingTrackCount = tracks.filter((t) => t.status === "error" && t.file.size === 0).length;

  // Restore autosaved session once on mount if empty
  useEffect(() => {
    if (tracks.length === 0) {
      restoreAutosaveSession();
    }
  }, []);

  // Debounced autosave to localStorage whenever tracks or title change
  useEffect(() => {
    const timer = setTimeout(() => {
      saveAutosaveSession();
    }, 1200);
    return () => clearTimeout(timer);
  }, [tracks, projectTitle, isDirty]);

  // Mixer and analysis changes are included in autosave, not only track and
  // title changes. Mark the session dirty until the user saves it explicitly.
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      useProject.getState().markDirty();
      if (pending) clearTimeout(pending);
      pending = setTimeout(saveAutosaveSession, 1200);
    };
    const stopMixer = useMixer.subscribe(changed);
    const stopAnalysis = useAnalysis.subscribe(changed);
    return () => {
      stopMixer(); stopAnalysis();
      if (pending) clearTimeout(pending);
    };
  }, []);

  // Global Ctrl+K / Cmd+K and Ctrl+S / Cmd+S listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProjectFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        fileInputRef.current?.click();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const commitTitle = useCallback(() => {
    if (tempTitle.trim()) {
      setProjectTitle(tempTitle.trim());
    } else {
      setTempTitle(projectTitle);
    }
    setIsEditingTitle(false);
  }, [tempTitle, projectTitle, setProjectTitle]);

  const handleOpenFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void loadProjectFromFile(file);
      e.target.value = "";
    }
  };

  const handleRelinkFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length || isRelinking) return;
    setIsRelinking(true);
    void relinkProjectTracks(selected)
      .then(({ linked, unresolved, rejected }) => {
        if (linked > 0) {
          toast.success(`Relinked ${linked} audio track(s)`, {
            description: unresolved ? `${unresolved} still missing. Select the matching originals to continue.` : "All project audio is now available.",
          });
        } else {
          toast.warning("No matching project audio could be relinked", {
            description: rejected ? `${rejected} files did not match expected audio metadata.` : "Select the original audio files with matching names and file sizes.",
          });
        }
      })
      .catch((error) => toast.error("Could not relink audio", {
        description: error instanceof Error ? error.message : "Unexpected file validation error.",
      }))
      .finally(() => setIsRelinking(false));
  };

  const handleRelinkClick = () => {
    if (isRelinking) return;
    const nativeStemsPending = isNative() && tracks.some(
      (track) => track.status === "error" && track.file.size === 0 &&
        parsePublishedStemFilename(track.name) !== null
    );
    // Keep the existing browser-file relink for non-published source audio.
    if (!nativeStemsPending) {
      relinkInputRef.current?.click();
      return;
    }
    setIsRelinking(true);
    void relinkProjectNativeStems()
      .then(({ linked, unresolved, rejected, cancelled }) => {
        if (cancelled) return;
        if (linked > 0) {
          toast.success(`Relinked ${linked} saved stem(s) without copying audio into RAM`, {
            description: unresolved
              ? `${unresolved} original(s) still missing. Relink remaining files to finish recovery.`
              : "All project audio is now available.",
          });
        } else {
          toast.warning("No matching published stems were restored", {
            description: rejected
              ? `${rejected} selected file(s) failed name, size, duration or source checks.`
              : "Select the exact original Vocalizer output files for this project.",
          });
        }
      })
      .catch((error) => toast.error("Native stem relink failed", {
        description: error instanceof Error ? error.message : "Unable to validate selected saved stems.",
      }))
      .finally(() => setIsRelinking(false));
  };

  return (
    <div className="flex h-12 w-full shrink-0 items-center justify-between border-b border-border bg-card/50 px-3 text-sm">
      {/* Hidden file input for opening projects */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".vocalizer,.json"
        className="hidden"
        onChange={handleOpenFileChange}
      />

      <input
        ref={relinkInputRef}
        type="file"
        accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg,.opus,.aiff"
        multiple
        className="hidden"
        onChange={handleRelinkFileChange}
      />

      {/* Left: Project title & status */}
      <div className="flex items-center gap-2 min-w-0">
        {isEditingTitle ? (
          <div className="flex items-center gap-1">
            <Input
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === "Enter" && commitTitle()}
              autoFocus
              className="h-7 w-44 text-xs font-semibold"
            />
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={commitTitle}>
              <Check className="h-3.5 w-3.5 text-primary" />
            </Button>
          </div>
        ) : (
          <button
            onClick={() => {
              setTempTitle(projectTitle);
              setIsEditingTitle(true);
            }}
            className="group flex items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-xs font-semibold hover:bg-muted/60 transition-colors"
            title="Click to rename project"
          >
            <span className="truncate max-w-[160px] sm:max-w-[240px]">{projectTitle}</span>
            <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-70 transition-opacity text-muted-foreground" />
          </button>
        )}

        {isDirty ? (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-amber-500 border-amber-500/30 bg-amber-500/10">
            <AlertCircle className="h-2.5 w-2.5" />
            Unsaved
          </Badge>
        ) : (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-muted-foreground border-border/40">
            Saved
          </Badge>
        )}

        <span className="hidden sm:inline-block text-[11px] text-muted-foreground/80">
          • {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
        </span>
      </div>

      {/* Center: Command Palette Trigger */}
      <div className="flex-1 max-w-sm px-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPaletteOpen(true)}
          className="h-7 w-full justify-between bg-muted/40 px-2.5 text-xs text-muted-foreground font-normal hover:bg-muted/70"
        >
          <span className="flex items-center gap-1.5 truncate">
            <Search className="h-3.5 w-3.5 opacity-70" />
            <span className="hidden sm:inline truncate">Search tools, tracks, commands...</span>
            <span className="sm:hidden">Search...</span>
          </span>
          <kbd className="pointer-events-none hidden sm:inline-flex h-4 select-none items-center gap-0.5 rounded border border-border bg-background px-1 font-mono text-[9px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </Button>
      </div>

      {/* Right: Project actions */}
      <div className="flex items-center gap-1">
        {missingTrackCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs text-amber-600 dark:text-amber-400"
            disabled={isRelinking}
            onClick={handleRelinkClick}
            title={`${missingTrackCount} original audio file(s) must be relinked before processing`}
          >
            <Link2 className="h-3.5 w-3.5" />
            {isRelinking ? "Verifying…" : `Relink Audio (${missingTrackCount})`}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs px-2"
          onClick={() => newProject()}
          title="New blank project"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span className="hidden md:inline">New</span>
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs px-2"
          onClick={() => fileInputRef.current?.click()}
          title="Open project (.vocalizer)"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Open</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs px-2.5"
          onClick={() => void saveProjectFile()}
          title="Save project (.vocalizer)"
        >
          <Save className="h-3.5 w-3.5" />
          <span>Save</span>
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
          onClick={() => setComplianceOpen(true)}
          title="Broadcast Loudness & Cryptographic Compliance Audit"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Compliance</span>
        </Button>
      </div>

      {/* Command Palette Modal */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onTriggerOpenFile={() => fileInputRef.current?.click()}
      />

      {/* Enterprise Compliance & Audit Modal */}
      <ComplianceModal
        open={complianceOpen}
        onOpenChange={setComplianceOpen}
      />
    </div>
  );
}
