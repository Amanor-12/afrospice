import { Component } from "react";
import { reportFrontendIncident } from "../utils/observability.js";

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error("AfroSpice frontend crashed.", {
      error,
      errorInfo,
    });
    reportFrontendIncident(
      {
        type: "react_error_boundary",
        level: "error",
        message: error?.message || "React error boundary triggered.",
        errorName: error?.name || "",
        stack: error?.stack || "",
        componentStack: errorInfo?.componentStack || "",
      },
      { force: true }
    );
  }

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-boot-shell" role="alert" aria-live="assertive">
          <div className="app-boot-mark">AfroSpice</div>
          <strong>The workspace hit a frontend error.</strong>
          <p>
            Reload the app first. If the issue repeats, check the deployed frontend build,
            browser console, and API availability.
          </p>
          <button type="button" className="btn btn-primary" onClick={this.handleReload}>
            Reload Workspace
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default AppErrorBoundary;
