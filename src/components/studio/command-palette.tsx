"use client";

/**
 * Enterprise Command Palette (Ctrl+K / Cmd+K)
 *
 * Instant fuzzy search and keyboard-driven execution for all workspace tools,
 * project operations, loaded audio tracks, and system settings.
 */

import { useEffect, useState } from "react";
import {
  Scissors,
  Layers,
  SlidersHorizontal,
  Music,
  Mic,
  Mic2,
  Sparkles,
  Cpu,
  Settings,
  HelpCircle,
  FolderOpen,
  Save,
  PlusCircle,
  SunMoon,
  ListOrdered,
  FileAudio,
  Activity,
  Zap,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";
import { useUi, type ViewId } from "@/lib/studio/store-ui";
import { useTracks } from "@/lib/studio/store-tracks";
import { useSettings } from "@/lib/studio/store-settings";
import { useProject, saveProjectFile, newProject } from "@/lib/studio/project";
import { toast } from "sonner";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTriggerOpenFile?: () => void;
}

export function CommandPalette({ open, onOpenChange, onTriggerOpenFile }: CommandPaletteProps) {
  const setView = useUi((s) => s.setView);
  const openTrackWith = useUi((s) => s.openTrackWith);
  const tracks = useTracks((s) => s.tracks);
  const theme = useSettings((s) => s.theme);
  const updateSettings = useSettings((s) => s.update);

  const navigateTo = (view: ViewId) => {
    setView(view);
    onOpenChange(false);
  };

  const handleToggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    updateSettings({ theme: next });
    toast.info(`Theme set to ${next}`);
    onOpenChange(false);
  };

  const handleSave = () => {
    void saveProjectFile();
    onOpenChange(false);
  };

  const handleNew = () => {
    newProject();
    onOpenChange(false);
  };

  const handleOpen = () => {
    onOpenChange(false);
    onTriggerOpenFile?.();
  };

  const handleSelectTrack = (trackId: string, trackName: string) => {
    openTrackWith(trackId, "cutter");
    toast.info(`Opened "${trackName}" in Cutter`);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command Palette" description="Search actions, tools, and tracks">
      <CommandInput placeholder="Type a command or search tracks..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Project">
          <CommandItem onSelect={handleSave}>
            <Save className="mr-2 h-4 w-4" />
            <span>Save Project (.vocalizer)</span>
            <CommandShortcut>Ctrl+S</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleOpen}>
            <FolderOpen className="mr-2 h-4 w-4" />
            <span>Open Project...</span>
            <CommandShortcut>Ctrl+O</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleNew}>
            <PlusCircle className="mr-2 h-4 w-4" />
            <span>New Blank Project</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Workspaces & Tools">
          <CommandItem onSelect={() => navigateTo("home")}>
            <Layers className="mr-2 h-4 w-4 text-primary" />
            <span>Tracks Library</span>
            <CommandShortcut>Alt+1</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("cutter")}>
            <Scissors className="mr-2 h-4 w-4 text-primary" />
            <span>Audio Cutter & Splitter</span>
            <CommandShortcut>Alt+2</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("joiner")}>
            <Layers className="mr-2 h-4 w-4 text-primary" />
            <span>Audio Joiner & Crossfade</span>
            <CommandShortcut>Alt+3</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("mixer")}>
            <SlidersHorizontal className="mr-2 h-4 w-4 text-primary" />
            <span>Multi-Track Mixer & DAW</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("batch")}>
            <Zap className="mr-2 h-4 w-4 text-primary" />
            <span>Batch Audio Processor</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("pitcher")}>
            <SlidersHorizontal className="mr-2 h-4 w-4 text-primary" />
            <span>Pitch & Speed Shifter</span>
            <CommandShortcut>Alt+4</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("key-bpm")}>
            <Music className="mr-2 h-4 w-4 text-primary" />
            <span>BPM & Musical Key Detector</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("remover")}>
            <Sparkles className="mr-2 h-4 w-4 text-primary" />
            <span>Vocal Remover (AI 2-Stem)</span>
            <CommandShortcut>Alt+5</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("splitter")}>
            <Sparkles className="mr-2 h-4 w-4 text-primary" />
            <span>Stem Splitter (Multi-Stem)</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("recorder")}>
            <Mic className="mr-2 h-4 w-4 text-primary" />
            <span>Voice & Instrument Recorder</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("karaoke")}>
            <Mic2 className="mr-2 h-4 w-4 text-primary" />
            <span>Karaoke & Lyrics Sync</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("queue")}>
            <ListOrdered className="mr-2 h-4 w-4 text-primary" />
            <span>Processing Queue & Exports</span>
            <CommandShortcut>Alt+6</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("system")}>
            <Activity className="mr-2 h-4 w-4 text-primary" />
            <span>System Diagnostics & Hardware</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("models")}>
            <Cpu className="mr-2 h-4 w-4 text-primary" />
            <span>Neural AI Models</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("settings")}>
            <Settings className="mr-2 h-4 w-4 text-primary" />
            <span>Preferences & Settings</span>
          </CommandItem>
          <CommandItem onSelect={() => navigateTo("help")}>
            <HelpCircle className="mr-2 h-4 w-4 text-primary" />
            <span>Documentation & Shortcuts</span>
          </CommandItem>
        </CommandGroup>

        {tracks.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Loaded Tracks (${tracks.length})`}>
              {tracks.map((t) => (
                <CommandItem key={t.id} onSelect={() => handleSelectTrack(t.id, t.name)}>
                  <FileAudio className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{t.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t.meta?.duration ? `${t.meta.duration.toFixed(1)}s` : `${(t.size / 1024 / 1024).toFixed(1)}MB`}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Quick Preferences">
          <CommandItem onSelect={handleToggleTheme}>
            <SunMoon className="mr-2 h-4 w-4" />
            <span>Toggle Theme ({theme === "dark" ? "Switch to Light" : "Switch to Dark"})</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
