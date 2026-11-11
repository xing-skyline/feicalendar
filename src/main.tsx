import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import DesktopPanel from "./components/DesktopPanel";
import QuickCapture from "./components/QuickCapture";
import "./styles.css";

const App = lazy(() => import("./App"));

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error?: string }
> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal">
          <h1>飞历遇到显示问题</h1>
          <p>{this.state.error}</p>
          <button onClick={() => location.reload()}>重新载入</button>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <Suspense fallback={null}>
      {location.hash === "#desktop" ? (
        <DesktopPanel />
      ) : location.hash === "#capture" ? (
        <QuickCapture />
      ) : (
        <App />
      )}
    </Suspense>
  </ErrorBoundary>,
);
