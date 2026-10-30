"use client";

import React from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State {
  error: Error | null;
}

/** Renderer error boundary — a crash never leaves a blank window. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Local diagnostics only — no external reporting in this privacy-first build.
    console.error("[Vocalizer] Renderer error boundary:", error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-destructive">
              <TriangleAlert className="h-5 w-5" aria-hidden />
              <h1 className="text-base font-semibold">Something went wrong</h1>
            </div>
            <p className="mb-1 text-sm text-muted-foreground">
              The interface encountered an unexpected error. Files on disk are untouched,
              but unsaved session work might need to be repeated.
            </p>
            <pre className="mb-4 max-h-32 overflow-y-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              If this happens again, open Vocalizer in debug mode and include the error message in your report.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
