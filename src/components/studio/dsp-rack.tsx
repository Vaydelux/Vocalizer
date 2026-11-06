"use client";

/**
 * Enterprise Audio DSP Rack Component
 *
 * Provides real-time parameter controls for Parametric EQ, Dynamic Compressor,
 * Reverb, and Peak Limiter.
 */

import { Sliders, Activity, Disc, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DspEffectChain } from "@/lib/studio/dsp-effects";

interface DspRackProps {
  title?: string;
  chain: DspEffectChain;
  onChange: (patch: Partial<DspEffectChain>) => void;
}

export function DspRack({ title = "DSP Effect Rack", chain, onChange }: DspRackProps) {
  const updateEq = (patch: Partial<DspEffectChain["eq"]>) => {
    onChange({ eq: { ...chain.eq, ...patch } });
  };

  const updateComp = (patch: Partial<DspEffectChain["compressor"]>) => {
    onChange({ compressor: { ...chain.compressor, ...patch } });
  };

  const updateLimiter = (patch: Partial<DspEffectChain["limiter"]>) => {
    onChange({ limiter: { ...chain.limiter, ...patch } });
  };

  return (
    <Card className="border-border/70 bg-card/60">
      <CardHeader className="py-2.5 px-3 flex flex-row items-center justify-between border-b border-border/40">
        <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
          <Sliders className="h-3.5 w-3.5 text-primary" />
          {title}
        </CardTitle>
        <span className="text-[10px] text-muted-foreground">Studio Processors</span>
      </CardHeader>
      <CardContent className="p-3">
        <Tabs defaultValue="eq" className="w-full">
          <TabsList className="grid grid-cols-3 h-7 w-full p-0.5 mb-3 bg-muted/50">
            <TabsTrigger value="eq" className="text-[11px] h-6 flex items-center gap-1">
              <Activity className="h-3 w-3" />
              EQ
            </TabsTrigger>
            <TabsTrigger value="comp" className="text-[11px] h-6 flex items-center gap-1">
              <Disc className="h-3 w-3" />
              Compressor
            </TabsTrigger>
            <TabsTrigger value="limiter" className="text-[11px] h-6 flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              Limiter
            </TabsTrigger>
          </TabsList>

          {/* EQ TAB */}
          <TabsContent value="eq" className="space-y-3 mt-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">3-Band Parametric EQ</span>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="eq-toggle" className="text-[11px] text-muted-foreground cursor-pointer">
                  {chain.eq.enabled ? "Active" : "Bypassed"}
                </Label>
                <Switch
                  id="eq-toggle"
                  checked={chain.eq.enabled}
                  onCheckedChange={(c) => updateEq({ enabled: c })}
                />
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Low Shelf ({chain.eq.lowFreq} Hz)</span>
                  <span>{chain.eq.lowGainDb > 0 ? `+${chain.eq.lowGainDb}` : chain.eq.lowGainDb} dB</span>
                </div>
                <Slider
                  min={-18}
                  max={18}
                  step={0.5}
                  value={[chain.eq.lowGainDb]}
                  disabled={!chain.eq.enabled}
                  onValueChange={([v]) => updateEq({ lowGainDb: v })}
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Mid Peaking ({chain.eq.midFreq} Hz, Q {chain.eq.midQ})</span>
                  <span>{chain.eq.midGainDb > 0 ? `+${chain.eq.midGainDb}` : chain.eq.midGainDb} dB</span>
                </div>
                <Slider
                  min={-18}
                  max={18}
                  step={0.5}
                  value={[chain.eq.midGainDb]}
                  disabled={!chain.eq.enabled}
                  onValueChange={([v]) => updateEq({ midGainDb: v })}
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>High Shelf ({chain.eq.highFreq} Hz)</span>
                  <span>{chain.eq.highGainDb > 0 ? `+${chain.eq.highGainDb}` : chain.eq.highGainDb} dB</span>
                </div>
                <Slider
                  min={-18}
                  max={18}
                  step={0.5}
                  value={[chain.eq.highGainDb]}
                  disabled={!chain.eq.enabled}
                  onValueChange={([v]) => updateEq({ highGainDb: v })}
                />
              </div>
            </div>
          </TabsContent>

          {/* COMPRESSOR TAB */}
          <TabsContent value="comp" className="space-y-3 mt-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Dynamic Compressor</span>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="comp-toggle" className="text-[11px] text-muted-foreground cursor-pointer">
                  {chain.compressor.enabled ? "Active" : "Bypassed"}
                </Label>
                <Switch
                  id="comp-toggle"
                  checked={chain.compressor.enabled}
                  onCheckedChange={(c) => updateComp({ enabled: c })}
                />
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Threshold</span>
                  <span>{chain.compressor.thresholdDb} dB</span>
                </div>
                <Slider
                  min={-48}
                  max={0}
                  step={1}
                  value={[chain.compressor.thresholdDb]}
                  disabled={!chain.compressor.enabled}
                  onValueChange={([v]) => updateComp({ thresholdDb: v })}
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Ratio</span>
                  <span>{chain.compressor.ratio}:1</span>
                </div>
                <Slider
                  min={1}
                  max={16}
                  step={0.5}
                  value={[chain.compressor.ratio]}
                  disabled={!chain.compressor.enabled}
                  onValueChange={([v]) => updateComp({ ratio: v })}
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Attack / Release</span>
                  <span>{Math.round(chain.compressor.attackSec * 1000)}ms / {Math.round(chain.compressor.releaseSec * 1000)}ms</span>
                </div>
                <Slider
                  min={10}
                  max={500}
                  step={10}
                  value={[Math.round(chain.compressor.releaseSec * 1000)]}
                  disabled={!chain.compressor.enabled}
                  onValueChange={([v]) => updateComp({ releaseSec: v / 1000 })}
                />
              </div>
            </div>
          </TabsContent>

          {/* LIMITER TAB */}
          <TabsContent value="limiter" className="space-y-3 mt-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">True Peak Limiter</span>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="lim-toggle" className="text-[11px] text-muted-foreground cursor-pointer">
                  {chain.limiter.enabled ? "Active" : "Bypassed"}
                </Label>
                <Switch
                  id="lim-toggle"
                  checked={chain.limiter.enabled}
                  onCheckedChange={(c) => updateLimiter({ enabled: c })}
                />
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Ceiling</span>
                  <span>{chain.limiter.ceilingDb} dBFS</span>
                </div>
                <Slider
                  min={-6}
                  max={0}
                  step={0.1}
                  value={[chain.limiter.ceilingDb]}
                  disabled={!chain.limiter.enabled}
                  onValueChange={([v]) => updateLimiter({ ceilingDb: v })}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
