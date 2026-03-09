"use client";

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="text-sm font-medium text-foreground/80">Something went wrong</div>
          <p className="text-xs text-muted-foreground/50 text-center max-w-sm">
            {this.state.error?.message ?? "An unexpected error occurred"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
