"use client";

/**
 * Enterprise Batch Audio Processing Workspace
 *
 * Bulk transcoding, sample-rate conversion, silence stripping, and broadcast
 * loudness normalization across multiple audio files with live progress,
 * multi-core worker concurrency, and 60fps mastering spectrum monitoring.
 */

import { useState } from "react";
import {
  Layers,
  Play,
  Square,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trash2,
  Download,
  Sliders,
  Sparkles,
  ListPlus,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { SpectrumVisualizer } from "@/components/studio/spectrum-visualizer";
import { ExportFormatSelect, type ExportFormatValue } from "@/components/studio/export-format-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useBatch, type BatchItem } from "@/lib/studio/batch";
import { useTracks } from "@/lib/studio/store-tracks";

export function BatchView() {
  const items = useBatch((s) => s.items);
  const recipe = useBatch((s) => s.recipe);
  const isRunning = useBatch((s) => s.isRunning);
  const addAllReadyTracks = useBatch((s) => s.addAllReadyTracks);
  const removeItem = useBatch((s) => s.removeItem);
  const clearItems = useBatch((s) => s.clearItems);
  const updateRecipe = useBatch((s) => s.updateRecipe);
  const startBatch = useBatch((s) => s.startBatch);
  const cancelBatch = useBatch((s) => s.cancelBatch);

  const readyTracks = useTracks((s) => s.tracks.filter((t) => t.status === "ready"));

  const completedCount = items.filter((i) => i.status === "done").length;
  const overallProgress = items.length > 0 ? (completedCount / items.length) * 100 : 0;

  const handleFormatChange = (fmt: ExportFormatValue) => {
    updateRecipe({
      targetFormat: fmt.format,
      mp3Bitrate: fmt.mp3Bitrate,
    });
  };

  const statusBadge = (item: BatchItem) => {
    switch (item.status) {
      case "done":
        return (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-emerald-500 border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-2.5 w-2.5" /> Done
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-primary border-primary/30 bg-primary/10 animate-pulse">
            <Zap className="h-2.5 w-2.5" /> {item.stage || "Processing"}
          </Badge>
        );
      case "error":
        return (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-destructive border-destructive/30 bg-destructive/10">
            <AlertCircle className="h-2.5 w-2.5" /> Error
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-muted-foreground border-border/40">
            Cancelled
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-muted-foreground border-border/40">
            <Clock className="h-2.5 w-2.5" /> Pending
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Batch Audio Processing"
        description="Bulk transcode, resample, normalize, and strip silence across 10 to 100+ audio files with multi-core worker concurrency."
      />

      {/* Monitoring HUD */}
      <SpectrumVisualizer isPlaying={isRunning} />

      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={addAllReadyTracks}
            disabled={readyTracks.length === 0 || isRunning}
            className="h-8 gap-1.5 text-xs"
          >
            <ListPlus className="h-3.5 w-3.5" /> Add All Library Tracks ({readyTracks.length})
          </Button>

          {items.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearItems}
              disabled={isRunning}
              className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1"
            >
              <Trash2 className="h-3 w-3" /> Clear Queue
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isRunning ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={cancelBatch}
              className="h-8 gap-1.5 text-xs font-semibold"
            >
              <Square className="h-3.5 w-3.5" /> Cancel Batch
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void startBatch()}
              disabled={items.length === 0}
              className="h-8 gap-1.5 text-xs font-semibold shadow-xs"
            >
              <Play className="h-3.5 w-3.5" /> Start Batch ({items.length})
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No tracks in batch queue"
          description="Click 'Add All Library Tracks' above to populate the batch queue, or import files from the Home workspace."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Left: Batch Items Table */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="py-2.5 px-3 border-b border-border/40 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-semibold">
                  Batch Queue ({completedCount}/{items.length} Completed)
                </CardTitle>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {Math.round(overallProgress)}%
                </span>
              </CardHeader>

              <div className="p-3 border-b border-border/40">
                <Progress value={overallProgress} className="h-2 w-full" />
              </div>

              <CardContent className="p-0">
                <div className="divide-y divide-border/40 max-h-[460px] overflow-y-auto">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 gap-3 text-xs">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate max-w-[280px]" title={item.trackName}>
                            {item.trackName}
                          </span>
                          {statusBadge(item)}
                        </div>

                        {item.status === "processing" && (
                          <Progress value={Math.round(item.progress * 100)} className="h-1.5 w-48" />
                        )}

                        {item.outputName && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            Output: {item.outputName}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {item.outputUrl && (
                          <a
                            href={item.outputUrl}
                            download={item.outputName || "batch_output"}
                            className="inline-flex items-center justify-center h-7 px-2 rounded-md border border-border text-xs gap-1 hover:bg-muted"
                          >
                            <Download className="h-3 w-3" /> Save
                          </a>
                        )}

                        {!isRunning && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeItem(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Global Recipe Inspector */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="py-2.5 px-3 border-b border-border/40">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5 text-primary" /> Global Batch Recipe
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-4">
                {/* Export Format */}
                <ExportFormatSelect
                  value={{ format: recipe.targetFormat, mp3Bitrate: recipe.mp3Bitrate }}
                  onChange={handleFormatChange}
                />

                {/* Broadcast Loudness Normalization */}
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 p-2.5">
                  <div className="space-y-0.5">
                    <Label htmlFor="batch-loudnorm" className="text-xs font-medium cursor-pointer">
                      EBU R128 Loudness Normalization
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Target -14 LUFS / -1.0 dBFS true peak
                    </p>
                  </div>
                  <Switch
                    id="batch-loudnorm"
                    checked={!!recipe.loudnessNormalize}
                    onCheckedChange={(c) =>
                      updateRecipe({
                        loudnessNormalize: c ? { targetLufs: -14, truePeak: -1.0 } : null,
                      })
                    }
                  />
                </div>

                {/* Worker Concurrency */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">Worker Concurrency</span>
                    <span className="font-mono text-muted-foreground">{recipe.concurrency} parallel</span>
                  </div>
                  <Slider
                    min={1}
                    max={4}
                    step={1}
                    value={[recipe.concurrency]}
                    disabled={isRunning}
                    onValueChange={([v]) => updateRecipe({ concurrency: v })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Matches CPU worker cores for high throughput without UI lag.
                  </p>
                </div>

                {/* Naming Pattern */}
                <div className="space-y-1.5">
                  <Label htmlFor="naming-pattern" className="text-xs font-medium">
                    Output Naming Pattern
                  </Label>
                  <Input
                    id="naming-pattern"
                    value={recipe.namingPattern}
                    onChange={(e) => updateRecipe({ namingPattern: e.target.value })}
                    disabled={isRunning}
                    className="h-8 text-xs font-mono"
                    placeholder="[name]_mastered"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Use <code className="text-primary">[name]</code> for original base name.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
