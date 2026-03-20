import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-400" strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold text-foreground">页面渲染出错</h2>
          <p className="text-[13px] text-muted-foreground text-center max-w-md">
            {this.state.error?.message || "发生了未知错误"}
          </p>
          <Button variant="outline" size="sm" onClick={this.handleReset}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            重试
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
